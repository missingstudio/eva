import Anthropic from "@anthropic-ai/sdk"
import type { Credential, Provider, ProviderRequest } from "@missingstudio/eva-core"
import { ProviderError } from "@missingstudio/eva-core"
import type { ErrorClass, Payload, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { Cause, Effect, Queue, Stream } from "effect"

export const PROVIDER_ID = "eva.provider.anthropic"

// Anthropic reports token counts and never a request cost, so `costTicks`
// stays absent and the Run reports the gap rather than computing a figure.
export const REPORTS_COST = false
const DEFAULT_MAX_TOKENS = 64_000

const text = (blocks: TranscriptMessage["blocks"]): string =>
  blocks
    .filter((block) => block.type === "content" || block.type === "thought")
    .map((block) => {
      const content = (block as { content: { type: string; text?: string } }).content
      return content.type === "text" ? (content.text ?? "") : ""
    })
    .join("")

export const toMessages = (history: readonly TranscriptMessage[]) =>
  history
    .map((message) => ({
      role: message.author === "human" ? ("user" as const) : ("assistant" as const),
      content: text(message.blocks),
    }))
    .filter((message) => message.content.length > 0)

// The eight classes the glossary fixes. An absent class means nobody
// classified the failure, so every branch here names one.
export const classify = (cause: unknown): ErrorClass => {
  if (cause instanceof Anthropic.APIConnectionError) return "unreachable"
  if (cause instanceof Anthropic.APIError) {
    const status = cause.status
    if (cause.type === "billing_error") return "billing"
    if (status === 401 || status === 403) return "auth_failed"
    if (status === 404) return "no_such_model"
    if (status === 429) return "rate_limit"
    if (status === 529) return "overloaded"
    if (status !== undefined && status >= 500) return "server_error"
  }
  return "other"
}

// ACP's five reasons. Anthropic's tool_use and pause_turn cannot arrive at
// stage 0, which ships no tools, and a stop sequence ends the turn. A message
// that names no reason reports none: silence is not `end_turn`.
export const toStopReason = (reason: string | null | undefined): StopReason | undefined => {
  if (reason == null) return undefined
  switch (reason) {
    case "max_tokens":
      return "max_tokens"
    case "refusal":
      return "refusal"
    default:
      return "end_turn"
  }
}

const counter = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.max(0, Math.trunc(value))

export interface AnthropicOptions {
  // Absent when no credential resolved. The provider still answers the model
  // reference and reports itself unavailable, so a Run says the credential is
  // missing rather than claiming the model does not exist.
  readonly credential?: Credential
  readonly maxTokens?: number
  readonly client?: Anthropic
}

export const makeAnthropicProvider = (options: AnthropicOptions): Provider => {
  // The secret is resolved per attempt, never captured: a session outlives an
  // access token, so a client built once would send a stale one for the rest
  // of the session. An injected client is a test's, and answers as it is.
  const clientFor = Effect.fn("eva.provider.anthropic.client")(function* () {
    if (options.client !== undefined) return options.client
    if (options.credential === undefined) {
      return yield* Effect.fail(
        new ProviderError({
          provider: PROVIDER_ID,
          errorClass: "auth_failed",
          message: "no credential for anthropic",
        }),
      )
    }
    const key = yield* Effect.mapError(
      options.credential.secret(),
      (cause) =>
        new ProviderError({
          provider: PROVIDER_ID,
          errorClass: "auth_failed",
          message: cause.message,
        }),
    )
    return new Anthropic({ apiKey: key, maxRetries: 0 })
  })

  return {
    id: PROVIDER_ID,
    available: () => options.client !== undefined || options.credential !== undefined,

    turn: (request: ProviderRequest) => {
      // Set when the message settles. `stopReason` is read after the stream
      // drains; an early read answers undefined, which is what an unreported
      // reason means.
      let reason: StopReason | undefined
      const payloads = Stream.unwrap(
        Effect.map(clientFor(), (client) =>
          Stream.callback<Payload, ProviderError>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const stream = client.messages.stream({
                  model: request.model.model,
                  max_tokens: options.maxTokens ?? request.maxTokens ?? DEFAULT_MAX_TOKENS,
                  ...(request.system === undefined ? {} : { system: request.system }),
                  messages: toMessages(request.messages),
                })

                stream.on("streamEvent", (event) => {
                  // Framing — the block boundaries and the message envelope —
                  // is structure and not content, and the `usage` record and
                  // the Run's close already carry what it says.
                  if (event.type !== "content_block_delta") return

                  const delta = event.delta
                  if (delta.type === "text_delta") {
                    Queue.offerUnsafe(queue, {
                      kind: "text",
                      block: event.index,
                      content: { type: "text", text: delta.text },
                    })
                    return
                  }

                  if (delta.type === "thinking_delta") {
                    Queue.offerUnsafe(queue, {
                      kind: "thought",
                      block: event.index,
                      content: { type: "text", text: delta.thinking },
                    })
                    return
                  }

                  // A delta is content the model produced. One the union has
                  // no kind for is preserved rather than dropped, so a stage
                  // that maps it later reads a Trace that kept it.
                  Queue.offerUnsafe(queue, {
                    kind: "unknown",
                    originalKind: delta.type,
                    raw: event,
                  })
                })

                stream
                  .finalMessage()
                  .then((message) => {
                    reason = toStopReason(message.stop_reason)
                    const usage = message.usage
                    Queue.offerUnsafe(queue, {
                      kind: "usage",
                      model: `anthropic/${message.model}`,
                      inputTokens: counter(usage.input_tokens),
                      outputTokens: counter(usage.output_tokens),
                      cacheWriteTokens: counter(usage.cache_creation_input_tokens),
                      cacheReadTokens: counter(usage.cache_read_input_tokens),
                    })
                    Queue.endUnsafe(queue)
                  })
                  .catch((cause: unknown) => {
                    Queue.failCauseUnsafe(
                      queue,
                      Cause.fail(
                        new ProviderError({
                          provider: PROVIDER_ID,
                          errorClass: classify(cause),
                          message: cause instanceof Error ? cause.message : String(cause),
                        }),
                      ),
                    )
                  })

                return stream
              }),
              (stream) => Effect.sync(() => stream.abort()),
            ),
          ),
        ),
      )
      return { payloads, stopReason: Effect.sync(() => reason) }
    },
  }
}
