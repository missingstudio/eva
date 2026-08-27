import type { ErrorClass, Payload, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { Data, Effect } from "effect"
import type { Stream } from "effect"
import type { ModelRef } from "./spec.js"

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly provider: string
  readonly errorClass: ErrorClass
  readonly message: string
}> {}

/**
 * One tool as a provider is shown it. It is `ToolInfo` without the behaviour:
 * a request carries data, and the row that holds the action stays in the tool
 * domain.
 *
 * `input` is the JSON Schema of the arguments, typed the way a Validator types
 * a schema, because nothing here reads it. Every wire that offers tools takes
 * these three fields, so a foreign adapter fills the same shape.
 */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: unknown
}

export interface ProviderRequest {
  readonly model: ModelRef
  readonly system?: string
  readonly messages: readonly TranscriptMessage[]
  readonly maxTokens?: number
  /**
   * The tools the model may call. Absent means it is shown none, which is
   * what a Run with no agency asks for. The list is on the request rather
   * than assembled by a hook, because which tools one Run offers is that
   * Run's own statement — `provider.request.before` may still change it, the
   * way it may change every other field.
   */
  readonly tools?: readonly ToolDefinition[]
}

/**
 * One call a response proposed, before anything ran it. `args` is `unknown`
 * because the model wrote them: a tool reads its own arguments and answers a
 * Disposition when they say nothing it can use.
 */
export interface ProposedCall {
  readonly id: string
  readonly name: string
  readonly args: unknown
}

/**
 * One exchange with a provider. `payloads` begins the Provider Turn and
 * yields until the stream ends; a Provider Turn is not a unit of record, so
 * nothing here writes to the Trace.
 *
 * `stopReason` says why this exchange ended, and is read once the stream has
 * drained. Before that it answers `undefined` — which is what an unreported
 * reason means — so reading it early understates and never misleads. A Run
 * has one Stop Reason and takes it from the turn that closed it.
 *
 * `toolCalls` is read after the drain for the same reason and answers nothing
 * before it. It is not a payload: the execution that runs a call writes the
 * `tool_call` record once the deciding boundary has settled the arguments, and
 * a proposal on the stream would be a second record of the same call naming
 * arguments nothing ran with. A provider that offers no tools omits it.
 */
export interface ProviderTurn {
  readonly payloads: Stream.Stream<Payload, ProviderError>
  readonly stopReason: Effect.Effect<StopReason | undefined>
  readonly toolCalls?: Effect.Effect<readonly ProposedCall[]>
}

// A turn from a provider that cannot say why the exchange ended.
export const providerTurn = (
  payloads: Stream.Stream<Payload, ProviderError>,
  stopReason?: StopReason,
  toolCalls: readonly ProposedCall[] = [],
): ProviderTurn => ({
  payloads,
  stopReason: Effect.succeed(stopReason),
  toolCalls: Effect.succeed(toolCalls),
})

export interface Provider {
  readonly id: string
  // Checked at construction, so a Run never starts against a dead provider.
  readonly available: () => boolean
  readonly turn: (request: ProviderRequest) => ProviderTurn
}

// Which client answers a model reference. `model.resolve` may change it.
export interface ModelResolution {
  readonly model: ModelRef
  readonly provider: Provider
}

export interface Retry {
  readonly retry: boolean
  // How many attempts the policy allows, so a `retry` record can say
  // which attempt this was out of how many.
  readonly max: number
  readonly delayMs: number
}

export type RetryPolicy = (error: ProviderError, attempt: number) => Effect.Effect<Retry> | Retry
