import { boot, buildOf } from "@missingstudio/eva-boot"
import { ANTHROPIC_MODELS, DEFAULT_MODEL, OPENAI_MODELS } from "@missingstudio/eva-catalog-models"
import { CHECKED_AT, PRICES } from "@missingstudio/eva-catalog-prices"
import { costFold, eventID, runID, sessionID, toTicks, type Event } from "@missingstudio/eva-schema"
import { priceLookup } from "@missingstudio/eva-sdk"
import { catalogModels } from "@missingstudio/eva-catalog-models"
import { catalogPrices } from "@missingstudio/eva-catalog-prices"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"

// A live kernel with the two catalog plugins loaded, in the order a build
// registers them: the prices write onto the rows the models made.
const withCatalog = <A>(body: (prices: ReturnType<typeof priceLookup>) => A): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: [{ id: "eva.catalog.models" }, { id: "eva.catalog.prices" }],
        build: buildOf([catalogModels, catalogPrices]),
      })
      const result = body(priceLookup(yield* kernel.domains.catalog.get))
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

/**
 * Two plugins that only meet in a build, so their agreement is checked here
 * rather than in either one. A model the Catalog offers and the snapshot does
 * not price shows `cost unreported` forever and never says why.
 *
 * That a build registers them in the order this relies on is the build's own
 * assertion, and it lives beside the table that decides it.
 */
describe("the catalog and its prices", () => {
  const priced = new Set(PRICES.map((seed) => `${seed.provider}/${seed.model}`))

  it.each(ANTHROPIC_MODELS.map((model) => model.id))("prices %s", (id) => {
    expect(priced.has(`anthropic/${id}`)).toBe(true)
  })

  it.each(OPENAI_MODELS.map((model) => model.id))("prices %s", (id) => {
    expect(priced.has(`openai/${id}`)).toBe(true)
  })

  /**
   * The provider reports `reasoningTokens` without subtracting them from the
   * output count, because OpenAI bills reasoning inside it. That is safe only
   * while no `openai` seed carries a `reasoningTicks` rate — a rate here
   * would charge those tokens twice, quietly.
   */
  it("prices no openai model's reasoning separately", () => {
    for (const seed of PRICES.filter((one) => one.provider === "openai")) {
      expect(seed.reasoningTicks).toBeUndefined()
    }
  })

  it(`carries a snapshot taken on ${CHECKED_AT}`, () => {
    expect(PRICES.length).toBeGreaterThan(0)
  })

  /**
   * Through a live kernel, because the plugin writes onto rows another
   * plugin made: a transform that ran too early, or read the draft wrongly,
   * would leave every model unpriced and no unit test would notice.
   */
  it("reaches the catalog, so the default model has a rate", async () => {
    const price = await withCatalog((prices) =>
      prices(`${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.model}`),
    )

    expect(price?.inputTicks).toBeGreaterThan(0)
    expect(price?.outputTicks).toBeGreaterThan(0)
  })

  /**
   * A response names the model it really ran, and that id carries a release
   * date the Catalog's does not. This is the id every real Run reports, so
   * without the fallback the estimate is null in production and only in
   * production.
   */
  it("prices the dated model id a response reports", async () => {
    const [dated, plain] = await withCatalog((prices) => [
      prices(`${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.model}-20260101`),
      prices(`${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.model}`),
    ])

    expect(dated).toEqual(plain)
    expect(dated?.inputTicks).toBeGreaterThan(0)
  })

  // OpenAI writes the date with dashes where Anthropic writes it plain, and
  // the fallback must read both or every real OpenAI Run prices nothing.
  it("prices the dashed dated id an OpenAI response reports", async () => {
    const [dated, plain] = await withCatalog((prices) => [
      prices("openai/gpt-4o-mini-2024-07-18"),
      prices("openai/gpt-4o-mini"),
    ])

    expect(dated).toEqual(plain)
    expect(dated?.inputTicks).toBeGreaterThan(0)
  })

  it("still prices nothing for a model the catalog does not offer", async () => {
    const price = await withCatalog((prices) => prices("anthropic/not-a-model-20260101"))

    expect(price).toBeUndefined()
  })

  it("turns a Run's counters into an estimate the surfaces can show", async () => {
    const usage: Event = {
      id: eventID("evt_1"),
      seq: 1,
      at: { wall: "2026-08-15T09:00:00Z" },
      run: runID("run_1"),
      session: sessionID("sess_1"),
      parent: null,
      payload: {
        kind: "usage",
        // Dated, because that is what the provider commits.
        model: `${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.model}-20260101`,
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      },
    }
    const found = await withCatalog((prices) => costFold([usage], prices))

    // Opus is $5 per million input at the snapshot's rates.
    expect(found.estimatedCostTicks).toBe(toTicks(5))
    // And the estimate never becomes the reported figure.
    expect(found.costTicks).toBeNull()
  })
})
