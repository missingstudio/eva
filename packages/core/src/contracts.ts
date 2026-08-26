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
  /**
   * Where one session's trace got to. A resume checks its gap against this
   * before it reads anything, and no caller needs every session at once.
   *
   * A store that allocates in its own transaction answers what is durable.
   * One that cannot is numbered in this process, and answers what this
   * process committed — the same trade its README states, and the reason a
   * second writer on those stores is not a posture Eva supports.
   */
  readonly highWater: (session: SessionID) => Effect.Effect<number>
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
  /**
   * Every session's Header. Every sink answers it: a store that keeps
   * Headers beside the log says so cheaply, and one that does not is folded
   * over its own replay — so a caller has one way to ask and never a branch
   * about which sink it got.
   *
   * In no order. The listing is what states an order, because a listing
   * holds Sessions a Trace has never seen; a sink that sorted here would be
   * paying for a promise its caller has to make again anyway.
   */
  readonly headers: Effect.Effect<readonly SessionHeader[]>
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
  /**
   * Every Session, in one stated order: most recently updated first, id as
   * the tiebreak, newer first — `byRecency` is the rule written down. The
   * order used to be whatever a store's walk produced, so a terminal fold
   * and a web fold were one accident away from disagreeing about what Eva
   * holds. Every store owes this same order.
   */
  readonly list: Effect.Effect<readonly SessionHeader[]>
}

/**
 * A program and the arguments it is started with, already split. Nothing
 * here reaches a shell, so a caller that wants shell syntax names the shell
 * in `argv` itself — and a gate that judges a command sees the words that
 * will really run.
 */
export interface Command {
  readonly argv: readonly string[]
  // Where the process starts. Absent means the calling process's directory.
  readonly cwd?: string
  // Added to the environment the process inherits.
  readonly env?: Readonly<Record<string, string>>
}

// One piece of a process's output, named by the stream it arrived on.
export interface OutputChunk {
  readonly stream: "stdout" | "stderr"
  readonly text: string
}

/**
 * How a process ended. A nonzero code is a result and not a failure of the
 * call: the caller reports the exit and the Run carries on.
 */
export interface Exited {
  // Null when a signal ended the process.
  readonly code: number | null
  readonly signal: string | null
}

export interface Process {
  /**
   * stdout and stderr, merged in arrival order, while the process runs. The
   * chunks are queued as they arrive, so a reader that starts late still
   * reads from the first one, and each chunk is handed out once.
   */
  readonly output: Stream.Stream<OutputChunk>
  // Waits for the process to end. Safe to read more than once.
  readonly exit: Effect.Effect<Exited>
  readonly kill: Effect.Effect<void>
}

export class ShellError extends Data.TaggedError("ShellError")<{
  readonly reason: "not_found" | "spawn_failed"
  readonly message: string
}> {}

/**
 * Starts a process and streams its output. A spawn that never started is the
 * only failure; after that every ending is a result the caller reports.
 *
 * The Scope owns the process: a process still running when the scope closes
 * is killed, so a Run that ends never leaves one behind.
 */
export interface Shell {
  readonly spawn: (command: Command) => Effect.Effect<Process, ShellError, Scope.Scope>
}

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly path: string
  readonly reason: "outside_root" | "not_found" | "io"
  readonly message: string
}> {}

export interface FileStat {
  readonly kind: "file" | "directory"
  // Zero for a directory: what a directory measures is the store's business.
  readonly bytes: number
}

/**
 * Reads and writes files under one root. A path is relative to the root, or
 * absolute and under it, and one that lands outside is refused with
 * `outside_root` — which is the whole reason a tool asks the Slot and never
 * the disk.
 *
 * `write` makes the parent directories it needs. `glob` answers paths
 * relative to the root, files only, sorted, and `globMatcher` is the pattern
 * rule every filler owes — one walking a disk and one walking a map answer
 * the same paths.
 */
export interface FileSystem {
  readonly read: (path: string) => Effect.Effect<string, FileSystemError>
  readonly write: (path: string, content: string) => Effect.Effect<void, FileSystemError>
  readonly glob: (pattern: string) => Effect.Effect<readonly string[], FileSystemError>
  // Nothing at the path is `undefined` rather than a failure.
  readonly stat: (path: string) => Effect.Effect<FileStat | undefined, FileSystemError>
}

// One kind of containment a Sandbox may hold a command to.
export type SandboxControl = "filesystem" | "network"

/**
 * What a command may reach. The policy is stated in full whatever the
 * Sandbox behind it can hold, because the policy is the caller's decision
 * and the containment is a property of the machine.
 */
export interface SandboxPolicy {
  // Absolute paths the command may read.
  readonly readable: readonly string[]
  // Absolute paths the command may write.
  readonly writable: readonly string[]
  readonly network: boolean
}

/**
 * What this Sandbox really enforces, so a caller reports the containment it
 * has rather than the containment it asked for. `eva.sandbox.none` enforces
 * nothing and answers an empty list; a filler that enforces a control names
 * it here.
 */
export interface SandboxCapabilities {
  readonly enforces: readonly SandboxControl[]
}

export class SandboxError extends Data.TaggedError("SandboxError")<{
  readonly reason: "unavailable" | "spawn_failed"
  readonly message: string
}> {}

/**
 * Runs a command under a policy. The policy decides, the Sandbox enforces,
 * and `capabilities` says how much of the policy this one holds.
 *
 * `run` answers the same `Process` a Shell does, because containment is how
 * a process starts and not what it returns: a Sandbox that wraps the argv
 * spawns through the Shell, one that needs its own spawn call makes it, and
 * the caller reads the output the same way either way.
 */
export interface Sandbox {
  readonly run: (
    command: Command,
    policy: SandboxPolicy,
  ) => Effect.Effect<Process, SandboxError, Scope.Scope>
  readonly capabilities: Effect.Effect<SandboxCapabilities>
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

// One replacement in one file. `find` must appear exactly once.
export interface Hunk {
  readonly find: string
  readonly replace: string
}

// A structured edit: one file, and the Hunks to land in it, in order.
export interface Edit {
  readonly path: string
  readonly hunks: readonly Hunk[]
}

/**
 * A resolved Edit, and what a dry run answers. `after` is the whole content
 * an apply writes, so every Hunk has already landed here: an apply is one
 * `write`, and there is no half-edited file for a caller to roll back.
 *
 * `base` fingerprints the content the Preview was computed against. It is
 * opaque — only the applier that made it reads it — and it is how a Preview
 * whose file moved underneath it is refused instead of applied.
 */
export interface Preview {
  readonly path: string
  readonly base: string
  readonly after: string
  readonly hunks: number
}

// What one apply wrote, and what reverses it byte for byte.
export interface Applied {
  readonly path: string
  // The content the file held before the apply.
  readonly before: string
  // Fingerprints what the apply wrote, the way `Preview.base` does.
  readonly wrote: string
}

/**
 * Why an applier would not write: a Hunk that is not there, a Hunk that is
 * there more than once, or a file that changed after the Preview read it.
 * Every reason is typed data a caller reports — a tool turns one into a
 * result the model can act on, and nothing throws.
 */
export class DiffRefused extends Data.TaggedError("DiffRefused")<{
  readonly reason: "hunk_missing" | "hunk_ambiguous" | "stale"
  readonly path: string
  // Which Hunk, counted from zero. Absent when the file itself is stale.
  readonly hunk?: number
  // How many times an ambiguous Hunk's `find` appears.
  readonly found?: number
  readonly message: string
}> {}

/**
 * Previews a structured Edit, then applies it. A Preview touches nothing, an
 * apply writes once, and a reverse restores what was there byte for byte —
 * which is what makes every write previewed and undoable before a Snapshot
 * exists.
 *
 * The part of a `FileSystem` it reads and writes through is handed in at each
 * call, so an applier works against whichever one the caller holds — the
 * Slot's filling in a Run, a virtual one in a test — reads no Slot of its own,
 * and can never hold a slot value across an await.
 *
 * A `FileSystemError` stays in the error channel beside `DiffRefused`. A read
 * the file system refuses — a path outside the root, a file that is not there
 * — is a real outcome the caller reports, and an applier that swallowed one
 * would answer for a write it never made.
 */
export interface DiffApplier {
  readonly preview: (
    files: Pick<FileSystem, "read" | "write">,
    edit: Edit,
  ) => Effect.Effect<Preview, DiffRefused | FileSystemError>
  readonly apply: (
    files: Pick<FileSystem, "read" | "write">,
    preview: Preview,
  ) => Effect.Effect<Applied, DiffRefused | FileSystemError>
  // Reverses one apply, and answers the apply that reverses the reverse.
  readonly reverse: (
    files: Pick<FileSystem, "read" | "write">,
    applied: Applied,
  ) => Effect.Effect<Applied, DiffRefused | FileSystemError>
}
