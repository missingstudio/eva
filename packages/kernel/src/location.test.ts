import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { grantTrust, resolveLocation } from "./location.js"

const scratch = () => realpathSync.native(mkdtempSync(join(tmpdir(), "eva-location-")))

const write = (directory: string, name: string, source: string): string => {
  const path = join(directory, name)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, source)
  return path
}

// The user file lives in the scratch directory, so the trust record beside
// it does too and no test ever reads the person's real one.
const scratchEnv = (directory: string) => ({ EVA_CONFIG: join(directory, "user.yaml") })

describe("what an untrusted directory is told was skipped", () => {
  // A person with prompts and no config.yaml is told what a grant would have
  // opened, rather than the Workflow refusing with a Gap that blames the
  // wrong thing.
  it("names a resource directory that is there without a config file", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, ".eva/prompts/commit-msg.md", "Write one line.")

    const location = await Effect.runPromise(resolveLocation(directory, env))
    expect(location.trusted).toBe(false)
    expect(location.ignored).toEqual([join(directory, ".eva", "prompts")])
  })

  it("names nothing once the directory is trusted", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, ".eva/prompts/commit-msg.md", "Write one line.")
    write(directory, ".eva/config.yaml", "model: anthropic/project\n")

    await Effect.runPromise(grantTrust(directory, env))
    const location = await Effect.runPromise(resolveLocation(directory, env))
    expect(location.ignored).toEqual([])
  })

  it("names nothing when the directory holds no resource directory at all", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    mkdirSync(join(directory, ".eva"), { recursive: true })

    const location = await Effect.runPromise(resolveLocation(directory, env))
    expect(location.ignored).toEqual([])
  })
})
