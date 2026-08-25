/**
 * The package's fake `SessionAPI`, shared by its suites. `index.ts` does not
 * export it, so it ships nothing; it lives beside the code rather than inside
 * one test file because both the protocol and the seam are tested against the
 * same fake, and two copies of one fake are two fakes the moment either
 * changes.
 */

import {
  foldTranscript,
  type CancelCause,
  type FrontendAnswer,
  type ModelRef,
  type RequestID,
  type SessionAPI,
  type SessionHeader,
  type SubmitInput,
  type Transcript,
} from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type Cursor,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Deferred, Effect, PubSub, Stream } from "effect"

export const SESSION = sessionID("sess_client_runtime")
export const PROMPT: SubmitInput = { kind: "prompt", text: "say something" }
export const MODEL: ModelRef = { provider: "fake", model: "model" }

export const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

export const CLOSE: Payload = { kind: "finished", claim: { result: "done", summary: "ok" } }

// What `submit` does after the Run has said its payloads: close it, return
// without a close, or stay open until the caller interrupts.
export type Ending = "closes" | "silent" | "hangs"

export type Method =
  | "create"
  | "list"
  | "attach"
  | "watch"
  | "submit"
  | "cancel"
  | "model.get"
  | "model.set"
  | "answer"

export interface Call {
  readonly method: Method
  readonly args: readonly unknown[]
}

export interface Fake {
  readonly api: SessionAPI
  // Every method reached, in the order it was reached, with what it was given.
  readonly calls: readonly Call[]
  // How many watch streams are running. A `watch` in `calls` was asked for;
  // this one has subscribed.
  readonly open: () => number
  // Resolved once the Run has said everything it says.
  readonly said: Deferred.Deferred<void>
}

/**
 * One session, over a hub. Every payload the Run says is published live and
 * committed to the trace, so the fold after the stream is the record of the
 * same Run.
 */
export const fakeApi = Effect.fn("test.api")(function* (
  says: readonly Payload[],
  ending: Ending = "closes",
): Effect.fn.Return<Fake> {
  const hub = yield* PubSub.unbounded<Payload>()
  const committed: Event[] = []
  const calls: Call[] = []
  const said = yield* Deferred.make<void>()
  let open = 0
  let model: ModelRef = MODEL

  const took = (method: Method, ...args: readonly unknown[]) => void calls.push({ method, args })

  const say = (payload: Payload) =>
    Effect.gen(function* () {
      committed.push({
        id: eventID(`ev_${committed.length + 1}`),
        seq: committed.length + 1,
        at: { wall: "2026-08-25T00:00:00.000Z" },
        run: runID("run_1"),
        session: SESSION,
        parent: null,
        payload,
      })
      yield* PubSub.publish(hub, payload)
    })

  const api: SessionAPI = {
    create: (location: string) =>
      Effect.sync(() => {
        took("create", location)
        return SESSION
      }),
    list: Effect.sync(() => {
      took("list")
      return [{ id: SESSION }] satisfies readonly SessionHeader[]
    }),
    attach: (id: SessionID) =>
      Effect.sync(() => {
        took("attach", id)
        return foldTranscript(SESSION, committed)
      }),
    // The subscription is counted from inside the stream, so a test that has
    // to drop a live watch can wait for one rather than guess at it.
    watch: ((id: SessionID, from?: Cursor) => {
      took("watch", ...(from === undefined ? [id] : [id, from]))
      return Stream.unwrap(
        Effect.sync(() => {
          open += 1
          return Stream.ensuring(
            Stream.fromPubSub(hub),
            Effect.sync(() => void (open -= 1)),
          )
        }),
      )
    }) as SessionAPI["watch"],
    /**
     * The first word waits one turn of the event loop, which is what the real
     * Session API does — it forks the turn — so the watcher forked before
     * `submit` is subscribed when the Run starts to speak.
     */
    submit: (id: SessionID, input: SubmitInput) =>
      Effect.gen(function* () {
        took("submit", id, input)
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
        for (const payload of says) yield* say(payload)
        yield* Deferred.succeed(said, undefined)
        if (ending === "hangs") return yield* Effect.never
        if (ending === "closes") yield* say(CLOSE)
      }),
    cancel: (id: SessionID, cause: CancelCause) => Effect.sync(() => took("cancel", id, cause)),
    model: {
      get: (id: SessionID) =>
        Effect.sync(() => {
          took("model.get", id)
          return model
        }),
      set: (id: SessionID, next: ModelRef) =>
        Effect.sync(() => {
          took("model.set", id, next)
          model = next
        }),
    },
    answer: (request: RequestID, answer: FrontendAnswer) =>
      Effect.sync(() => took("answer", request, answer)),
  }

  return { api, calls, open: () => open, said }
})

// What one method was given, in the order it was reached.
export const given = (fake: Fake, method: Method): readonly (readonly unknown[])[] =>
  fake.calls.filter((one) => one.method === method).map((one) => one.args)

// Every word the record kept, in the order a reader sees it.
export const spoken = (transcript: Transcript): string =>
  transcript
    .messages()
    .flatMap((message) => message.blocks)
    .map((block) =>
      block.type === "content" && block.content.type === "text" ? block.content.text : "",
    )
    .join("")
