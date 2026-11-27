// Pure core logic for ContextPack (zero external dependencies, fully unit-tested).
// Handles:
// - Token estimation (~4 chars/token heuristic with code adjustment)
// - Directory tree generation
// - Secret / API key auto-redaction (Pro)
// - Signature/skeleton extraction for JS/TS/Python/Go/Rust (Pro)
// - Markdown & Claude-optimized XML formatting

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
  "target",
  "coverage",
  ".turbo",
])

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf",
  ".zip", ".tar", ".gz", ".7z", ".rar", ".vsix", ".xlsx", ".xls",
  ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".mov", ".wasm",
  ".exe", ".dll", ".so", ".dylib", ".pyc", ".class", ".lockb",
])

const SECRET_PATTERNS = [
  { name: "OPENAI_KEY", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "ANTHROPIC_KEY", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "GITHUB_TOKEN", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: "AWS_ACCESS_KEY", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GOOGLE_API_KEY", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "STRIPE_KEY", regex: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{20,}\b/g },
  { name: "JWT", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: "ENV_SECRET",
    regex: /^([ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Z0-9_]*[ \t]*=[ \t]*)(["']?)([^"'\r\n#]+)\2/gim,
    replace: "$1$2[REDACTED_ENV_SECRET]$2",
  },
]

function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(String(text).length / 3.8)
}

function redactSecrets(text) {
  let out = String(text ?? "")
  let redactedCount = 0

  for (const rule of SECRET_PATTERNS) {
    if (rule.replace) {
      out = out.replace(rule.regex, (...args) => {
        redactedCount++
        return `${args[1]}${args[2]}[REDACTED_${rule.name}]${args[2]}`
      })
    } else {
      out = out.replace(rule.regex, () => {
        redactedCount++
        return `[REDACTED_${rule.name}]`
      })
    }
  }
  return { text: out, redactedCount }
}

function extractSkeleton(content, filePath = "") {
  const lines = String(content ?? "").split(/\r?\n/)
  const kept = []
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()

  const keepPatterns = [
    /^\s*(?:import|export\s+type|export\s+interface|export\s+enum|from\s+\S+\s+import)\b/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+\w+/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/,
    /^\s*(?:public|private|protected|static|async)?\s*\w+\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|& ,?]+)?\s*\{/,
    /^\s*(?:async\s+)?def\s+\w+\s*\(/,
    /^\s*class\s+\w+/,
    /^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl|type)\s+\w+/,
    /^\s*func\s+(?:\([^)]*\)\s*)?\w+\s*\(/,
    /^\s*type\s+\w+\s+(?:struct|interface)\b/,
  ]

  // Keep config/json/md files as-is (trimmed if huge)
  if ([".json", ".md", ".yaml", ".yml", ".toml"].includes(ext)) {
    return lines.slice(0, 80).join("\n") + (lines.length > 80 ? "\n// ... (truncated)" : "")
  }

  for (const line of lines) {
    if (keepPatterns.some((rx) => rx.test(line))) {
      kept.push(line)
    }
  }

  if (kept.length === 0) {
    return lines.slice(0, 30).join("\n") + (lines.length > 30 ? "\n// ... (omitted)" : "")
  }
  return `// [ContextPack Skeleton Mode — ${lines.length} lines compressed to ${kept.length} signatures]\n${kept.join("\n")}`
}

function buildDirectoryTree(relPaths) {
  const sorted = [...relPaths].sort()
  return sorted.map((p) => `- ${p}`).join("\n")
}

function detectLang(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase()
  const map = {
    ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".mjs": "js",
    ".py": "python", ".go": "go", ".rs": "rust", ".java": "java",
    ".rb": "ruby", ".php": "php", ".cs": "csharp", ".cpp": "cpp", ".c": "c",
    ".json": "json", ".md": "markdown", ".html": "html", ".css": "css",
    ".sql": "sql", ".sh": "bash", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  }
  return map[ext] || ""
}

function packFiles(files, options = {}) {
  // files: Array<{ path: string, content: string }>
  const {
    format = "markdown", // "markdown" | "xml"
    redact = false,
    skeleton = false,
    maxFiles = Infinity,
  } = options

  const selected = files.slice(0, maxFiles)
  let totalRedacted = 0

  const processed = selected.map((f) => {
    let body = skeleton ? extractSkeleton(f.content, f.path) : String(f.content ?? "")
    if (redact) {
      const r = redactSecrets(body)
      body = r.text
      totalRedacted += r.redactedCount
    }
    return { path: f.path, content: body }
  })

  const tree = buildDirectoryTree(processed.map((f) => f.path))
  let output = ""

  if (format === "xml") {
    const fileBlocks = processed
      .map((f) => `<file path="${f.path.replace(/"/g, "&quot;")}">\n${f.content}\n</file>`)
      .join("\n\n")
    output = `<contextpack files="${processed.length}">\n<file_tree>\n${tree}\n</file_tree>\n\n<files>\n${fileBlocks}\n</files>\n</contextpack>`
  } else {
    const fileBlocks = processed
      .map((f) => {
        const lang = detectLang(f.path)
        return `### \`${f.path}\`\n\n\`\`\`${lang}\n${f.content}\n\`\`\``
      })
      .join("\n\n")
    output = `# ContextPack (${processed.length} files)\n\n## File Tree\n${tree}\n\n## Files\n\n${fileBlocks}`
  }

  return {
    output,
    fileCount: processed.length,
    truncatedCount: Math.max(0, files.length - selected.length),
    estimatedTokens: estimateTokens(output),
    redactedCount: totalRedacted,
  }
}

module.exports = {
  DEFAULT_IGNORES,
  BINARY_EXTENSIONS,
  estimateTokens,
  redactSecrets,
  extractSkeleton,
  buildDirectoryTree,
  packFiles,
}
