import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { Data } from "effect"
import type { Effect, Scope, Stream } from "effect"
import type { ModelRef } from "./spec.js"
import type { SessionHeader, Transcript } from "./transcript.js"

/**
 * How far behind a cursor may be and still be replayed, in events. Past it,
 * `watch` refuses instead of replaying, and the caller folds fresh with
 * `attach` and watches from the fold's own cursor. The trace is read whole
 * today, so the bound protects only the subscriber from an unbounded burst;
 * when the trace read pages, tie this to that page size.
 */
export const WATCH_REPLAY_BOUND = 1000

// A cursor whose gap to the head exceeds the bound. Not an event: it is a
// fact about one subscription, and nothing happened in the session.
export class ResumeTooFarBehind extends Data.TaggedError("ResumeTooFarBehind")<{
  readonly from: Cursor
  readonly head: number
}> {}

export type SubmitInput =
  | {
      readonly kind: "prompt"
      readonly text: string
      /**
       * Which harness row answers this Prompt. Absent keeps the behaviour a
       * Prompt has always had: one Run against the resolved model, no Harness
       * involved — so `eva --print` and the Console are untouched.
       *
       * It rides the Prompt rather than a config key. A Workflow selected by a
       * file the Run does not name is a Run nobody can reproduce.
       */
      readonly harness?: string
    }
  | { readonly kind: "steer"; readonly text: string; readonly target: "next-run" | "next-step" }

export type CancelCause = "user" | "budget" | "shutdown"

export type FrontendAnswer =
  | { readonly kind: "permission"; readonly optionId: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "cancelled" }

export type RequestID = string

/**
 * The whole of what a Surface may do to Eva, the same in this process or
 * across a socket. A surface reads two sources and never confuses them:
 * `watch` while a Run is open, `attach` for everything committed.
 */
export interface SessionAPI {
  /**
   * Opens a Session in the directory a harness will take as its `cwd`. A
   * caller that names none is answered in the directory the process is in,
   * because a browser holds no honest path.
   */
  readonly create: (location?: string) => Effect.Effect<SessionID>
  readonly list: Effect.Effect<readonly SessionHeader[]>
  readonly attach: (session: SessionID) => Effect.Effect<Transcript, never, Scope.Scope>
  /**
   * Without a cursor: the live stream, from here on. With one: the record —
   * committed groups after that position, exactly once, then the committed
   * stream as it grows. A cursor is a trace position and positions exist
   * only on committed events, so a resumed watch cannot carry the live
   * deltas; what it carries is what `attach` would fold.
   *
   * Only the cursor form can fail. A watch with no cursor is not behind
   * anything, so its type does not make a caller handle a refusal that
   * cannot arrive.
   */
  readonly watch: {
    (session: SessionID): Stream.Stream<Payload>
    (session: SessionID, from: Cursor): Stream.Stream<Payload, ResumeTooFarBehind>
  }
  readonly submit: (session: SessionID, input: SubmitInput) => Effect.Effect<void>
  readonly cancel: (session: SessionID, cause: CancelCause) => Effect.Effect<void>
  readonly model: {
    readonly get: (session: SessionID) => Effect.Effect<ModelRef>
    readonly set: (session: SessionID, model: ModelRef) => Effect.Effect<void>
  }
  readonly answer: (request: RequestID, answer: FrontendAnswer) => Effect.Effect<void>
}
