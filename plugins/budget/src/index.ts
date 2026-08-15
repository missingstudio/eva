import type { Budget, BudgetLimits, BudgetState, Usage } from "@missingstudio/eva-core"
import { estimateTicks, type PriceLookup } from "@missingstudio/eva-schema"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// Zero, or absent, means no limit of that kind.
const OPTIONS = declare({ tokens: "number", minutes: "number", steps: "number" })

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
 * spends the counters at catalog rates instead, because a limit that can
 * never be reached is worse than one that is reached approximately — and
 * `costFrom` says which of the two the state holds, so an exhausted Outcome
 * is attributable. The two are never added: one shape wins for the Run.
 */
export const makeBudget = (deps: BudgetDeps): Effect.Effect<Budget> =>
  Effect.sync(() => {
    const now = deps.now ?? (() => Date.now())
    const started = now()
    let tokens = 0
    let reportedTicks: number | null = null
    let estimatedTicks: number | null = null
    let steps = 0

    // A reported figure outranks an estimate, and the estimate is kept
    // rather than dropped: a Run whose provider reports cost for some
    // exchanges and not others still answers from the shape that is whole.
    const state = (): BudgetState => {
      const costTicks = reportedTicks ?? estimatedTicks
      return {
        tokens,
        costTicks,
        ...(costTicks === null
          ? {}
          : { costFrom: reportedTicks === null ? ("estimated" as const) : ("reported" as const) }),
        milliseconds: now() - started,
        steps,
        limits: deps.limits,
      }
    }

    const exceeded = (current: BudgetState): keyof BudgetLimits | undefined => {
      const { limits } = current
      if (limits.tokens !== undefined && current.tokens >= limits.tokens) return "tokens"
      if (
        limits.costTicks !== undefined &&
        current.costTicks !== null &&
        current.costTicks >= limits.costTicks
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
        const prices = deps.prices === undefined ? undefined : yield* deps.prices
        const price = prices === undefined ? undefined : prices(spent.model)
        if (price !== undefined) {
          estimatedTicks = (estimatedTicks ?? 0) + estimateTicks(spent, price)
        }
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

    const limits: BudgetLimits = {
      ...limit("tokens"),
      ...limit("minutes"),
      ...limit("steps"),
    }
    const made = yield* makeBudget({ limits, prices: ctx.prices })
    yield* ctx.slot.budget.provide(ctx.id, made)
  }),
})
