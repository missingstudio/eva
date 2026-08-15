import type { ErrorClass, Payload, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { Data, Effect } from "effect"
import type { Stream } from "effect"
import type { ModelRef } from "./spec.js"

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly provider: string
  readonly errorClass: ErrorClass
  readonly message: string
}> {}

export interface ProviderRequest {
  readonly model: ModelRef
  readonly system?: string
  readonly messages: readonly TranscriptMessage[]
  readonly maxTokens?: number
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
 */
export interface ProviderTurn {
  readonly payloads: Stream.Stream<Payload, ProviderError>
  readonly stopReason: Effect.Effect<StopReason | undefined>
}

// A turn from a provider that cannot say why the exchange ended.
export const providerTurn = (
  payloads: Stream.Stream<Payload, ProviderError>,
  stopReason?: StopReason,
): ProviderTurn => ({ payloads, stopReason: Effect.succeed(stopReason) })

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
