import type { Credential, Provider, ProviderRequest } from "@missingstudio/eva-core"
import { ProviderError } from "@missingstudio/eva-core"
import type { ErrorClass, Payload, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { Cause, Effect, Queue, Stream } from "effect"

/**
 * The wire-agnostic body of a streaming Provider plugin. Three plugins
 * spelled this file three times — the same history mapping, the same error
 * table, the same credential resolution, the same stream drain — with only
 * the dialect differing. The body lives here once; a provider plugin keeps
 * its dialect: how its SDK's events map to payloads, and what its wire says
 * a stop reason or a usage counter is.
 */

const text = (blocks: TranscriptMessage["blocks"]): string =>
  blocks
    .filter((block) => block.type === "content" || block.type === "thought")
    .map((block) => {
      const content = (block as { content: { type: string; text?: string } }).content
      return content.type === "text" ? (content.text ?? "") : ""
    })
    .join("")

/**
 * The transcript as chat messages: the human is `user` and everything else
 * `assistant`, one content string per message, and a message with no text is
 * not sent at all — every chat wire refuses an empty content string.
 */
export const chatMessages = (
  history: readonly TranscriptMessage[],
): readonly { readonly role: "user" | "assistant"; readonly content: string }[] =>
  history
    .map((message) => ({
      role: message.author === "human" ? ("user" as const) : ("assistant" as const),
      content: text(message.blocks),
    }))
    .filter((message) => message.content.length > 0)

/**
 * A wire failure as the vendor reader saw it. `billing` is the vendor's own
 * marker — Anthropic's `billing_error` type, OpenAI's `insufficient_quota`
 * on a 429 — because reading the status alone would classify a dead account
 * as `rate_limit`, which the retry policy retries three times.
 */
export interface WireFailure {
  // The request never reached the service.
  readonly connection?: boolean
  readonly status?: number
  readonly billing?: boolean
}

// The eight classes the glossary fixes, as one table. An absent class means
// nobody classified the failure, so every branch here names one.
export const classifyWire = (failure: WireFailure | undefined): ErrorClass => {
  if (failure === undefined) return "other"
  if (failure.connection === true) return "unreachable"
  if (failure.billing === true) return "billing"
  switch (failure.status) {
    case 401:
    case 403:
      return "auth_failed"
    case 404:
      return "no_such_model"
    case 429:
      return "rate_limit"
    case 529:
      return "overloaded"
    default:
      break
  }
  if (failure.status !== undefined && failure.status >= 500) return "server_error"
  return "other"
}

// Silence is not zero: a counter the provider did not report stays null.
// Clamping belongs to `eva.usage`, not to a provider.
export const reported = (value: number | null | undefined): number | null => value ?? null

// The credential the resolve found no secret for, said as auth_failed so the
// Run reports the missing key rather than claiming the model does not exist.
export const missingCredential = (provider: string, namespace: string): ProviderError =>
  new ProviderError({
    provider,
    errorClass: "auth_failed",
    message: `no credential for ${namespace}`,
  })

// The secret behind a Credential, with its failure said as this provider's.
export const secretOf = (
  credential: Credential,
  provider: string,
): Effect.Effect<string, ProviderError> =>
  Effect.mapError(
    credential.secret(),
    (cause) => new ProviderError({ provider, errorClass: "auth_failed", message: cause.message }),
  )

/**
 * What a dialect's `start` writes into. `end` closes the stream and settles
 * the reason `stopReason` answers after the drain; `fail` classifies the
 * cause and fails the stream. The first of the two to settle wins and the
 * other is ignored, so a dialect whose wire can end two ways — an in-band
 * failure event and a terminal promise — needs no flag of its own.
 */
export interface TurnEmitter {
  readonly payload: (payload: Payload) => void
  readonly end: (reason: StopReason | undefined) => void
  readonly fail: (cause: unknown) => void
}

export interface StreamingSpec<C> {
  readonly id: string
  readonly available: () => boolean
  /**
   * The client, per attempt and never captured: a session outlives a
   * credential, so a client built once would send a stale secret for the
   * rest of the session. An injected test client is answered as it is.
   */
  readonly clientFor: () => Effect.Effect<C, ProviderError>
  readonly classify: (cause: unknown) => ErrorClass
  /**
   * Begins the vendor stream and wires its events into the emitter,
   * synchronously. The returned handle is aborted when the Turn's scope
   * closes, which is how an interrupted Run stops paying for tokens.
   */
  readonly start: (
    client: C,
    request: ProviderRequest,
    emit: TurnEmitter,
  ) => { readonly abort: () => void }
}

export const streamingProvider = <C>(spec: StreamingSpec<C>): Provider => ({
  id: spec.id,
  available: spec.available,

  turn: (request: ProviderRequest) => {
    // Set when the stream settles. `stopReason` is read after the drain; an
    // early read answers undefined, which is what an unreported reason means.
    let reason: StopReason | undefined
    const payloads = Stream.unwrap(
      Effect.map(spec.clientFor(), (client) =>
        Stream.callback<Payload, ProviderError>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              let settled = false
              const emit: TurnEmitter = {
                payload: (payload) => void Queue.offerUnsafe(queue, payload),
                end: (settledReason) => {
                  if (settled) return
                  settled = true
                  reason = settledReason
                  Queue.endUnsafe(queue)
                },
                fail: (cause) => {
                  if (settled) return
                  settled = true
                  Queue.failCauseUnsafe(
                    queue,
                    Cause.fail(
                      new ProviderError({
                        provider: spec.id,
                        errorClass: spec.classify(cause),
                        message: cause instanceof Error ? cause.message : String(cause),
                      }),
                    ),
                  )
                },
              }
              return spec.start(client, request, emit)
            }),
            (handle) => Effect.sync(() => handle.abort()),
          ),
        ),
      ),
    )
    return { payloads, stopReason: Effect.sync(() => reason) }
  },
})
