import type {
  AgentCapabilities,
  ClientCapabilities,
  PermissionOutcome,
  PermissionRequest,
} from "@missingstudio/eva-acp"
import type { SessionID, StopReason } from "@missingstudio/eva-schema"
import type { Effect, Scope, Stream } from "effect"
import type { SubmitInput } from "./session-api.js"

/**
 * The harness domain exists at stage 0 and holds nothing. These are the
 * types its first row will implement; no harness is registered yet.
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
