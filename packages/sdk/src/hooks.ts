import type {
  HookBoundaries,
  ModelRef,
  ModelResolution,
  ProviderError,
  ProviderRequest,
  Retry,
  ToolDecision,
  ToolInfo,
  ToolResult,
} from "@missingstudio/eva-core"
import type { Payload, SessionID, ToolKind } from "@missingstudio/eva-schema"

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

export interface ToolResolve {
  readonly name: string
  readonly session: SessionID
  /**
   * Set-only, as `model.resolve` is: a hook states its own answer and a later
   * hook replaces it. The row the tool domain holds is the answer no hook
   * changed.
   */
  resolve(tool: ToolInfo): void
}

export interface ToolExecuteBefore {
  readonly name: string
  /**
   * What the named tool is. The caller of this boundary resolved the row this
   * call runs — the boundary stands in front of a tool that exists, so a name
   * nothing answers never reaches it — and every gate here judges that row's
   * kind rather than reading the domain a second time. One read, so two gates
   * cannot disagree about what a call is.
   */
  readonly kind: ToolKind
  readonly session: SessionID
  readonly args: {
    get(): unknown
    update(next: (args: unknown) => unknown): void
  }
  /**
   * The strictest decision wins, and a boundary nobody decided at allows. An
   * `ask` that reaches the tool still unanswered is a denial.
   */
  decide(decision: ToolDecision): void
  /**
   * What happens when nothing decided. A baseline and not a decision: it is
   * read only when no hook at this boundary decided anything at all, and the
   * strictest of the baselines wins among themselves.
   *
   * A permission mode is what needs it. "Ask before a change" is a baseline —
   * a rule a person already wrote is standing authority and must not be asked
   * about again — and at a boundary where the strictest decision wins there is
   * no way to say "unless" except by one hook reading another's answer, which
   * is order-dependent, or by reading another plugin's rules, which no plugin
   * may do. A mandate stays a decision: `decide` is what a mode refuses with.
   */
  otherwise(decision: ToolDecision): void
}

export interface ToolExecuteAfter {
  readonly name: string
  readonly session: SessionID
  readonly result: {
    get(): ToolResult
    update(next: (result: ToolResult) => ToolResult): void
  }
}

// The tool boundaries, declared the way the provider spec is: one map from
// hook name to event shape, so a misspelling is a compile error.
export interface ToolHookSpec {
  "tool.resolve": ToolResolve
  "tool.execute.before": ToolExecuteBefore
  "tool.execute.after": ToolExecuteAfter
}

/**
 * `tool.execute.before` is the first deciding boundary in the tree: the call
 * it stands in front of may not run without it, so a hook there that throws
 * denies the call rather than being reported and passed over.
 *
 * The other two observe. One states which tool answers a name and one reads
 * what the tool answered, and neither may end a call by failing.
 */
export const TOOL_BOUNDARIES: HookBoundaries<ToolHookSpec> = {
  "tool.resolve": "observing",
  "tool.execute.before": "deciding",
  "tool.execute.after": "observing",
}
