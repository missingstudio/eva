import { boot } from "@missingstudio/eva-boot"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { ALL, BUILD, BUILT_IN, BUILT_IN_IDS, byID, uncarriedOf } from "./plugins.js"

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
    expect(ids.indexOf("eva.trace")).toBeLessThan(ids.indexOf("eva.trace.jsonl"))
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
