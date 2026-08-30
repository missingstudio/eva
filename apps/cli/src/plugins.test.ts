import { boot, buildOf } from "@missingstudio/eva-boot"
import { define } from "@missingstudio/eva-sdk"
import { TUI_SURFACE } from "@missingstudio/eva-tui-surface"
import { WEB_SURFACE } from "@missingstudio/eva-web"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import {
  ALL,
  api,
  besideTerminal,
  BUILD,
  BUILT_IN,
  BUILT_IN_IDS,
  byID,
  REQUIRED,
  tui,
  uncarriedOf,
  web,
} from "./plugins.js"

/**
 * The built-in table is what differs per artifact, so what it decides is
 * asserted here rather than anywhere below. That the two catalog plugins
 * agree once loaded is a contract question, and lives in
 * `packages/conformance`.
 */
describe("the built-in table", () => {
  // A transform replays in registration order, so the prices must come after
  // the models they price. Registered first, it would find nothing to price.
  it("registers the prices after the models", () => {
    const ids = BUILT_IN.map((plugin) => plugin.id)
    expect(ids.indexOf("eva.catalog.prices")).toBeGreaterThan(ids.indexOf("eva.catalog.models"))
  })

  // The trace comes first because everything records through it.
  it("registers the trace before anything that writes one", () => {
    const ids = BUILT_IN.map((plugin) => plugin.id)
    expect(ids.indexOf("eva.trace")).toBeLessThan(ids.indexOf("eva.trace.sqlite"))
  })

  /**
   * Both rows are interactive, so registration order is the whole of what
   * says a person who typed `eva` gets the terminal: `pickSurface` takes the
   * first interactive row, and a web row registered ahead of the terminal
   * would take that branch in silence.
   */
  it("registers the web surface after the terminal", () => {
    const ids = BUILT_IN.map((plugin) => plugin.id)
    expect(ids.indexOf("eva.web")).toBeGreaterThan(ids.indexOf("eva.tui"))
  })

  it("names every built-in id from the table itself", () => {
    expect(BUILT_IN_IDS).toEqual(BUILT_IN.map((plugin) => plugin.id))
  })

  it("carries every built-in, and the optional ones config may ask for", () => {
    for (const plugin of BUILT_IN) expect(byID(plugin.id)).toBe(plugin)
    expect(byID("eva.trace.memory")).toBeDefined()
    expect(ALL.length).toBeGreaterThan(BUILT_IN.length)
  })

  it("holds no id twice", () => {
    const ids = ALL.map((plugin) => plugin.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("has nothing for an id no plugin in this build declares", () => {
    expect(byID("acme.nobody")).toBeUndefined()
  })
})

/**
 * The findings are printed before anything loads, and `eva config show` never
 * boots at all — so "this build carries no implementation for that id" has to
 * be answerable twice. It used to be derived twice as well, from two places:
 * the report walked the app's own table, and `Kernel.missing` walked a map
 * boot built from the list it was handed. Nothing held the two together, and
 * nothing read boot's.
 *
 * One predicate answers both now, and this is what says so.
 */
describe("what the report says and what the run loaded", () => {
  const resolved = [
    { id: "eva.trace" },
    { id: "acme.nobody" },
    { id: "eva.commands" },
    { id: "acme.also-nobody" },
  ]

  const booted = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({ scope, resolved, build: BUILD })
        const missing = kernel.missing
        yield* Scope.close(scope, Exit.void)
        return missing
      }),
    )

  it("name the same ids", async () => {
    expect(await booted()).toEqual(uncarriedOf(resolved))
  })

  it("name exactly the ids this build has no implementation for", async () => {
    expect(await booted()).toEqual(["acme.nobody", "acme.also-nobody"])
  })
})

/**
 * `eva --web` runs the page beside the terminal, and the terminal draws over
 * the stream the page would have said its address on. So this door rebuilds
 * both halves: the page writes into a place the terminal reads, and the
 * terminal is the row that knows how to show it.
 */
describe("the build eva --web runs", () => {
  const ONE_PORT = { port: 7777 }

  it("rebuilds the two halves of one port, as eva serve --web does", () => {
    const built = besideTerminal(buildOf([...BUILT_IN]), ONE_PORT)
    const ids = built.all.map((plugin) => plugin.id)

    expect(ids).toContain(WEB_SURFACE)
    expect(ids).toContain("eva.api")
    expect(built.all.find((one) => one.id === WEB_SURFACE)).not.toBe(web)
    expect(built.all.find((one) => one.id === "eva.api")).not.toBe(api)
  })

  // The row this app made is rebuilt, because it is the row that takes what
  // the page said. Everything else in the table is left where it stands.
  it("rebuilds the terminal this app made, and nothing else", () => {
    const built = besideTerminal(buildOf([...BUILT_IN]), ONE_PORT)

    expect(built.all.find((one) => one.id === TUI_SURFACE)).not.toBe(tui)
    for (const plugin of BUILT_IN) {
      if (plugin === tui || plugin === web || plugin === api) continue
      expect(built.all).toContain(plugin)
    }
  })

  // A build carrying somebody else's terminal keeps it: nothing else has
  // been told how to show what another row said.
  it("leaves a terminal this app did not make alone", () => {
    const stranger = define({ id: TUI_SURFACE, effect: Effect.fn(TUI_SURFACE)(function* () {}) })
    const built = besideTerminal(buildOf([...BUILT_IN.filter((one) => one !== tui), stranger]), {})

    expect(built.all).toContain(stranger)
  })
})

/**
 * The claim this tree makes is that every capability is a plugin. It is true
 * of everything but the six ids the composition root knows by name, and those
 * are written down beside the table rather than left for a builder to find in
 * the source. This is what holds the list to what the root actually does.
 */
describe("the ids this app knows by name", () => {
  it("names the six, and no others", () => {
    expect(REQUIRED).toEqual([
      "eva.web",
      "eva.api",
      "eva.tui",
      "eva.approval",
      "eva.tool.policy",
      "eva.catalog.models",
    ])
  })

  // Named or not, this build has to carry them: the root reaches into each
  // one, so a table without one is a build that cannot run its own doors.
  it("carries every one of them in the built-in table", () => {
    for (const id of REQUIRED) expect(BUILT_IN_IDS).toContain(id)
  })

  // The three the root rebuilds are rebuilt by id, so the list and the
  // rebuild cannot drift apart without this saying so.
  it("names every row the serving rebuild replaces", () => {
    const rebuilt = besideTerminal(buildOf([...BUILT_IN]), {})
    for (const plugin of BUILT_IN) {
      if (rebuilt.all.includes(plugin)) continue
      expect(REQUIRED).toContain(plugin.id)
    }
  })
})
