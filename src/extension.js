const vscode = require("vscode")
const fs = require("fs")
const path = require("path")
const { DEFAULT_IGNORES, BINARY_EXTENSIONS, packFiles } = require("./core")
const { GUMROAD_CHECKOUT_URL, verifyGumroadLicense } = require("./license")

const LICENSE_KEY_STORAGE = "contextpack.proLicense"
const FREE_FILE_LIMIT = 15
const MAX_FILE_BYTES = 512 * 1024 // 512 KB per file

function collectFilesFromPath(targetPath, rootDir, out) {
  let stat
  try {
    stat = fs.statSync(targetPath)
  } catch {
    return
  }

  if (stat.isDirectory()) {
    const base = path.basename(targetPath)
    if (DEFAULT_IGNORES.has(base)) return
    let entries = []
    try {
      entries = fs.readdirSync(targetPath)
    } catch {
      return
    }
    for (const entry of entries) {
      if (DEFAULT_IGNORES.has(entry)) continue
      collectFilesFromPath(path.join(targetPath, entry), rootDir, out)
    }
    return
  }

  if (!stat.isFile()) return
  if (stat.size > MAX_FILE_BYTES) return
  const ext = path.extname(targetPath).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return

  try {
    const content = fs.readFileSync(targetPath, "utf8")
    const rel = path.relative(rootDir, targetPath).replace(/\\/g, "/") || path.basename(targetPath)
    out.push({ path: rel, content })
  } catch {
    // skip unreadable files
  }
}

function resolveTargets(uri, uris) {
  if (Array.isArray(uris) && uris.length > 0) {
    return uris.map((u) => u.fsPath)
  }
  if (uri && uri.fsPath) {
    return [uri.fsPath]
  }
  const active = vscode.window.activeTextEditor?.document?.uri?.fsPath
  if (active) return [active]
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath
  return ws ? [ws] : []
}

async function promptUpgrade(featureName) {
  const choice = await vscode.window.showInformationMessage(
    `${featureName} is a ContextPack Pro feature ($9.99 one-time, no subscription).`,
    "Get Pro ($9.99)",
    "Enter License Key"
  )
  if (choice === "Get Pro ($9.99)") {
    vscode.env.openExternal(vscode.Uri.parse(GUMROAD_CHECKOUT_URL))
  } else if (choice === "Enter License Key") {
    vscode.commands.executeCommand("contextpack.activatePro")
  }
}

function activate(context) {
  const isPro = () => Boolean(context.globalState.get(LICENSE_KEY_STORAGE)?.valid)

  async function runPack(uri, uris, mode) {
    const pro = isPro()
    if ((mode === "xml" || mode === "skeleton") && !pro) {
      await promptUpgrade(
        mode === "xml"
          ? "Claude XML + Secret Redaction"
          : "Skeleton / Signature-Only Compression"
      )
      return
    }

    const targets = resolveTargets(uri, uris)
    if (targets.length === 0) {
      vscode.window.showWarningMessage("ContextPack: Select a file or folder in Explorer first.")
      return
    }

    const rootDir =
      vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || path.dirname(targets[0])

    const files = []
    for (const t of targets) {
      collectFilesFromPath(t, rootDir, files)
    }

    if (files.length === 0) {
      vscode.window.showWarningMessage("ContextPack: No readable text files found.")
      return
    }

    const res = packFiles(files, {
      format: mode === "xml" ? "xml" : "markdown",
      redact: pro,
      skeleton: mode === "skeleton",
      maxFiles: pro ? Infinity : FREE_FILE_LIMIT,
    })

    await vscode.env.clipboard.writeText(res.output)

    const notes = []
    if (res.redactedCount > 0) notes.push(`${res.redactedCount} secret(s) redacted`)
    if (res.truncatedCount > 0) notes.push(`${res.truncatedCount} more files skipped on Free plan`)

    const suffix = notes.length ? ` (${notes.join(", ")})` : ""
    vscode.window.showInformationMessage(
      `ContextPack: Copied ${res.fileCount} file(s) (~${res.estimatedTokens.toLocaleString()} tokens) to clipboard${suffix}`
    )
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("contextpack.packMarkdown", (uri, uris) =>
      runPack(uri, uris, "markdown")
    ),
    vscode.commands.registerCommand("contextpack.packXml", (uri, uris) =>
      runPack(uri, uris, "xml")
    ),
    vscode.commands.registerCommand("contextpack.packSkeleton", (uri, uris) =>
      runPack(uri, uris, "skeleton")
    ),
    vscode.commands.registerCommand("contextpack.activatePro", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your ContextPack Pro Gumroad License Key",
        placeHolder: "XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX",
        ignoreFocusOut: true,
      })
      if (!key) return
      const res = await verifyGumroadLicense(key)
      if (!res.valid) {
        vscode.window.showErrorMessage(`ContextPack Pro: ${res.error}`)
        return
      }
      await context.globalState.update(LICENSE_KEY_STORAGE, res)
      vscode.window.showInformationMessage("ContextPack Pro activated! Unlimited files, Claude XML, Secret Redaction & Skeleton Mode unlocked.")
    })
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
