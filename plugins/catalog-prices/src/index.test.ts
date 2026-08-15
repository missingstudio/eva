import { toUsd } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { catalogPrices } from "./index.js"
import { CHECKED_AT, PRICES, SOURCE } from "./prices.js"

/**
 * The snapshot is a fact about a moving thing, so it carries the day it was
 * checked and a test holds it. That every model the Catalog offers is priced
 * is asserted where both plugins meet, in `apps/cli`, because a plugin does
 * not import a plugin.
 */
describe("the price snapshot", () => {
  it("names its source and the day it was taken", () => {
    expect(SOURCE).toBe("https://models.dev")
    expect(CHECKED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // Ticks are integers of 1e-10 USD. A float here would round twice.
  it("carries every rate as an integer number of Ticks", () => {
    for (const seed of PRICES) {
      for (const rate of [
        seed.inputTicks,
        seed.outputTicks,
        seed.cacheReadTicks,
        seed.cacheWriteTicks,
      ]) {
        if (rate === undefined) continue
        expect(Number.isSafeInteger(rate)).toBe(true)
        expect(rate).toBeGreaterThan(0)
      }
    }
  })

  // Catches a units mistake — a rate per token rather than per million reads
  // as a plausible number and bills a thousandfold.
  it("reads as a rate per million tokens", () => {
    for (const seed of PRICES) {
      expect(toUsd(seed.inputTicks)).toBeGreaterThanOrEqual(0.01)
      expect(toUsd(seed.outputTicks)).toBeLessThanOrEqual(1000)
      expect(seed.outputTicks).toBeGreaterThanOrEqual(seed.inputTicks)
    }
  })
})

/**
 * Through a live kernel. The rule this plugin carries — price what the
 * Catalog already holds, and add nothing it does not — is a property of the
 * transform, so the constants above cannot show it.
 *
 * A plugin may not import another plugin, so the Catalog is seeded here
 * rather than by loading `eva.catalog.models`. That the two agree on every
 * model is asserted where they actually meet, in `apps/cli`.
 */
describe("the prices transform", () => {
  const seeding = (provider: string, model: string) =>
    define({
      id: "test.catalog.seed",
      effect: Effect.fn("test.catalog.seed")(function* (ctx) {
        yield* ctx.catalog.transform((catalog) => {
          catalog.model.update(provider, model, () => {})
        })
      }),
    })

  const seed = PRICES[0]
  if (seed === undefined) throw new Error("the snapshot carries no prices")

  it("prices a model the Catalog already holds", async () => {
    const found = await withPlugin(
      catalogPrices,
      (kernel) =>
        Effect.map(kernel.domains.catalog.get, (state) =>
          state.models.get(seed.provider)?.get(seed.model),
        ),
      { before: [seeding(seed.provider, seed.model)] },
    )

    expect(found?.price?.inputTicks).toBe(seed.inputTicks)
    expect(found?.price?.outputTicks).toBe(seed.outputTicks)
  })

  /**
   * Everything the seed says that is not the model it names is the rate. The
   * copier this replaces named the fields one at a time and dropped
   * `reasoningTicks` — the one counter a rate exists to charge — so no seeded
   * price could ever charge reasoning, and a rate added to `ModelPrice` later
   * would have been dropped the same silent way.
   */
  it("carries every rate its seed says, whatever the seed says", async () => {
    const found = await withPlugin(
      catalogPrices,
      (kernel) =>
        Effect.map(kernel.domains.catalog.get, (state) =>
          state.models.get(seed.provider)?.get(seed.model),
        ),
      { before: [seeding(seed.provider, seed.model)] },
    )

    const { provider: _provider, model: _model, ...rate } = seed
    expect(found?.price).toEqual(rate)
  })

  // A rate for a model nothing offers would add a row no Run can reach.
  it("adds no model the Catalog does not offer", async () => {
    const state = await withPlugin(catalogPrices, (kernel) => kernel.domains.catalog.get)

    expect(state.models.size).toBe(0)
  })

  // Registered before the models it prices, it would find nothing to price —
  // which is why load order carries the rule rather than a comment.
  it("prices nothing when it replays before the Catalog is seeded", async () => {
    const found = await withPlugin(
      seeding(seed.provider, seed.model),
      (kernel) =>
        Effect.map(kernel.domains.catalog.get, (state) =>
          state.models.get(seed.provider)?.get(seed.model),
        ),
      { before: [catalogPrices] },
    )

    expect(found).toBeDefined()
    expect(found?.price).toBeUndefined()
  })
})
