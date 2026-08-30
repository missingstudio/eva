import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The entry runs Eva when it is imported, so it is asserted as the binary it
 * is. `--version` is the invocation that reaches `cli.main` and nothing else,
 * which makes one span the whole of what a debug run has to say.
 */
const ENTRY = fileURLToPath(new URL("eva.ts", import.meta.url))

// The shell that runs the suite may already ask for logs, and a test that
// reads the ambient answer proves nothing.
const ambient = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "EVA_LOG"))

const ran = (log?: string) => {
  const found = spawnSync("bun", [ENTRY, "--version"], {
    encoding: "utf8",
    env: log === undefined ? ambient() : { ...ambient(), EVA_LOG: log },
  })
  return { out: found.stdout, err: found.stderr, code: found.status }
}

describe("what EVA_LOG opens", () => {
  it("says nothing about itself when nothing asked for it", () => {
    const found = ran()

    expect(found.err).toBe("")
    expect(found.code).toBe(0)
  })

  // Nearly every function in the tree is an `Effect.fn("…")`, and until now
  // nothing turned those spans on.
  it("says the spans the tree already has", () => {
    expect(ran("debug").err).toContain("cli.main")
  })

  // Standard output is the answer. A span is commentary, and commentary goes
  // to standard error.
  it("leaves standard output the answer alone", () => {
    expect(ran("debug").out).toBe(ran().out)
  })

  // A level says how much is logged, and a span is a detail: `info` asks for
  // less than the detail, so the spans stay shut.
  it("keeps the spans shut at a level coarser than debug", () => {
    expect(ran("info").err).toBe("")
  })

  // A value that names no level is not a level to guess at.
  it("changes nothing for a value that names no level", () => {
    expect(ran("loud").err).toBe("")
  })
})
