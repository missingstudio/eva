import { describe, expect, it } from "vitest"
import { protectedIn, protects } from "./paths.js"

describe("protects", () => {
  it.each([
    ".git",
    ".git/config",
    ".git/hooks/pre-commit",
    ".eva/config.yaml",
    ".npmrc",
    ".mcp.json",
    "packages/core/.npmrc",
    ".github/workflows/ci.yml",
    ".circleci/config.yml",
    "package.json",
    "bun.lock",
    "Cargo.toml",
    "~/.zshrc",
    "/home/eva/.envrc",
    "Jenkinsfile",
    ".git\\config",
  ])("protects %s", (path) => {
    expect(protects(path)).toBe(true)
  })

  it.each([
    "README.md",
    "packages/core/src/tool.ts",
    ".github/ISSUE_TEMPLATE/bug.md",
    "gitignore",
    "docs/package.json.md",
    "--force",
    "",
  ])("leaves %s alone", (path) => {
    expect(protects(path)).toBe(false)
  })

  it("names the first protected path a call holds", () => {
    expect(protectedIn(["cp", "src", ".mcp.json"])).toBe(".mcp.json")
    expect(protectedIn(["npm", "test"])).toBeUndefined()
  })
})
