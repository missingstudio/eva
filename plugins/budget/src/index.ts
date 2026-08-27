import type { Budget, BudgetLimits, BudgetState, Usage } from "@missingstudio/eva-core"
import { estimating, spendIn, toTicks, type PriceLookup } from "@missingstudio/eva-schema"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// Zero, or absent, means no limit of that kind.
const OPTIONS = declare({
  tokens: "number",
  minutes: "number",
  steps: "number",
  // In dollars, because that is the unit a person sets a ceiling in. Ticks are
  // what a Cost is counted in, and the conversion belongs here rather than in
  // the file somebody writes.
  costUsd: "number",
})

export interface BudgetDeps {
  readonly limits: BudgetLimits
  readonly now?: () => number
  // Without rates, a Budget over a Provider that reports no cost can never
  // reach a `costTicks` limit. `ctx.prices` is what a plugin hands over.
  readonly prices?: Effect.Effect<PriceLookup>
}

/**
 * Accounting and display at stage 0; a limit enforces only when config sets
 * one.
 *
 * A Provider's own figure is what a Budget spends. When none arrives it
 * spends the counters at catalog rates instead, because a limit that can never
 * be reached is worse than one that is reached approximately — and the state's
 * `spend` says which of the two the figure is, so an exhausted Outcome is
 * attributable. The two are never added: one shape wins for the Run.
 *
 * Both the accumulation of the estimate and the choice between the two are
 * `@missingstudio/eva-schema`'s, because a fold over the Trace answers the
 * same questions. This plugin used to answer them itself, and it disagreed
 * with the fold about a record nothing could price: the fold nulled the whole
 * estimate and this added nothing for that record, then enforced a limit
 * against a total it read as whole.
 */
export const makeBudget = (deps: BudgetDeps): Effect.Effect<Budget> =>
  Effect.sync(() => {
    const now = deps.now ?? (() => Date.now())
    const started = now()
    let tokens = 0
    let reportedTicks: number | null = null
    const estimated = estimating()
    let steps = 0

    const state = (): BudgetState => ({
      tokens,
      spend: spendIn(steps > 0, reportedTicks, estimated.ticks()),
      milliseconds: now() - started,
      steps,
      limits: deps.limits,
    })

    const exceeded = (current: BudgetState): keyof BudgetLimits | undefined => {
      const { limits, spend } = current
      if (limits.tokens !== undefined && current.tokens >= limits.tokens) return "tokens"
      /**
       * Only a figure reaches a cost limit. A spend nobody could put a figure
       * to reaches none, which is what an estimate nothing could complete now
       * answers — it used to answer a partial sum, and a limit enforced
       * against one stops a Run early for a cost nobody measured.
       */
      if (
        limits.costTicks !== undefined &&
        (spend.kind === "reported" || spend.kind === "estimated") &&
        spend.ticks >= limits.costTicks
      ) {
        return "costTicks"
      }
      if (limits.minutes !== undefined && current.milliseconds >= limits.minutes * 60_000) {
        return "minutes"
      }
      if (limits.steps !== undefined && current.steps >= limits.steps) return "steps"
      return undefined
    }

    return {
      charge: Effect.fn("eva.budget.charge")(function* (spent: Usage) {
        tokens += (spent.inputTokens ?? 0) + (spent.outputTokens ?? 0)
        steps += 1
        if (spent.costTicks !== undefined) {
          reportedTicks = (reportedTicks ?? 0) + spent.costTicks
          return state()
        }
        // The rates are read at the charge, so a Catalog that gained a price
        // mid-Run is one this Budget spends at.
        estimated.price(spent, deps.prices === undefined ? undefined : yield* deps.prices)
        return state()
      }),
      state: Effect.sync(state),
      check: Effect.sync(() => {
        const limit = exceeded(state())
        return limit === undefined
          ? ({ kind: "affordable" } as const)
          : ({ kind: "exhausted", limit } as const)
      }),
    }
  })

export const budget = define({
  id: "eva.budget",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.budget")(function* (ctx) {
    // A limit of zero is no limit, so each key is read once and kept only
    // when it says something.
    const limit = (key: keyof typeof OPTIONS.shapes) => {
      const found = OPTIONS.read(ctx.options, key, 0)
      return found > 0 ? { [key]: found } : {}
    }

    const dollars = OPTIONS.read(ctx.options, "costUsd", 0)
    const limits: BudgetLimits = {
      ...limit("tokens"),
      ...limit("minutes"),
      ...limit("steps"),
      // The contract has always enforced this and no key reached it, so the
      // one limit a person is most likely to want was the one only a direct
      // caller could set.
      ...(dollars > 0 ? { costTicks: toTicks(dollars) } : {}),
    }
    const made = yield* makeBudget({ limits, prices: ctx.prices })
    yield* ctx.slot.budget.provide(ctx.id, made)
  }),
})
