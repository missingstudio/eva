import type { Claim, ErrorClass, SessionID, Spend } from "@missingstudio/eva-schema"

// A statement of intent whose acceptance criteria a machine can check.
export interface Spec {
  readonly intent: string
  readonly criteria?: readonly string[]
  readonly budget?: BudgetLimits
}

// What a Unit returns. Escalation to a human is an Outcome, not an error.
export type Outcome =
  | { readonly kind: "done"; readonly claim: Claim }
  | { readonly kind: "failed"; readonly claim: Claim; readonly errorClass?: ErrorClass }
  | { readonly kind: "needs_human"; readonly question: string; readonly session: SessionID }
  | { readonly kind: "exhausted"; readonly spent: BudgetState }

// One field of a Budget is a limit; the Budget is the whole set.
export interface BudgetLimits {
  readonly tokens?: number
  readonly costTicks?: number
  readonly minutes?: number
  readonly steps?: number
}

export interface BudgetState {
  readonly tokens: number
  /**
   * What this Budget has spent, in the one closed set every reader of a spend
   * is shown. `reported` is a Provider's own figure; `estimated` is the
   * counters at catalog rates, which is what a Budget spends when nobody
   * reports one; `unreported` is a spend nobody could put a figure to, and
   * `none` is a Budget that has not been charged.
   *
   * An exhausted Outcome names a limit, so the state must say whether the
   * figure that reached it was a bill or an arithmetic. It used to say that in
   * two fields of its own — a nullable number and a two-way optional — which
   * could express neither `none` nor `unreported`.
   */
  readonly spend: Spend
  readonly milliseconds: number
  readonly steps: number
  readonly limits: BudgetLimits
}

// Exhausting a Budget is an Outcome, and the partial work is kept.
export type BudgetDecision =
  | { readonly kind: "affordable" }
  | { readonly kind: "exhausted"; readonly limit: keyof BudgetLimits }

export interface Usage {
  readonly model: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  // The cache counters carry their own rates, so an estimate that dropped
  // them would price a cache read as a fresh input token and bill it tenfold.
  readonly cacheReadTokens?: number | null
  readonly cacheWriteTokens?: number | null
  readonly costTicks?: number
}

export interface ModelRef {
  readonly provider: string
  readonly model: string
}

export const modelRef = (reference: string): ModelRef | undefined => {
  const slash = reference.indexOf("/")
  if (slash <= 0 || slash === reference.length - 1) return undefined
  return { provider: reference.slice(0, slash), model: reference.slice(slash + 1) }
}

export const formatModelRef = (reference: ModelRef): string =>
  `${reference.provider}/${reference.model}`
