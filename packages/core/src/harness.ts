import type {
  AgentCapabilities,
  ClientCapabilities,
  PermissionOutcome,
  PermissionRequest,
} from "@missingstudio/eva-acp"
import type { Payload, SessionID, StopReason } from "@missingstudio/eva-schema"
import type { Effect, Scope, Stream } from "effect"
import type { SubmitInput } from "./session-api.js"
import type { RunInput, RunResult } from "./session.js"

/**
 * What a harness implements. This is the subset a native one needs; the rest
 * of ACP lands with the row that needs it. It did not change when the harness
 * domain gained a runnable row — what Eva hands a native harness is
 * `HarnessHost`, not a second contract.
 */
export interface Harness {
  readonly id: string
  readonly capabilities: AgentCapabilities
  readonly initialize: (client: HarnessClient) => Effect.Effect<AgentCapabilities>
  readonly createSession: (cwd: string) => Effect.Effect<SessionID, never, Scope.Scope>
  readonly resumeSession: (id: SessionID) => Effect.Effect<ResumeResult>
  readonly prompt: (id: SessionID, input: SubmitInput) => Effect.Effect<StopReason>
  readonly cancel: (id: SessionID) => Effect.Effect<void>
  // Raw session updates, as the wire sends them. `payloads` in the acp
  // package is what reads them, because the block index is the stream's.
  readonly updates: Stream.Stream<unknown>
}

/**
 * What Eva hands a native Harness. It is the in-process transport of the
 * harness contract: direct calls, no serialization. A Harness reached over the
 * ACP wire is handed nothing here, because it brings its own model access.
 */
export interface HarnessHost {
  /**
   * One Run: `submit` with the kernel's slots and hooks already bound, so a
   * native Harness gets the same path every other caller uses — one Recorder
   * open, block grouping, the four provider hooks, the Budget charge, and a
   * close on interrupt. It is the only thing here that opens a Run and the
   * only thing that closes one.
   */
  readonly run: (input: RunInput) => Effect.Effect<RunResult>
  /**
   * Commits one group through the same Recorder, outside any Run. It opens no
   * Run, closes none, and groups nothing by block, so `run` is still the one
   * Run path.
   *
   * A Workflow needs it for a `verdict`: a Verdict is known only after the Run
   * that produced the Candidate has closed, and it must be on the Trace before
   * a Repair is paid for. Without it an interrupt loses the first-pass record,
   * and a rate measured from the Trace then counts fewer Candidates than ran.
   *
   * An empty Recorder slot commits nothing and does not fail, which is the
   * rule `submit` already follows.
   */
  readonly report: (payloads: readonly Payload[]) => Effect.Effect<void>
}

export interface HarnessClient {
  readonly capabilities: ClientCapabilities
  readonly requestPermission: (request: PermissionRequest) => Effect.Effect<PermissionOutcome>
  // Lenient for the same reason `updates` is: this is the wire, not a record.
  readonly sessionUpdate: (update: unknown) => Effect.Effect<void>
}

// `undetectable` is what keeps a resume honest: the adapter cannot tell.
export type ResumeResult =
  | { readonly kind: "resumed"; readonly session: SessionID }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "undetectable" }
