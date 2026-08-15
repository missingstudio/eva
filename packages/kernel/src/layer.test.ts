import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { EMPTY, fileLayer, layered, mergeConfig, parseConfig } from "./config.js"
import {
  grantTrust,
  isTrusted,
  projectConfigs,
  projectDirectories,
  resolveLocation,
  revokeTrust,
  trustPath,
} from "./location.js"

// The real spelling, because a grant records the real spelling and the
// system temporary directory is a symlink on more than one platform.
const scratch = () => realpathSync.native(mkdtempSync(join(tmpdir(), "eva-layer-")))

const write = (directory: string, name: string, source: string): string => {
  const path = join(directory, name)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, source)
  return path
}

// The user file lives in the scratch directory, so the trust record beside
// it does too and no test ever reads the person's real one.
const scratchEnv = (directory: string) => ({ EVA_CONFIG: join(directory, "user.yaml") })

const files = (paths: readonly string[]) => paths.map((path) => fileLayer(path))

describe("mergeConfig", () => {
  it("gives the later layer the model", () => {
    const base = parseConfig("model: anthropic/one", "base")
    const over = parseConfig("model: anthropic/two", "over")
    expect(mergeConfig(base, over).raw["model"]).toBe("anthropic/two")
  })

  it("keeps the earlier model when the later layer names none", () => {
    const base = parseConfig("model: anthropic/one", "base")
    expect(mergeConfig(base, EMPTY).raw["model"]).toBe("anthropic/one")
  })

  // Order carries precedence: resolvePlugins gives the last entry for an id
  // the final word, so concatenating loses nothing.
  it("concatenates plugin entries in layer order", () => {
    const base = parseConfig("plugins: [a, b]", "base")
    const over = parseConfig("plugins: [c]", "over")
    expect(mergeConfig(base, over).plugins.map((one) => one.id)).toEqual(["a", "b", "c"])
  })

  it("gives the later layer each raw key it sets", () => {
    const base = parseConfig("theme: dark\ntenant: one", "base")
    const over = parseConfig("tenant: two", "over")
    expect(mergeConfig(base, over).raw).toEqual({ theme: "dark", tenant: "two" })
  })

  // The reason the merge law changed: naming one agent used to erase the rest.
  it("merges a mapping key by key rather than replacing it", () => {
    const base = parseConfig("agents:\n  one:\n    prompt: first\n  two:\n    prompt: second", "b")
    const over = parseConfig("agents:\n  two:\n    prompt: changed", "o")
    expect(mergeConfig(base, over).raw["agents"]).toEqual({
      one: { prompt: "first" },
      two: { prompt: "changed" },
    })
  })

  it("replaces a list rather than merging it", () => {
    const base = parseConfig("tools: [read, edit]", "base")
    const over = parseConfig("tools: [grep]", "over")
    expect(mergeConfig(base, over).raw["tools"]).toEqual(["grep"])
  })

  it("names the layer that set each leaf", () => {
    const base = parseConfig("agents:\n  one:\n    prompt: first\ntheme: dark", "base")
    const over = parseConfig("agents:\n  one:\n    prompt: changed", "over")
    expect(mergeConfig(base, over).origin).toEqual({
      "agents.one.prompt": "over",
      theme: "base",
    })
  })

  it("drops the origins under a key the later layer replaced wholesale", () => {
    const base = parseConfig("agents:\n  one:\n    prompt: first", "base")
    const over = parseConfig("agents: none", "over")
    expect(mergeConfig(base, over).origin).toEqual({ agents: "over" })
  })
})

describe("layered", () => {
  it("reads the files in order and lets the last one win", async () => {
    const directory = scratch()
    const first = write(directory, "first.yaml", "model: anthropic/one\nplugins: [a]\n")
    const second = write(directory, "second.yaml", "model: anthropic/two\nplugins: [b]\n")

    const config = await Effect.runPromise(layered(files([first, second])))
    expect(config.raw["model"]).toBe("anthropic/two")
    expect(config.plugins.map((one) => one.id)).toEqual(["a", "b"])
  })

  it("passes over a file that is not there", async () => {
    const directory = scratch()
    const real = write(directory, "real.yaml", "model: anthropic/one\n")
    const config = await Effect.runPromise(layered(files([join(directory, "absent.yaml"), real])))
    expect(config.raw["model"]).toBe("anthropic/one")
  })

  it("reads no layers as the empty config", async () => {
    expect(await Effect.runPromise(layered([]))).toEqual(EMPTY)
  })
})

describe("the trust grant", () => {
  it("is not something a repository can give itself", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, ".eva/config.yaml", "model: anthropic/project\n")

    // The marker the old gate read, now written by the repository itself.
    write(directory, ".eva/trust", "")
    expect(isTrusted(directory, env)).toBe(false)

    const location = await Effect.runPromise(resolveLocation(directory, env))
    expect(location.trusted).toBe(false)
    expect(location.ignored).toEqual([join(directory, ".eva", "config.yaml")])
  })

  it("is recorded beside the person's own config", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)

    const granted = await Effect.runPromise(grantTrust(directory, env))
    expect(granted).toBe(directory)
    expect(trustPath(env)).toBe(join(directory, "trusted"))
    expect(isTrusted(directory, env)).toBe(true)
  })

  it("covers the directories below the one it names", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    mkdirSync(join(directory, "inner", "deeper"), { recursive: true })

    await Effect.runPromise(grantTrust(directory, env))
    expect(isTrusted(join(directory, "inner", "deeper"), env)).toBe(true)
  })

  it("does not cover a sibling checkout", async () => {
    const directory = scratch()
    const other = scratch()
    const env = scratchEnv(directory)

    await Effect.runPromise(grantTrust(directory, env))
    expect(isTrusted(other, env)).toBe(false)
  })

  it("grants once however many times it is asked", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)

    await Effect.runPromise(grantTrust(directory, env))
    await Effect.runPromise(grantTrust(directory, env))
    await Effect.runPromise(revokeTrust(directory, env))
    expect(isTrusted(directory, env)).toBe(false)
  })

  it("reads the project config once the grant is there", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, ".eva/config.yaml", "model: anthropic/project\n")

    await Effect.runPromise(grantTrust(directory, env))
    const location = await Effect.runPromise(resolveLocation(directory, env))
    expect(location.trusted).toBe(true)
    expect(location.ignored).toEqual([])
    expect(await Effect.runPromise(layered(location.chain))).toMatchObject({
      raw: { model: "anthropic/project" },
    })
  })

  it("grants nothing when the record cannot be read", () => {
    const directory = scratch()
    expect(isTrusted(directory, { EVA_CONFIG: join(directory, "absent", "user.yaml") })).toBe(false)
  })
})

describe("the location chain", () => {
  it("puts the user file below the project file", async () => {
    const directory = scratch()
    const env = scratchEnv(directory)
    write(directory, "user.yaml", "model: anthropic/user\n")
    write(directory, ".eva/config.yaml", "model: anthropic/project\n")
    await Effect.runPromise(grantTrust(directory, env))

    const location = await Effect.runPromise(resolveLocation(directory, env))
    expect(await Effect.runPromise(layered(location.chain))).toMatchObject({
      raw: { model: "anthropic/project" },
    })
  })

  it("orders the walked-up project directories with the nearest last", () => {
    const directory = scratch()
    write(directory, ".eva/config.yaml", "model: anthropic/outer\n")
    write(directory, "inner/.eva/config.yaml", "model: anthropic/inner\n")

    const found = projectConfigs(join(directory, "inner"))
    expect(found.at(-1)).toBe(join(directory, "inner", ".eva", "config.yaml"))
    expect(found).toContain(join(directory, ".eva", "config.yaml"))
  })

  // A `.eva` above a checkout belongs to somebody else.
  it("stops the walk at the repository boundary", () => {
    const directory = scratch()
    write(directory, ".eva/config.yaml", "model: anthropic/outside\n")
    write(directory, "repo/.eva/config.yaml", "model: anthropic/inside\n")
    mkdirSync(join(directory, "repo", ".git"), { recursive: true })

    const found = projectDirectories(join(directory, "repo"))
    expect(found).toEqual([join(directory, "repo", ".eva")])
  })

  // The boundary is checked after the directory's own entry, so the root's
  // own `.eva` is found rather than cut off by the `.git` that marks it.
  it("still reads the repository root's own directory", () => {
    const directory = scratch()
    write(directory, "repo/.eva/config.yaml", "model: anthropic/root\n")
    mkdirSync(join(directory, "repo", ".git"), { recursive: true })

    expect(projectDirectories(join(directory, "repo"))).toContain(join(directory, "repo", ".eva"))
  })
})
