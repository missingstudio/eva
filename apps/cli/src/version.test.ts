import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { VERSION } from "./version.js"

describe("the reported version", () => {
  it("is the one in the manifest", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )
    expect(VERSION).toBe((manifest as { version: string }).version)
  })
})
