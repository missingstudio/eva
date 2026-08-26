import type {
  HookBoundaries,
  ModelRef,
  ModelResolution,
  ProviderError,
  ProviderRequest,
  Retry,
} from "@missingstudio/eva-core"
import type { Payload } from "@missingstudio/eva-schema"

// A hook changes an operation through purpose-built methods, never a field.
export interface ModelResolve {
  readonly reference: ModelRef
  // A later hook replaces what an earlier one set, so load order decides.
  // There is no read: a hook states its own answer and does not negotiate.
  resolve(resolution: ModelResolution): void
}

export interface ProviderRequestBefore {
  readonly request: {
    get(): ProviderRequest
    update(next: (request: ProviderRequest) => ProviderRequest): void
  }
}

export interface ProviderResponseAfter {
  readonly payloads: {
    get(): readonly Payload[]
    update(next: (payloads: readonly Payload[]) => readonly Payload[]): void
  }
}

export interface ProviderRetry {
  readonly error: ProviderError
  readonly attempt: number
  decide(retry: Retry): void
}

// The one place a hook name and its event shape are declared. Registration
// and every `run` call check against this map, so a misspelling is a
// compile error rather than a hook that never fires.
export interface ProviderHookSpec {
  "model.resolve": ModelResolve
  "provider.request.before": ProviderRequestBefore
  "provider.response.after": ProviderResponseAfter
  "provider.retry": ProviderRetry
}

/**
 * What each provider boundary does. All four observe: none of them decides
 * whether a call proceeds, so one that throws is reported and the Run goes
 * on. A hook the spec declares and this map misses is a compile error, so a
 * new boundary has to say which kind it is.
 */
export const PROVIDER_BOUNDARIES: HookBoundaries<ProviderHookSpec> = {
  "model.resolve": "observing",
  "provider.request.before": "observing",
  "provider.response.after": "observing",
  "provider.retry": "observing",
}
