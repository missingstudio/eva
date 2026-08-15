import type { Claim, Event, Payload, RunID, SessionID, StopReason } from "@missingstudio/eva-schema"
import { Data } from "effect"
import type { Effect, Stream } from "effect"
import type { BudgetDecision, BudgetState, Usage } from "./spec.js"
import type { Session, SessionHeader, Transcript } from "./transcript.js"

// The append-only store every Event lands in. A closed trace still parses.
export interface TraceSink {
  // Commits a group atomically and returns the events with trace positions.
  readonly append: (group: readonly Event[]) => Effect.Effect<readonly Event[]>
  // Replays a session's events in trace order.
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  // Every session the trace holds, so a new process can list what is there.
  readonly sessions: Effect.Effect<readonly SessionID[]>
  readonly close: Effect.Effect<void>
}

// The one path to the trace. It owns the trace position and closes the Run.
export interface Recorder {
  readonly open: (session: SessionID) => Effect.Effect<RunID>
  readonly commit: (payloads: readonly Payload[]) => Effect.Effect<void>
  // Writes the closing `finished` record, so nothing else may. Idempotent.
  readonly close: (claim: Claim, stopReason?: StopReason) => Effect.Effect<void>
}

// The durable transcript. Resume, branch, and rewind act on this.
export interface SessionStore {
  readonly create: Effect.Effect<Session>
  readonly open: (id: SessionID) => Effect.Effect<Session>
  readonly fold: (id: SessionID) => Effect.Effect<Transcript>
  readonly list: Effect.Effect<readonly SessionHeader[]>
}

/**
 * How a turn authenticates. The configured mode alone decides: an exported
 * key does not outrank a login and a login does not outrank a key. Nothing
 * falls back to whatever happens to be on the machine, because a stale
 * credential that silently wins bills an account nobody chose.
 */
export type CredentialMode = "api_key" | "oauth"

export interface CredentialRef {
  readonly id: string
  readonly mode: CredentialMode
  // An oauth credential that has expired and cannot renew. A turn under it
  // fails with `auth_failed`, and `eva auth status` says which one.
  readonly expired?: boolean
}

export class CredentialError extends Data.TaggedError("CredentialError")<{
  readonly id: string
  readonly reason: "missing" | "expired" | "refresh_failed"
  readonly message: string
}> {}

/**
 * What a Provider is handed. `secret` is resolved per attempt rather than
 * read once, because a session outlives an access token: an oauth
 * credential renews before it answers, and the renewed token is persisted
 * before it is used. The secret stays behind a call, so it is never a field
 * that logging or serialization reaches — an Effect value would be, because
 * a resolved one holds its result and `JSON.stringify` prints it.
 */
export interface Credential {
  readonly mode: CredentialMode
  readonly secret: () => Effect.Effect<string, CredentialError>
}

/**
 * What a store keeps. This is the only shape that reaches disk, so it holds
 * no closures and no live state.
 */
export type StoredCredential =
  | { readonly mode: "api_key"; readonly key: string }
  | {
      readonly mode: "oauth"
      readonly access: string
      readonly refresh?: string
      // Epoch milliseconds. Absent means the token does not self-report one.
      readonly expiresAt?: number
    }

export interface CredentialStore {
  readonly get: (id: string) => Effect.Effect<Credential | undefined>
  readonly set: (id: string, credential: StoredCredential) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly list: Effect.Effect<readonly CredentialRef[]>
}

export interface Budget {
  readonly charge: (usage: Usage) => Effect.Effect<BudgetState>
  readonly state: Effect.Effect<BudgetState>
  // Answers whether the next Provider Turn is affordable under the limits.
  readonly check: Effect.Effect<BudgetDecision>
}
