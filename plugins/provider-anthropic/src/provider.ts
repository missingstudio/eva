import Anthropic from "@anthropic-ai/sdk"
import type { Credential, ProposedCall, Provider, ToolDefinition } from "@missingstudio/eva-core"
import type { ErrorClass, StopReason } from "@missingstudio/eva-schema"
import {
  chatMessages,
  classifyWire,
  missingCredential,
  reported,
  secretOf,
  streamingProvider,
} from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// Two identifiers, never one. The first names the plugin in a ProviderError
// and a Claim; the second is what appears in a ModelRef, a usage.model
// prefix, the price lookup, and as the Credential id.
export const PROVIDER_ID = "eva.provider.anthropic"
export const NAMESPACE = "anthropic"

// Anthropic reports token counts and never a request cost, so `costTicks`
// stays absent and the Run reports the gap rather than computing a figure.
export const REPORTS_COST = false
const DEFAULT_MAX_TOKENS = 64_000

// The Anthropic SDK's failure, read into the one wire table. `billing_error`
// is the vendor's own marker and outranks whatever status carried it.
export const classify = (cause: unknown): ErrorClass =>
  classifyWire(
    cause instanceof Anthropic.APIConnectionError
      ? { connection: true }
      : cause instanceof Anthropic.APIError
        ? {
            ...(cause.status === undefined ? {} : { status: cause.status }),
            billing: cause.type === "billing_error",
          }
        : undefined,
  )

/**
 * ACP's five reasons. `tool_use` and `pause_turn` both end the turn and are
 * `end_turn`: what continues the work is the calls the turn proposed, which
 * the loop reads off `toolCalls`, and a stop sequence ends the turn too. A
 * message that names no reason reports none: silence is not `end_turn`.
 */
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

/**
 * One tool as this wire offers it. The JSON Schema goes over as it is: it is
 * the model that reads it, so a dialect that edited it would show the model
 * something the tool does not accept.
 */
export const offering = (tool: ToolDefinition): Anthropic.Tool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input as Anthropic.Tool["input_schema"],
})

/**
 * The calls the response proposed. `input` is already parsed by the SDK, so
 * the arguments arrive as the model wrote them and the tool reads its own.
 */
export const proposedIn = (content: readonly Anthropic.ContentBlock[]): readonly ProposedCall[] =>
  content.flatMap((block) =>
    block.type === "tool_use" ? [{ id: block.id, name: block.name, args: block.input }] : [],
  )

export interface AnthropicOptions {
  // Absent when no credential resolved. The provider still answers the model
  // reference and reports itself unavailable, so a Run says the credential is
  // missing rather than claiming the model does not exist.
  readonly credential?: Credential
  readonly maxTokens?: number
  readonly client?: Anthropic
}

export const makeAnthropicProvider = (options: AnthropicOptions): Provider =>
  streamingProvider<Anthropic>({
    id: PROVIDER_ID,
    available: () => options.client !== undefined || options.credential !== undefined,
    classify,

    clientFor: Effect.fn("eva.provider.anthropic.client")(function* () {
      if (options.client !== undefined) return options.client
      if (options.credential === undefined) {
        return yield* Effect.fail(missingCredential(PROVIDER_ID, NAMESPACE))
      }
      const key = yield* secretOf(options.credential, PROVIDER_ID)
      return new Anthropic({ apiKey: key, maxRetries: 0 })
    }),

    start: (client, request, emit) => {
      const offered = (request.tools ?? []).map(offering)

      const stream = client.messages.stream({
        model: request.model.model,
        max_tokens: options.maxTokens ?? request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system === undefined ? {} : { system: request.system }),
        ...(offered.length === 0 ? {} : { tools: offered }),
        messages: [...chatMessages(request.messages)],
      })

      stream.on("streamEvent", (event) => {
        // Framing — the block boundaries and the message envelope — is
        // structure and not content, and the `usage` record and the Run's
        // close already carry what it says.
        if (event.type !== "content_block_delta") return

        const delta = event.delta
        if (delta.type === "text_delta") {
          emit.payload({
            kind: "text",
            block: event.index,
            content: { type: "text", text: delta.text },
          })
          return
        }

        if (delta.type === "thinking_delta") {
          emit.payload({
            kind: "thought",
            block: event.index,
            content: { type: "text", text: delta.thinking },
          })
          return
        }

        /**
         * The arguments of a proposed call, arriving a fragment at a time.
         * The proposal carries them whole after the drain, and the pipeline
         * is what records a call, so a fragment here says nothing the record
         * does not already hold.
         */
        if (delta.type === "input_json_delta") return

        // A delta is content the model produced. One the union has no kind
        // for is preserved rather than dropped, so a stage that maps it later
        // reads a Trace that kept it.
        emit.payload({ kind: "unknown", originalKind: delta.type, raw: event })
      })

      stream
        .finalMessage()
        .then((message) => {
          const usage = message.usage
          emit.payload({
            kind: "usage",
            model: `${NAMESPACE}/${message.model}`,
            inputTokens: reported(usage.input_tokens),
            outputTokens: reported(usage.output_tokens),
            cacheWriteTokens: reported(usage.cache_creation_input_tokens),
            cacheReadTokens: reported(usage.cache_read_input_tokens),
          })
          emit.end(toStopReason(message.stop_reason), proposedIn(message.content))
        })
        .catch((cause: unknown) => emit.fail(cause))

      return { abort: () => stream.abort() }
    },
  })
