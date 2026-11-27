import { describe, expect, test } from "bun:test"
import core from "../src/core.js"
import license from "../src/license.js"

describe("ContextPack Core", () => {
  test("redacts OpenAI, GitHub, AWS, JWT, and .env secrets", () => {
    const raw = [
      'const openai = "sk-proj-1234567890abcdefghijklmnop"',
      'const gh = "ghp_1234567890abcdefghij1234567890ab"',
      'const aws = "AKIAIOSFODNN7EXAMPLE"',
      'DATABASE_PASSWORD="super_secret_password"',
    ].join("\n")

    const { text, redactedCount } = core.redactSecrets(raw)
    expect(redactedCount).toBe(4)
    expect(text).not.toContain("sk-proj-")
    expect(text).not.toContain("ghp_")
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(text).not.toContain("super_secret_password")
    expect(text).toContain("[REDACTED_OPENAI_KEY]")
    expect(text).toContain("[REDACTED_ENV_SECRET]")
  })

  test("extractSkeleton compresses TypeScript implementation to signatures", () => {
    const code = `import { readFileSync } from "fs"

export interface User {
  id: string
  name: string
}

export async function loadUser(id: string): Promise<User> {
  const raw = readFileSync(id, "utf8")
  const parsed = JSON.parse(raw)
  return parsed
}
`
    const skeleton = core.extractSkeleton(code, "src/user.ts")
    expect(skeleton).toContain('import { readFileSync } from "fs"')
    expect(skeleton).toContain("export interface User")
    expect(skeleton).toContain("export async function loadUser")
    expect(skeleton).not.toContain("JSON.parse")
  })

  test("packFiles formats Markdown and enforces free maxFiles cap", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: `export const x${i} = ${i}`,
    }))
    const res = core.packFiles(files, { format: "markdown", maxFiles: 15 })
    expect(res.fileCount).toBe(15)
    expect(res.truncatedCount).toBe(5)
    expect(res.output).toContain("# ContextPack (15 files)")
    expect(res.output).toContain("```ts")
    expect(res.estimatedTokens).toBeGreaterThan(50)
  })

  test("packFiles formats Claude XML with secret redaction", () => {
    const res = core.packFiles(
      [{ path: ".env", content: "API_KEY=my_secret_value_123" }],
      { format: "xml", redact: true }
    )
    expect(res.output).toContain('<file path=".env">')
    expect(res.output).toContain("[REDACTED_ENV_SECRET]")
    expect(res.redactedCount).toBe(1)
  })
})

describe("ContextPack License", () => {
  test("verifies valid Gumroad key", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ success: true, purchase: { email: "dev@example.com" } }),
    })
    const res = await license.verifyGumroadLicense("KEY-OK", fakeFetch)
    expect(res.valid).toBe(true)
  })

  test("rejects refunded key", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ success: true, purchase: { refunded: true } }),
    })
    const res = await license.verifyGumroadLicense("KEY-REF", fakeFetch)
    expect(res.valid).toBe(false)
  })
})
