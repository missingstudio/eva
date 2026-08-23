import type { Credential, Provider, ProviderRequest } from "@missingstudio/eva-core"
import { ProviderError } from "@missingstudio/eva-core"
import type { ErrorClass, Payload, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { Cause, Effect, Queue, Stream } from "effect"
import OpenAI from "openai"

/**
 * One plugin serves N Providers, so the plugin id alone would name the
 * plugin in every message and the endpoint in none. Each Provider carries a
 * compound id — `eva.provider.compatible:ollama` — built from this prefix.
 */
export const PLUGIN_ID = "eva.provider.compatible"

const text = (blocks: TranscriptMessage["blocks"]): string =>
  blocks
    .filter((block) => block.type === "content" || block.type === "thought")
    .map((block) => {
      const content = (block as { content: { type: string; text?: string } }).content
      return content.type === "text" ? (content.text ?? "") : ""
    })
    .join("")

export const toMessages = (
  history: readonly TranscriptMessage[],
): readonly { readonly role: "user" | "assistant"; readonly content: string }[] =>
  history
    .map((message) => ({
      role: message.author === "human" ? ("user" as const) : ("assistant" as const),
      content: text(message.blocks),
    }))
    .filter((message) => message.content.length > 0)

/**
 * The eight classes the glossary fixes. `insufficient_quota` arrives as HTTP
 * 429, and reading the status alone would classify a dead account as
 * `rate_limit`, which the retry policy retries three times. A 400 — a prompt
 * that does not fit a small local model's context — lands in `other` with
 * the server's own message, because all eight classes are about reaching a
 * Provider and none fits.
 */
export const classify = (cause: unknown): ErrorClass => {
  if (cause instanceof OpenAI.APIConnectionError) return "unreachable"
  if (cause instanceof OpenAI.APIError) {
    const status = cause.status
    const quota = cause.code === "insufficient_quota" || cause.type === "insufficient_quota"
    if (status === 429) return quota ? "billing" : "rate_limit"
    if (status === 401 || status === 403) return "auth_failed"
    if (status === 404) return "no_such_model"
    if (status !== undefined && status >= 500) return "server_error"
  }
  return "other"
}

/**
 * Chat Completions puts a content filter in `finish_reason`, the provider's
 * own statement about why it stopped, so `content_filter` maps to `refusal`
 * here where the Responses API answers `undefined`. A reason with no member
 * answers `undefined` — silence understates and never misleads — and so does
 * an absent one: silence is not `end_turn`.
 */
export const toStopReason = (reason: string | null | undefined): StopReason | undefined => {
  switch (reason) {
    case "stop":
      return "end_turn"
    case "length":
      return "max_tokens"
    case "content_filter":
      return "refusal"
    default:
      return undefined
  }
}

// Silence is not zero: a counter the provider did not report stays null.
// Clamping belongs to `eva.usage`, not here.
const reported = (value: number | null | undefined): number | null => value ?? null

/**
 * `prompt_tokens_details.cached_tokens` is a subset of `prompt_tokens`, so
 * the subtraction happens here or cached tokens bill twice at two rates. It
 * never shows up against a local namespace, which has no Price; it only
 * bites a namespace that does, such as a proxy a person named `openai`.
 */
export const toUsage = (
  namespace: string,
  model: string,
  usage:
    | {
        prompt_tokens?: number | null
        completion_tokens?: number | null
        prompt_tokens_details?: { cached_tokens?: number | null } | null
        completion_tokens_details?: { reasoning_tokens?: number | null } | null
      }
    | undefined,
): Extract<Payload, { kind: "usage" }> => {
  const prompt = usage?.prompt_tokens
  const cached = usage?.prompt_tokens_details?.cached_tokens
  return {
    kind: "usage",
    model: `${namespace}/${model}`,
    inputTokens: prompt == null ? null : prompt - (cached ?? 0),
    outputTokens: reported(usage?.completion_tokens),
    // Chat Completions reports no cache-write count, and silence is not zero.
    cacheWriteTokens: null,
    cacheReadTokens: reported(cached),
    reasoningTokens: reported(usage?.completion_tokens_details?.reasoning_tokens),
  }
}

/**
 * Chat Completions gives only `choices[0].index`, which is 0 for a
 * single-choice request, so Eva's block number cannot come from the wire.
 * The block counts runs of one delta kind, starting at 0 and rising whenever
 * the kind changes: a `reasoning_content` run then a `content` run is block
 * 0 then block 1, which is the flush core wants — one number for both would
 * put a thought and an answer in one commit group. Per `turn()` call, so the
 * next attempt starts again at 0.
 */
export const makeBlocks = (): ((kind: string) => number) => {
  let last: string | undefined
  let block = -1
  return (kind) => {
    if (kind !== last) {
      last = kind
      block += 1
    }
    return block
  }
}

// The delta fields this mapper has a kind for. A refusal is a content part
// the provider labelled, so it is shown as text and `finish_reason` carries
// the stop reason on this wire. `reasoning_content` is not in the SDK's
// type: it is the extension field the compatible servers stream thoughts in.
const DELTA_KINDS: Readonly<Record<string, "thought" | "text">> = {
  reasoning_content: "thought",
  content: "text",
  refusal: "text",
}

export interface CompatibleOptions {
  /**
   * `eva.provider.compatible:ollama`. It carries the entry, because core
   * builds the auth_failed summary from `resolution.provider.id`, and one id
   * for N endpoints names the plugin in every message and the endpoint in
   * none.
   */
  readonly id: string
  // `ollama` — the Catalog prefix on `usage.model`, and the Credential id.
  readonly namespace: string
  /**
   * The base URL a curl would take, including whatever version segment the
   * server serves at. Nothing is appended.
   */
  readonly api: string
  /**
   * Absent when the endpoint needs no key, so `available()` answers true and
   * no Authorization header is sent. `false` when the entry asked for one
   * and the store answered nothing, so `available()` says so and the Run
   * closes auth_failed rather than reaching the wire.
   */
  readonly credential?: Credential | false
  // 0 or absent -> omit max_tokens and leave the server's own ceiling.
  readonly maxTokens?: number
  /**
   * False for a server that refuses `stream_options`, which then reports one
   * usage payload with every counter null. Degrade, never fail — and one
   * boolean is cheaper than a hidden retry the Trace would be missing.
   */
  readonly usage?: boolean
  // A test's, and answers as it is.
  readonly client?: OpenAI
}

export const makeCompatibleProvider = (options: CompatibleOptions): Provider => {
  // The secret is resolved per attempt, never captured: a session outlives a
  // credential, so a client built once would send a stale one for the rest
  // of the session. An injected client is a test's, and answers as it is.
  const clientFor = Effect.fn("eva.provider.compatible.client")(function* () {
    if (options.client !== undefined) return options.client
    if (options.credential === false) {
      return yield* Effect.fail(
        new ProviderError({
          provider: options.id,
          errorClass: "auth_failed",
          message: `no credential for ${options.namespace}`,
        }),
      )
    }
    if (options.credential === undefined) {
      // A keyless endpoint. The SDK demands a key at construction, so a
      // placeholder satisfies it and the explicit null omits the
      // Authorization header from every request.
      return new OpenAI({
        baseURL: options.api,
        apiKey: "keyless",
        defaultHeaders: { Authorization: null },
        maxRetries: 0,
      })
    }
    const key = yield* Effect.mapError(
      options.credential.secret(),
      (cause) =>
        new ProviderError({
          provider: options.id,
          errorClass: "auth_failed",
          message: cause.message,
        }),
    )
    // Zero retries: a retry is a record of its own, and a hidden one is
    // missing from the Trace that exists to show it.
    return new OpenAI({ baseURL: options.api, apiKey: key, maxRetries: 0 })
  })

  return {
    id: options.id,
    available: () => options.client !== undefined || options.credential !== false,

    turn: (request: ProviderRequest) => {
      // Set when the stream drains. `stopReason` is read after that; an
      // early read answers undefined, which is what an unreported reason
      // means.
      let reason: StopReason | undefined
      const payloads = Stream.unwrap(
        Effect.map(clientFor(), (client) =>
          Stream.callback<Payload, ProviderError>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const controller = new AbortController()
                // The queue can end two ways — the drain finishing and the
                // abort on release — so the first to settle wins and the
                // other returns.
                let settled = false
                const fail = (cause: unknown) => {
                  if (settled) return
                  settled = true
                  Queue.failCauseUnsafe(
                    queue,
                    Cause.fail(
                      new ProviderError({
                        provider: options.id,
                        errorClass: classify(cause),
                        message: cause instanceof Error ? cause.message : String(cause),
                      }),
                    ),
                  )
                }

                const drain = async () => {
                  // The raw chunk stream, not the SDK's accumulating helper:
                  // the helper throws on a snapshot a sloppy server left
                  // incomplete, and a missing finish_reason must degrade to
                  // an unreported one rather than fail the Run.
                  const stream = await client.chat.completions.create(
                    {
                      model: request.model.model,
                      messages: [
                        ...(request.system === undefined
                          ? []
                          : [{ role: "system" as const, content: request.system }]),
                        ...toMessages(request.messages),
                      ],
                      stream: true,
                      ...(options.usage === false
                        ? {}
                        : { stream_options: { include_usage: true } }),
                      ...((options.maxTokens ?? 0) > 0 ? { max_tokens: options.maxTokens } : {}),
                    },
                    { signal: controller.signal },
                  )

                  const blocks = makeBlocks()
                  let finish: string | undefined
                  let usage: Parameters<typeof toUsage>[2]
                  let model: string | undefined

                  for await (const chunk of stream) {
                    if (typeof chunk.model === "string" && chunk.model !== "") model = chunk.model
                    // Kept even under `usage: false`: a counter the server
                    // volunteered anyway is not silence, and throwing it
                    // away loses the Budget's input.
                    if (chunk.usage != null) usage = chunk.usage
                    const choice = chunk.choices?.[0]
                    if (choice == null) continue
                    if (choice.finish_reason != null) finish = choice.finish_reason
                    const delta = choice.delta as Record<string, unknown> | null | undefined
                    if (delta == null) continue

                    for (const [field, value] of Object.entries(delta)) {
                      // `role` is framing, not content, and a null field says
                      // nothing.
                      if (field === "role" || value == null) continue
                      const kind = DELTA_KINDS[field]
                      // A delta is content the model produced. One the union
                      // has no kind for is preserved rather than dropped, so
                      // a stage that maps it later reads a Trace that kept it.
                      if (kind === undefined) {
                        Queue.offerUnsafe(queue, {
                          kind: "unknown",
                          originalKind: field,
                          raw: chunk,
                        })
                        continue
                      }
                      if (typeof value !== "string" || value === "") continue
                      Queue.offerUnsafe(queue, {
                        kind,
                        block: blocks(field),
                        content: { type: "text", text: value },
                      })
                    }
                  }

                  if (settled) return
                  settled = true
                  reason = toStopReason(finish)
                  Queue.offerUnsafe(
                    queue,
                    toUsage(options.namespace, model ?? request.model.model, usage),
                  )
                  Queue.endUnsafe(queue)
                }

                drain().catch(fail)
                return controller
              }),
              (controller) => Effect.sync(() => controller.abort()),
            ),
          ),
        ),
      )
      return { payloads, stopReason: Effect.sync(() => reason) }
    },
  }
}
