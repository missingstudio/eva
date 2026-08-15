import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { INLINE, originOf } from "./config.js"
import { grantTrust } from "./location.js"
import { COMMAND_LINE, flagLayer, resolveConfiguration, type Overlays } from "./resolution.js"

// The real spelling, because a grant records the real spelling and the
// system temporary directory is a symlink on more than one platform.
const scratch = () => realpathSync.native(mkdtempSync(join(tmpdir(), "eva-resolution-")))

const write = (directory: string, name: string, source: string): string => {
  const path = join(directory, name)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, source)
  return path
}

// The user file lives in the scratch directory, so the trust record beside
// it does too and no test ever reads the person's real one.
const scratchEnv = (directory: string) => ({ EVA_CONFIG: join(directory, "user.yaml") })

const BUILT_IN = ["eva.trace", "eva.tui"]

const resolve = (directory: string, env: NodeJS.ProcessEnv, overlays: Overlays = {}) =>
  Effect.runPromise(resolveConfiguration({ builtIn: BUILT_IN, overlays, directory, env }))

describe("flagLayer", () => {
  it("is nothing when no flag set anything", () => {
    expect(flagLayer({})).toBeUndefined()
    expect(flagLayer({ config: ["a.yaml"] })).toBeUndefined()
  })

  it("carries the model and both plugin flags as one mapping", () => {
    expect(flagLayer({ model: "anthropic/one", plugin: ["a"], noPlugin: ["b"] })).toEqual({
      kind: "values",
      label: COMMAND_LINE,
      raw: { model: "anthropic/one", plugins: [{ id: "a" }, { id: "b", disabled: true }] },
    })
  })
})

describe("resolveConfiguration", () => {
  it("reads the user file when nothing else is there", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, "user.yaml", "model: anthropic/user\n")

    const settled = await resolve(directory, env)
    expect(settled.config.raw["model"]).toBe("anthropic/user")
    expect(settled.location.trusted).toBe(false)
  })

  // Rungs 7, 8, and 9 of the order, each over the one below it.
  it("gives a --config overlay the word over the user file", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, "user.yaml", "model: anthropic/user\n")
    const overlay = write(directory, "overlay.yaml", "model: anthropic/overlay\n")

    expect((await resolve(directory, env, { config: [overlay] })).config.raw["model"]).toBe(
      "anthropic/overlay",
    )
  })

  it("gives the environment the word over a --config overlay", async () => {
    const directory = scratch()
    const env = { ...scratchEnv(directory), [INLINE]: "model: anthropic/inline\n" }
    const overlay = write(directory, "overlay.yaml", "model: anthropic/overlay\n")

    expect((await resolve(directory, env, { config: [overlay] })).config.raw["model"]).toBe(
      "anthropic/inline",
    )
  })

  it("gives a flag the last word over every file and the environment", async () => {
    const directory = scratch()
    const env = { ...scratchEnv(directory), [INLINE]: "model: anthropic/inline\n" }
    write(directory, "user.yaml", "model: anthropic/user\n")

    expect((await resolve(directory, env, { model: "anthropic/flag" })).config.raw["model"]).toBe(
      "anthropic/flag",
    )
  })

  // The reason a flag is a layer: the file it overrode used to be the name
  // printed against the key.
  it("names the command line as the origin of a key a flag set", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, "user.yaml", "model: anthropic/user\n")

    const settled = await resolve(directory, env, { model: "anthropic/flag" })
    expect(originOf(settled.config, "model")).toBe(COMMAND_LINE)
  })

  it("keeps the file as the origin when no flag set the key", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    const path = write(directory, "user.yaml", "model: anthropic/user\n")

    expect(originOf((await resolve(directory, env)).config, "model")).toBe(path)
  })

  it("adds a plugin a flag named, after the built-ins", async () => {
    const directory = scratch()
    const settled = await resolve(directory, scratchEnv(directory), { plugin: ["acme.reviewer"] })
    expect(settled.plugins.map((one) => one.id)).toEqual(["eva.trace", "eva.tui", "acme.reviewer"])
  })

  it("drops a built-in the noPlugin overlay named", async () => {
    const directory = scratch()
    const settled = await resolve(directory, scratchEnv(directory), { noPlugin: ["eva.tui"] })
    expect(settled.plugins.map((one) => one.id)).toEqual(["eva.trace"])
  })

  // A flag is the last layer, so it has the last word on a plugin the
  // config asked for.
  it("drops a plugin the config enabled and a flag disabled", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, "user.yaml", "plugins:\n  - eva.tui\n")

    const settled = await resolve(directory, env, { noPlugin: ["eva.tui"] })
    expect(settled.plugins.map((one) => one.id)).toEqual(["eva.trace"])
  })

  it("keeps the options a config entry set when a flag names the same plugin", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, "user.yaml", "plugins:\n  - id: eva.trace\n    options: { dir: traces }\n")

    const settled = await resolve(directory, env, { plugin: ["eva.trace"] })
    expect(settled.plugins[0]).toEqual({ id: "eva.trace", options: { dir: "traces" } })
  })

  it("does not read a project directory without a grant, and says which", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    const path = write(directory, ".eva/config.yaml", "model: anthropic/project\n")

    const settled = await resolve(directory, env)
    expect(settled.config.raw["model"]).toBeUndefined()
    expect(settled.location.ignored).toEqual([path])
  })

  it("reads the project directory once the grant is there", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, ".eva/config.yaml", "model: anthropic/project\n")
    await Effect.runPromise(grantTrust(directory, env))

    const settled = await resolve(directory, env)
    expect(settled.config.raw["model"]).toBe("anthropic/project")
    expect(settled.location.ignored).toEqual([])
  })

  it("resolves against the directory it is given, not the process", async () => {
    const directory = scratch()
    expect((await resolve(directory, scratchEnv(directory))).location.directory).toBe(directory)
  })
})
