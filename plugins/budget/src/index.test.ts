import type { Usage } from "@missingstudio/eva-core"
import { toTicks } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeBudget } from "./index.js"

// $3/M in, $15/M out, $0.30/M cache read — the rate shape models.dev gives.
const rates = Effect.succeed(() => ({
  inputTicks: toTicks(3),
  outputTicks: toTicks(15),
  cacheReadTicks: toTicks(0.3),
}))

const usage = (over: Partial<Usage> = {}): Usage => ({
  model: "claude-opus-5",
  inputTokens: 1000,
  outputTokens: 200,
  ...over,
})

describe("makeBudget", () => {
  it("charges tokens from a usage record and counts the step", async () => {
    const spent = await Effect.runPromise(
      Effect.flatMap(makeBudget({ limits: {} }), (budget) => budget.charge(usage())),
    )

    expect(spent.tokens).toBe(1200)
    expect(spent.steps).toBe(1)
  })

  it("counts a record that reports no tokens as a step", async () => {
    const spent = await Effect.runPromise(
      Effect.flatMap(makeBudget({ limits: {} }), (budget) =>
        budget.charge(usage({ inputTokens: null, outputTokens: null })),
      ),
    )

    expect(spent.tokens).toBe(0)
    expect(spent.steps).toBe(1)
  })

  it("adds each charge to the ones before it", async () => {
    const spent = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: {} })
        yield* budget.charge(usage())
        yield* budget.charge(usage())
        return yield* budget.state
      }),
    )

    expect(spent.tokens).toBe(2400)
    expect(spent.steps).toBe(2)
  })

  // Silence is not zero: the budget never sums a figure nobody gave it.
  it("holds cost at null until a record reports one", async () => {
    const spent = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: {} })
        const quiet = yield* budget.charge(usage())
        const reported = yield* budget.charge(usage({ costTicks: 51 }))
        return { quiet, reported }
      }),
    )

    expect(spent.quiet.costTicks).toBeNull()
    expect(spent.reported.costTicks).toBe(51)
  })

  it("reports the limits it was built with", async () => {
    const spent = await Effect.runPromise(
      Effect.flatMap(makeBudget({ limits: { tokens: 10 } }), (budget) => budget.state),
    )

    expect(spent.limits).toEqual({ tokens: 10 })
  })
})

describe("a budget check", () => {
  it("is affordable when config sets no limit", async () => {
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: {} })
        yield* budget.charge(usage())
        return yield* budget.check
      }),
    )

    expect(decision).toEqual({ kind: "affordable" })
  })

  it("is exhausted once the tokens reach the limit", async () => {
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: { tokens: 1200 } })
        const before = yield* budget.check
        yield* budget.charge(usage())
        return { before, after: yield* budget.check }
      }),
    )

    expect(decision.before).toEqual({ kind: "affordable" })
    expect(decision.after).toEqual({ kind: "exhausted", limit: "tokens" })
  })

  it("is exhausted once the steps reach the limit", async () => {
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: { steps: 2 } })
        yield* budget.charge(usage({ inputTokens: 0, outputTokens: 0 }))
        const before = yield* budget.check
        yield* budget.charge(usage({ inputTokens: 0, outputTokens: 0 }))
        return { before, after: yield* budget.check }
      }),
    )

    expect(decision.before).toEqual({ kind: "affordable" })
    expect(decision.after).toEqual({ kind: "exhausted", limit: "steps" })
  })

  it("is exhausted once the reported cost reaches the limit", async () => {
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: { costTicks: 100 } })
        yield* budget.charge(usage({ costTicks: 100 }))
        return yield* budget.check
      }),
    )

    expect(decision).toEqual({ kind: "exhausted", limit: "costTicks" })
  })

  it("stays affordable under a cost limit while no record reports a cost", async () => {
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudget({ limits: { costTicks: 1 } })
        yield* budget.charge(usage())
        return yield* budget.check
      }),
    )

    expect(decision).toEqual({ kind: "affordable" })
  })

  /**
   * A cost limit that can never be reached is worse than one reached
   * approximately: against a Provider that reports no cost, the Budget
   * spends the counters at catalog rates and says the figure is an estimate.
   */
  describe("spending an estimate", () => {
    const charged = (spent: Usage) =>
      Effect.runPromise(
        Effect.flatMap(makeBudget({ limits: {}, prices: rates }), (budget) => budget.charge(spent)),
      )

    it("prices the counters when nothing reported a cost", async () => {
      const spent = await charged(usage({ inputTokens: 1_000_000, outputTokens: 0 }))

      expect(spent.costTicks).toBe(toTicks(3))
      expect(spent.costFrom).toBe("estimated")
    })

    it("prices a cache read at its own rate, not the input rate", async () => {
      const spent = await charged(
        usage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }),
      )

      expect(spent.costTicks).toBe(toTicks(0.3))
    })

    it("takes a reported figure over one it worked out", async () => {
      const spent = await charged(usage({ inputTokens: 1_000_000, costTicks: 42 }))

      expect(spent.costTicks).toBe(42)
      expect(spent.costFrom).toBe("reported")
    })

    it("reaches a cost limit that no reported figure could have reached", async () => {
      const decision = await Effect.runPromise(
        Effect.gen(function* () {
          const budget = yield* makeBudget({ limits: { costTicks: toTicks(1) }, prices: rates })
          yield* budget.charge(usage({ inputTokens: 1_000_000, outputTokens: 0 }))
          return yield* budget.check
        }),
      )

      expect(decision).toEqual({ kind: "exhausted", limit: "costTicks" })
    })

    it("says nothing about a cost when the catalog prices no model", async () => {
      const spent = await Effect.runPromise(
        Effect.flatMap(makeBudget({ limits: {}, prices: Effect.succeed(() => undefined) }), (b) =>
          b.charge(usage()),
        ),
      )

      expect(spent.costTicks).toBeNull()
      expect(spent.costFrom).toBeUndefined()
    })
  })

  // The clock is injectable, so the test moves time instead of waiting.
  it("is exhausted once the clock reaches the minutes limit", async () => {
    let clock = 0
    const budget = await Effect.runPromise(makeBudget({ limits: { minutes: 5 }, now: () => clock }))

    expect(await Effect.runPromise(budget.check)).toEqual({ kind: "affordable" })
    clock = 5 * 60_000
    expect(await Effect.runPromise(budget.check)).toEqual({ kind: "exhausted", limit: "minutes" })
  })
})
