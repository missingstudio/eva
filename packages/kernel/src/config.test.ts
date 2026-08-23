import { Cause, Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
  ConfigError,
  configPath,
  inlineLayer,
  layered,
  originOf,
  parseConfig,
  readConfig,
  resolvePlugins,
} from "./config.js"

const BUILT_IN = ["eva.trace", "eva.trace.jsonl", "eva.provider.anthropic", "eva.tui"]

const ids = (config: Parameters<typeof resolvePlugins>[0]) =>
  resolvePlugins(config, BUILT_IN).map((entry) => entry.id)

const config = (source: string) => parseConfig(source, "test.yaml")

describe("parseConfig", () => {
  it("reads an empty file as an empty config", () => {
    expect(config("")).toEqual({ plugins: [], raw: {}, origin: {} })
  })

  it("reads a string entry as an enabled plugin", () => {
    expect(config("plugins:\n  - eva.tool.web").plugins).toEqual([{ id: "eva.tool.web" }])
  })

  it("reads options, package, and disabled off an object entry", () => {
    const parsed = config(`
plugins:
  - id: eva.trace
    options: { dir: "~/.eva/traces" }
  - id: acme.reviewer
    package: "@acme/eva-plugin-reviewer"
  - id: eva.provider.*
    disabled: true
`)
    expect(parsed.plugins).toEqual([
      { id: "eva.trace", options: { dir: "~/.eva/traces" } },
      { id: "acme.reviewer", package: "@acme/eva-plugin-reviewer" },
      { id: "eva.provider.*", disabled: true },
    ])
  })

  it("keeps what it does not read, because interpreting is a plugin's job", () => {
    const parsed = config(
      "model: anthropic/claude-sonnet-4-5\nprofiles:\n  default:\n    budget:\n      usd: 2",
    )
    expect(parsed.raw["model"]).toBe("anthropic/claude-sonnet-4-5")
    expect(parsed.raw["profiles"]).toEqual({ default: { budget: { usd: 2 } } })
  })

  it.each([
    ["plugins is not a list", "plugins: nope"],
    ["an entry object has no id", "plugins:\n  - options: {}"],
    ["an entry is neither string nor object", "plugins:\n  - 42"],
  ])("refuses a config where %s", (_reason, source) => {
    expect(() => config(source)).toThrow(ConfigError)
  })
})

describe("resolvePlugins", () => {
  it("loads every built-in when config says nothing", () => {
    expect(ids(config(""))).toEqual(BUILT_IN)
  })

  // What lets the bare kernel boot with everything disabled.
  it("boots the bare kernel on a single wildcard", () => {
    expect(ids(config('plugins:\n  - id: "*"\n    disabled: true'))).toEqual([])
  })

  it("lets a later entry re-enable what a wildcard disabled", () => {
    const resolved = ids(
      config(`
plugins:
  - id: "eva.provider.*"
    disabled: true
  - id: eva.provider.anthropic
    disabled: false
`),
    )
    expect(resolved).toContain("eva.provider.anthropic")
  })

  it("lets a later entry disable what an earlier one enabled", () => {
    const resolved = ids(config("plugins:\n  - eva.tui\n  - id: eva.tui\n    disabled: true"))
    expect(resolved).not.toContain("eva.tui")
  })

  it("appends an unknown id and keeps the built-in order", () => {
    expect(ids(config("plugins:\n  - acme.reviewer"))).toEqual([...BUILT_IN, "acme.reviewer"])
  })

  it("carries options through to the resolved entry", () => {
    const resolved = resolvePlugins(
      config('plugins:\n  - id: eva.trace\n    options: { path: "/tmp/t.jsonl" }'),
      BUILT_IN,
    )
    expect(resolved.find((entry) => entry.id === "eva.trace")?.options).toEqual({
      path: "/tmp/t.jsonl",
    })
  })

  // A later entry sets the fields it names, so a layer turns a plugin off
  // without restating its options.
  it("keeps the options an earlier entry set when a later one names the same id", () => {
    const resolved = resolvePlugins(
      config(`
plugins:
  - id: eva.trace
    options: { path: "/tmp/t.jsonl" }
  - id: eva.trace
    disabled: false
`),
      BUILT_IN,
    )
    expect(resolved.find((entry) => entry.id === "eva.trace")?.options).toEqual({
      path: "/tmp/t.jsonl",
    })
  })

  // A field replaces as a unit, so two options mappings never merge into one.
  it("replaces the whole options when a later entry names them", () => {
    const resolved = resolvePlugins(
      config(`
plugins:
  - id: eva.trace
    options: { dir: traces, keep: 7 }
  - id: eva.trace
    options: { dir: elsewhere }
`),
      BUILT_IN,
    )
    expect(resolved.find((entry) => entry.id === "eva.trace")?.options).toEqual({
      dir: "elsewhere",
    })
  })

  it("keeps the options a wildcard entry does not name", () => {
    const resolved = resolvePlugins(
      config(`
plugins:
  - id: eva.trace
    options: { path: "/tmp/t.jsonl" }
  - id: "eva.*"
    disabled: false
`),
      BUILT_IN,
    )
    expect(resolved.find((entry) => entry.id === "eva.trace")?.options).toEqual({
      path: "/tmp/t.jsonl",
    })
  })

  it("matches a bare wildcard against every id", () => {
    expect(ids(config('plugins:\n  - id: "eva.*"\n    disabled: true'))).toEqual([])
  })
})

describe("configPath", () => {
  it("defaults under the home directory", () => {
    expect(configPath({})).toMatch(/\.eva\/config\.yaml$/)
  })

  it("honors EVA_CONFIG, which a hermetic run depends on", () => {
    expect(configPath({ EVA_CONFIG: "/tmp/eva-test.yaml" })).toBe("/tmp/eva-test.yaml")
  })
})

describe("readConfig", () => {
  it("treats a missing file as no config at all", async () => {
    const found = await Effect.runPromise(readConfig("/tmp/eva-does-not-exist-0f3c367e.yaml"))
    expect(found).toEqual({ plugins: [], raw: {}, origin: {} })
  })
})

describe("origin", () => {
  it("names the file that set each leaf, however deep", () => {
    const parsed = config("agents:\n  review:\n    prompt: read it\ntheme: dusk\n")
    expect(parsed.origin).toEqual({ "agents.review.prompt": "test.yaml", theme: "test.yaml" })
  })

  it("treats a list as one leaf, because a list replaces", () => {
    expect(config("plugins: [a, b]").origin).toEqual({ plugins: "test.yaml" })
  })

  it("answers for a mapping key with the file below it", () => {
    const parsed = config("budget:\n  usd: 2\n")
    expect(originOf(parsed, "budget")).toBe("test.yaml")
  })

  it("answers nothing for a key that was never set", () => {
    expect(originOf(config("theme: dusk"), "keymap")).toBeUndefined()
  })
})

describe("inlineLayer", () => {
  it("reads config out of the environment", async () => {
    const layer = inlineLayer({ EVA_CONFIG_CONTENT: "model: anthropic/inline" })
    const found = await Effect.runPromise(layered(layer === undefined ? [] : [layer]))
    expect(found.raw["model"]).toBe("anthropic/inline")
    expect(found.origin["model"]).toBe("EVA_CONFIG_CONTENT")
  })

  it.each([{}, { EVA_CONFIG_CONTENT: "" }, { EVA_CONFIG_CONTENT: "  \n" }])(
    "is no layer at all when the variable says nothing",
    (env) => {
      expect(inlineLayer(env)).toBeUndefined()
    },
  )

  it("refuses a shape the kernel does not recognize, naming the variable", async () => {
    const layer = inlineLayer({ EVA_CONFIG_CONTENT: "plugins: nope" })
    const outcome = await Effect.runPromise(
      Effect.exit(layered(layer === undefined ? [] : [layer])),
    )
    expect(Exit.isFailure(outcome)).toBe(true)
    if (Exit.isFailure(outcome)) {
      expect((Cause.squash(outcome.cause) as ConfigError).path).toBe("EVA_CONFIG_CONTENT")
    }
  })
})
