import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import type { Effect, Scope, Stream } from "effect"
import type { ModelRef } from "./spec.js"
import type { SessionHeader, Transcript } from "./transcript.js"

export type SubmitInput =
  | { readonly kind: "prompt"; readonly text: string }
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
  readonly create: (location: string) => Effect.Effect<SessionID>
  readonly list: Effect.Effect<readonly SessionHeader[]>
  readonly attach: (session: SessionID) => Effect.Effect<Transcript, never, Scope.Scope>
  readonly watch: (session: SessionID, from?: Cursor) => Stream.Stream<Payload>
  readonly submit: (session: SessionID, input: SubmitInput) => Effect.Effect<void>
  readonly cancel: (session: SessionID, cause: CancelCause) => Effect.Effect<void>
  readonly model: {
    readonly get: (session: SessionID) => Effect.Effect<ModelRef>
    readonly set: (session: SessionID, model: ModelRef) => Effect.Effect<void>
  }
  readonly answer: (request: RequestID, answer: FrontendAnswer) => Effect.Effect<void>
}
