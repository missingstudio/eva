import type { Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

const clamp = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.max(0, Math.trunc(value))

/**
 * Normalizes a usage payload before it commits. A negative or fractional
 * count becomes a whole non-negative one; an absent count stays absent,
 * because silence is not zero and a normalizer must not invent a figure.
 */
export const normalize = (payload: Payload): Payload => {
  if (payload.kind !== "usage") return payload
  return {
    ...payload,
    inputTokens: clamp(payload.inputTokens),
    outputTokens: clamp(payload.outputTokens),
    cacheWriteTokens: clamp(payload.cacheWriteTokens),
    cacheReadTokens: clamp(payload.cacheReadTokens),
    ...(payload.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: clamp(payload.reasoningTokens) }),
    ...(payload.serverToolTokens === undefined
      ? {}
      : { serverToolTokens: clamp(payload.serverToolTokens) }),
    ...(payload.costTicks === undefined
      ? {}
      : { costTicks: Math.max(0, Math.trunc(payload.costTicks)) }),
  }
}

export const usage = define({
  id: "eva.usage",
  effect: Effect.fn("eva.usage")(function* (ctx) {
    yield* ctx.provider["provider.response.after"]((event) => {
      event.payloads.update((payloads) => payloads.map(normalize))
    })
  }),
})
