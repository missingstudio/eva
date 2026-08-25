import type {
  Claim,
  Event,
  Fault,
  Payload,
  RunID,
  SessionID,
  StopReason,
} from "@missingstudio/eva-schema"
import { Data } from "effect"
import type { Effect, Scope, Stream } from "effect"
import type { BudgetDecision, BudgetState, Usage } from "./spec.js"
import type { Session, SessionHeader, Transcript } from "./transcript.js"

// The append-only store every Event lands in. A closed trace still parses.
export interface TraceSink {
  // Commits a group atomically and returns the events with trace positions.
  readonly append: (group: readonly Event[]) => Effect.Effect<readonly Event[]>
  // Where each session's trace got to. A resume checks its gap against this
  // before it reads anything.
  readonly highWater: Effect.Effect<ReadonlyMap<SessionID, number>>
  // Replays a session's events in trace order.
  readonly replay: (session: SessionID) => Stream.Stream<Event>
  /**
   * The record from the moment of subscription: every event that commits
   * after this resolves, in trace order. The subscription is taken when the
   * effect resolves, not when the stream runs, so a caller can subscribe
   * first and read second — an event that commits between the two is held
   * here rather than lost.
   */
  readonly follow: (session: SessionID) => Effect.Effect<Stream.Stream<Event>, never, Scope.Scope>
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

export class ValidatorError extends Data.TaggedError("ValidatorError")<{
  readonly message: string
}> {}

/**
 * What `check` answers about one Candidate. `value` is the parsed Output, so
 * the caller does not parse twice; it never reaches a record, because the
 * Candidate is already in the Trace as `text`.
 *
 * The field is spelled `verdict` in both variants and on the record, so there
 * is one word and one spelling. A Validator never answers `unchecked`: an
 * empty Slot answers nothing, and the caller writes that word.
 */
export type Judged =
  | { readonly verdict: "valid"; readonly value: unknown }
  | { readonly verdict: "invalid"; readonly faults: readonly Fault[] }

/**
 * Judges one Candidate against a JSON Schema. It judges form, never truth, and
 * it never calls a model. The Repair is the caller's.
 *
 * Faults are one per instance location, after reduction. A Validator that
 * reports one Fault per document and one that reports one per location give
 * different numbers for the same Runs, and the Slot exists to allow the swap —
 * so the rule lives here, where a second Validator plugin will read it.
 */
export interface Validator {
  /**
   * Fails only when the JSON Schema itself cannot be read. A Workflow calls
   * this once per Step before it opens a Run, so an author's broken schema
   * stops the Workflow instead of reading as a Candidate the model got wrong
   * and lowering the measured rate for the wrong reason.
   */
  readonly accepts: (schema: unknown) => Effect.Effect<void, ValidatorError>
  /**
   * `candidate` is text, because at Stage 1 a Candidate is the Step's `text`
   * payloads joined and `ProviderRequest` has no response-format field.
   * Extract, parse and check are one judgement, so a Candidate that is not
   * JSON at all gets one Verdict and one Fault set rather than a parse failure
   * the caller has to word itself.
   */
  readonly check: (schema: unknown, candidate: string) => Effect.Effect<Judged, ValidatorError>
}
