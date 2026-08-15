import type { ErrorClass } from "@missingstudio/eva-schema"
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// What this plugin's config entry takes. A misspelling here is a Finding,
// rather than a default nobody asked for.
const OPTIONS = declare({ maxAttempts: "number", baseMs: "number", capMs: "number" })

// Only these four are worth another attempt. An auth failure, a missing
// model, and a billing problem do not improve by being asked again.
export const RETRYABLE: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  "rate_limit",
  "overloaded",
  "unreachable",
  "server_error",
])

export interface BackoffOptions {
  readonly maxAttempts?: number
  readonly baseMs?: number
  readonly capMs?: number
}

export const DEFAULTS = { maxAttempts: 3, baseMs: 500, capMs: 30_000 } as const

// Exponential, capped. The delay is data on the retry payload, so a reader
// of the Trace can see how long a Run waited and why.
export const backoff = (attempt: number, options: BackoffOptions = {}): number => {
  const base = options.baseMs ?? DEFAULTS.baseMs
  const cap = options.capMs ?? DEFAULTS.capMs
  return Math.min(cap, base * 2 ** Math.max(0, attempt - 1))
}

export const shouldRetry = (
  errorClass: ErrorClass,
  attempt: number,
  options: BackoffOptions = {},
): boolean => RETRYABLE.has(errorClass) && attempt < (options.maxAttempts ?? DEFAULTS.maxAttempts)

export const providerRetry = define({
  id: "eva.provider.retry",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.provider.retry")(function* (ctx) {
    const options: BackoffOptions = {
      maxAttempts: OPTIONS.read(ctx.options, "maxAttempts", DEFAULTS.maxAttempts),
      baseMs: OPTIONS.read(ctx.options, "baseMs", DEFAULTS.baseMs),
      capMs: OPTIONS.read(ctx.options, "capMs", DEFAULTS.capMs),
    }

    yield* ctx.provider["provider.retry"]((event) => {
      event.decide({
        retry: shouldRetry(event.error.errorClass, event.attempt, options),
        max: options.maxAttempts ?? DEFAULTS.maxAttempts,
        delayMs: backoff(event.attempt, options),
      })
    })
  }),
})
