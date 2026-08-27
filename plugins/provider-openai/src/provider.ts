import type { Credential, Provider } from "@missingstudio/eva-core"
import type { ErrorClass, Payload, StopReason } from "@missingstudio/eva-schema"
import {
  chatMessages,
  classifyWire,
  missingCredential,
  reported,
  secretOf,
  streamingProvider,
} from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import OpenAI from "openai"

// Two identifiers, never one. The first names the plugin in a ProviderError
// and a Claim; the second is what appears in a ModelRef, a usage.model
// prefix, the price lookup, and as the Credential id.
export const PROVIDER_ID = "eva.provider.openai"
export const NAMESPACE = "openai"

// OpenAI reports token counters and never a request cost, so `costTicks`
/**
 * The OpenAI SDK's failure, read into the one wire table. `insufficient_quota`
 * arrives as HTTP 429, and reading the status alone would classify a dead
 * account as `rate_limit`, which the retry policy retries three times.
 */
export const classify = (cause: unknown): ErrorClass =>
  classifyWire(
    cause instanceof OpenAI.APIConnectionError
      ? { connection: true }
      : cause instanceof OpenAI.APIError
        ? {
            ...(cause.status === undefined ? {} : { status: cause.status }),
            billing:
              cause.status === 429 &&
              (cause.code === "insufficient_quota" || cause.type === "insufficient_quota"),
          }
        : undefined,
  )

// The guides spell it `max_output_tokens` and one example `max_tokens`, so
// the pattern accepts both.
const TRUNCATED = /^max_(output_)?tokens$/

/**
 * Read from two fields, because OpenAI splits them: a refusal is a content
 * part and never a status, so `refused` can only come from the refusal
 * delta. An incomplete reason with no member answers `undefined` — silence
 * understates and never misleads — so a content filter reports no reason
 * rather than the nearest word.
 */
export const toStopReason = (
  settled: {
    status?: string | null
    incomplete_details?: { reason?: string | null } | null
  },
  refused: boolean,
): StopReason | undefined => {
  if (refused) return "refusal"
  if (settled.status === "completed") return "end_turn"
  if (settled.status === "incomplete" && TRUNCATED.test(settled.incomplete_details?.reason ?? "")) {
    return "max_tokens"
  }
  return undefined
}

/**
 * OpenAI's cached count is a subset of `input_tokens`, where Anthropic's
 * cache counters sit beside it. The estimate charges both counters at their
 * own rates, so the subtraction happens here or those tokens bill twice.
 * The reasoning count stays inside `output_tokens`, because OpenAI bills it
 * there and no `openai` price seed carries a `reasoningTicks` rate — which
 * conformance asserts.
 */
export const toUsage = (
  model: string,
  usage:
    | {
        input_tokens?: number | null
        input_tokens_details?: { cached_tokens?: number | null } | null
        output_tokens?: number | null
        output_tokens_details?: { reasoning_tokens?: number | null } | null
      }
    | undefined,
): Extract<Payload, { kind: "usage" }> => {
  const input = usage?.input_tokens
  const cached = usage?.input_tokens_details?.cached_tokens
  return {
    kind: "usage",
    model: `${NAMESPACE}/${model}`,
    inputTokens: input == null ? null : input - (cached ?? 0),
    outputTokens: reported(usage?.output_tokens),
    // OpenAI reports no cache-write count, and silence is not zero.
    cacheWriteTokens: null,
    cacheReadTokens: reported(cached),
    reasoningTokens: reported(usage?.output_tokens_details?.reasoning_tokens),
  }
}

/**
 * Eva's `block` is the identity of one content part, and the Responses API
 * names that identity with two numbers. This flattens the pair: two parts
 * that collapsed onto one number would merge in the fold. The map is per
 * `turn()` call, so the next attempt starts again at 0 — the established
 * behaviour.
 */
export const makeBlocks = (): ((key: string) => number) => {
  const minted = new Map<string, number>()
  return (key) => {
    const found = minted.get(key)
    if (found !== undefined) return found
    const next = minted.size
    minted.set(key, next)
    return next
  }
}

/**
 * No DEFAULT_MAX_TOKENS. Anthropic's API demands `max_tokens`; the Responses
 * API does not, so an unset option omits `max_output_tokens` and leaves the
 * provider's own ceiling in place. A cap invented here would truncate an
 * answer OpenAI would have finished.
 */
export interface OpenAIOptions {
  // Absent when no credential resolved. The provider still answers the model
  // reference and reports itself unavailable, so a Run says the credential is
  // missing rather than claiming the model does not exist.
  readonly credential?: Credential
  // 0 or absent -> omit max_output_tokens.
  readonly maxTokens?: number
  // A test's, and answers as it is.
  readonly client?: OpenAI
}

export const makeOpenAIProvider = (options: OpenAIOptions): Provider =>
  streamingProvider<OpenAI>({
    id: PROVIDER_ID,
    available: () => options.client !== undefined || options.credential !== undefined,
    /**
     * The Responses dialect can carry tools and this adapter does not put them
     * on the wire yet, so it says so — a Run that offered some is Degraded
     * rather than one whose model quietly proposed no calls.
     */
    carriesTools: false,
    classify,

    clientFor: Effect.fn("eva.provider.openai.client")(function* () {
      if (options.client !== undefined) return options.client
      if (options.credential === undefined) {
        return yield* Effect.fail(missingCredential(PROVIDER_ID, NAMESPACE))
      }
      const key = yield* secretOf(options.credential, PROVIDER_ID)
      // Zero retries: a retry is a record of its own, and a hidden one is
      // missing from the Trace that exists to show it.
      return new OpenAI({ apiKey: key, maxRetries: 0 })
    }),

    start: (client, request, emit) => {
      const blocks = makeBlocks()
      let refused = false

      // `store: false` and no `previous_response_id`: Eva sends the whole
      // transcript from its own fold every Provider Turn, so the Trace stays
      // the only record of the Run.
      const stream = client.responses.stream({
        model: request.model.model,
        input: [...chatMessages(request.messages)],
        ...(request.system === undefined ? {} : { instructions: request.system }),
        ...((options.maxTokens ?? 0) > 0 ? { max_output_tokens: options.maxTokens } : {}),
        store: false,
      })

      stream.on("event", (event) => {
        // A failed response ends the stream cleanly and the terminal promise
        // resolves with it, so the failure is read here or a masked Run
        // reports usage and no error. An in-band `error` event never reaches
        // this handler: the SDK throws it, which rejects the terminal
        // promise below.
        if (event.type === "response.failed") {
          const cause = event.response.error
          emit.fail(new OpenAI.APIError(undefined, cause ?? undefined, cause?.message, undefined))
          return
        }

        // Framing — part boundaries and the response envelope — is structure
        // and not content, and the `usage` record and the Run's close
        // already carry what it says.
        if (!event.type.endsWith(".delta")) return

        if (event.type === "response.output_text.delta") {
          emit.payload({
            kind: "text",
            block: blocks(`${event.output_index}:c${event.content_index}`),
            content: { type: "text", text: event.delta },
          })
          return
        }

        // A refusal is a content part the provider labelled, so it is shown
        // as text and remembered for the stop reason.
        if (event.type === "response.refusal.delta") {
          refused = true
          emit.payload({
            kind: "text",
            block: blocks(`${event.output_index}:c${event.content_index}`),
            content: { type: "text", text: event.delta },
          })
          return
        }

        if (event.type === "response.reasoning_summary_text.delta") {
          emit.payload({
            kind: "thought",
            block: blocks(`${event.output_index}:s${event.summary_index}`),
            content: { type: "text", text: event.delta },
          })
          return
        }

        // A delta is content the model produced. One the union has no kind
        // for is preserved rather than dropped, so a stage that maps it later
        // reads a Trace that kept it.
        emit.payload({ kind: "unknown", originalKind: event.type, raw: event })
      })

      stream
        .finalResponse()
        .then((response) => {
          emit.payload(toUsage(response.model, response.usage ?? undefined))
          emit.end(toStopReason(response, refused))
        })
        .catch((cause: unknown) => emit.fail(cause))

      return { abort: () => stream.abort() }
    },
  })
