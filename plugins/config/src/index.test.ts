import { describe, expect, it } from "vitest"
import { findings, KEYS, misshapenKeys, project, suggestKey, unreadKeys } from "./index.js"

/**
 * What the built-in fleet declares between them. This plugin's own half comes
 * from its declaration, so it cannot go stale; the other two are written here
 * because a plugin may not import a plugin, and `theme` belongs to `eva.tui`
 * while `plugins` belongs to the kernel.
 */
const READS = { ...KEYS.shapes, plugins: "list", theme: "name" } as const

describe("project", () => {
  it("reads nothing out of an empty mapping", () => {
    expect(project({})).toEqual({ agents: [], commands: [], keymap: [], themes: [] })
  })

  it("projects the model reference", () => {
    expect(project({ model: "anthropic/claude-opus-5" }).model).toEqual({
      provider: "anthropic",
      model: "claude-opus-5",
    })
  })

  it("ignores a model reference that names no provider", () => {
    expect(project({ model: "claude-opus-5" }).model).toBeUndefined()
  })

  /**
   * `theme` is `eva.tui`'s key, and this plugin projected it into a field
   * nothing read. Reading a key it does not declare is what the sweep exists
   * to catch, so it no longer does: `eva.tui` reads `theme` through its own
   * declaration.
   */
  it("passes over a key it does not declare", () => {
    expect(Object.keys(project({ theme: "mono" }))).not.toContain("theme")
  })

  // The sweep names a list written where a mapping is read. The reader now
  // drops it too, rather than reporting it misshapen and projecting it.
  it("reads nothing out of a key written in another shape", () => {
    expect(project({ agents: ["review"] }).agents).toEqual([])
  })

  it("projects agents, commands, and key bindings", () => {
    const found = project({
      agents: { reviewer: { prompt: "review carefully" } },
      commands: { deploy: { description: "ship it" } },
      keymap: { submit: { binding: "ctrl+enter", command: "session.submit" } },
    })
    expect(found.agents).toEqual([{ id: "reviewer", prompt: "review carefully" }])
    expect(found.commands).toEqual([{ id: "deploy", description: "ship it" }])
    expect(found.keymap).toEqual([
      { id: "submit", binding: "ctrl+enter", command: "session.submit" },
    ])
  })

  it("drops a binding with no key rather than inventing one", () => {
    expect(project({ keymap: { submit: { command: "session.submit" } } }).keymap).toEqual([])
  })

  it("projects a theme a person wrote", () => {
    const found = project({ themes: { dusk: { name: "Dusk", colors: { foreground: "#eee" } } } })
    expect(found.themes).toEqual([{ id: "dusk", name: "Dusk", colors: { foreground: "#eee" } }])
  })

  it("names a theme after its id when it carries no name", () => {
    expect(project({ themes: { dusk: {} } }).themes).toEqual([
      { id: "dusk", name: "dusk", colors: {} },
    ])
  })

  it("drops a colour that is not written as one", () => {
    const found = project({ themes: { dusk: { colors: { foreground: 12, muted: "#888" } } } })
    expect(found.themes[0]?.colors).toEqual({ muted: "#888" })
  })
})

describe("unreadKeys", () => {
  it("passes over every key something reads", () => {
    expect(unreadKeys({ model: "a/b", agents: {}, theme: "dusk", plugins: [] }, READS)).toEqual([])
  })

  it("names a key that reached nothing", () => {
    expect(unreadKeys({ budget: { usd: 2 }, model: "a/b" }, READS)).toEqual(["budget"])
  })
})

describe("misshapenKeys", () => {
  it("passes over a key written in the shape it is read as", () => {
    expect(misshapenKeys({ model: "a/b", themes: { dusk: {} }, theme: "dusk" }, READS)).toEqual([])
  })

  it("takes a theme named as a mapping with an id", () => {
    expect(misshapenKeys({ theme: { id: "dusk" } }, READS)).toEqual([])
  })

  // The pair that differs by a letter: one selects, one defines.
  it("reads themes given a name as a reach for theme", () => {
    expect(misshapenKeys({ themes: "dusk" }, READS)).toEqual([
      { key: "themes", wanted: "a mapping", meant: "theme" },
    ])
  })

  it("reads theme given a mapping of themes as a reach for themes", () => {
    expect(misshapenKeys({ theme: { dusk: { name: "Dusk" } } }, READS)).toEqual([
      { key: "theme", wanted: "a name, or a mapping with an id", meant: "themes" },
    ])
  })

  it("names the shape even when no other key would take the value", () => {
    expect(misshapenKeys({ agents: 12 }, READS)).toEqual([{ key: "agents", wanted: "a mapping" }])
  })

  // `plugins` would take the list, but it is nothing like `agents`, so the
  // shape is named and no replacement is invented.
  it("does not read a list as a mapping", () => {
    expect(misshapenKeys({ agents: ["review"] }, READS)).toEqual([
      { key: "agents", wanted: "a mapping" },
    ])
  })

  it("says nothing about a key nobody reads, which the sweep already names", () => {
    expect(misshapenKeys({ telemetry: 12 }, READS)).toEqual([])
  })
})

describe("suggestKey", () => {
  it.each([
    ["keympa", "keymap"],
    ["agent", "agents"],
    ["mdoel", "model"],
    ["Theme", "theme"],
  ])("reads %s as a misspelling of %s", (typo, meant) => {
    expect(suggestKey(typo, READS)).toBe(meant)
  })

  it("suggests nothing for a key that resembles none of them", () => {
    expect(suggestKey("telemetry", READS)).toBeUndefined()
  })
})

describe("findings", () => {
  const reviewed = (over: Partial<Parameters<typeof findings>[0]> = {}) => ({
    raw: {},
    origin: () => undefined,
    directory: "/somewhere",
    ignored: [],
    reads: READS,
    ...over,
  })

  it("names a resolved plugin this build does not carry", () => {
    const found = findings(reviewed({ uncarried: ["acme.nobody"] }))

    expect(found).toEqual([{ kind: "uncarried", id: "acme.nobody" }])
  })

  it("names the file that asked for it", () => {
    const found = findings(
      reviewed({ uncarried: ["acme.nobody"], origin: () => "/home/user.yaml" }),
    )

    expect(found[0]).toMatchObject({ kind: "uncarried", origin: "/home/user.yaml" })
  })

  it("says nothing when every resolved plugin is carried", () => {
    expect(findings(reviewed())).toEqual([])
  })
})
