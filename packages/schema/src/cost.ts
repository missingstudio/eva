/**
 * Cost is carried in Ticks: integers of 1e-10 USD. A Provider's own figure
 * converts, and nothing here computes one from tokens times a rate. The
 * conversion lives with the unit, so a reader and a writer round the same way.
 */
const TICKS_PER_USD = 1e10

export const toTicks = (usd: number): number => Math.round(usd * TICKS_PER_USD)

export const toUsd = (ticks: number): number => ticks / TICKS_PER_USD

/**
 * A published rate, in Ticks per million tokens.
 *
 * A price is what a vendor charges. It is not a Cost, and what it produces is
 * an estimate: a projection over counters the Trace already holds, recomputed
 * whenever the rate moves. Nothing derived from a price is ever written to the
 * Trace, so a `costTicks` stays the figure a Provider reported or stays absent.
 */
export interface ModelPrice {
  readonly inputTicks: number
  readonly outputTicks: number
  readonly cacheReadTicks?: number
  readonly cacheWriteTicks?: number
  // Only counted when a record reports reasoning separately. A provider that
  // bills reasoning inside its output count reports none, and adding a rate
  // here would charge those tokens twice.
  readonly reasoningTicks?: number
}

// The counters a rate applies to. A counter nobody reported costs nothing,
// because a price cannot invent the tokens it would multiply.
export interface Counted {
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens?: number | null
  readonly cacheWriteTokens?: number | null
  readonly reasoningTokens?: number | null
}

const PER_MILLION = 1_000_000

// Rounds to Ticks once, per counter. Summing dollars and converting at the
// end is what loses sub-cent precision across a long session.
const at = (rate: number | undefined, tokens: number | null | undefined): number =>
  rate === undefined || tokens == null ? 0 : Math.round((tokens / PER_MILLION) * rate)

export const estimateTicks = (counted: Counted, price: ModelPrice): number =>
  at(price.inputTicks, counted.inputTokens) +
  at(price.outputTicks, counted.outputTokens) +
  at(price.cacheReadTicks, counted.cacheReadTokens) +
  at(price.cacheWriteTicks, counted.cacheWriteTokens) +
  at(price.reasoningTicks, counted.reasoningTokens)

// What a model reference costs, or nothing when the catalog does not price it.
export type PriceLookup = (model: string) => ModelPrice | undefined
