/**
 * The package's fake `SessionAPI`, shared by its suites. `index.ts` does not
 * export it, so it ships nothing; it lives beside the code rather than inside
 * one test file because both the protocol and the seam are tested against the
 * same fake, and two copies of one fake are two fakes the moment either
 * changes.
 */

import {
  foldTranscript,
  ResumeTooFarBehind,
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
  type Claim,
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

// What the Run closes with, and the payload that carries it. Named apart so
// a suite can assert the Answer against the same Claim the stream said.
export const CLAIM: Claim = { result: "done", summary: "ok" }
export const CLOSE: Payload = { kind: "finished", claim: CLAIM }

// What `submit` does after the Run has said its payloads: close it, return
// without a close, wait to be let go, or stay open until the caller
// interrupts.
export type Ending = "closes" | "silent" | "hangs" | "waits"

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
  // Commits and publishes one more payload, as the Run does. A test that has
  // to move the Trace while the pipe is down says it through this.
  readonly say: (payload: Payload) => Effect.Effect<void>
  // Lets a Run that `waits` close.
  readonly release: Effect.Effect<void>
  // The next `times` cursor watches refuse instead of replaying, which is
  // what a head that moved past the bound looks like to a caller.
  readonly refuse: (times: number) => void
}

/**
 * One session, over a hub. Every payload the Run says is committed to the
 * trace and published to the hub in one step, so the fold after the stream
 * is the record of the same Run and a cursor names a position in both.
 */
export const fakeApi = Effect.fn("test.api")(function* (
  says: readonly Payload[],
  ending: Ending = "closes",
): Effect.fn.Return<Fake> {
  const hub = yield* PubSub.unbounded<Event>()
  const committed: Event[] = []
  const calls: Call[] = []
  const said = yield* Deferred.make<void>()
  const letGo = yield* Deferred.make<void>()
  let open = 0
  let refusals = 0
  let model: ModelRef = MODEL

  const took = (method: Method, ...args: readonly unknown[]) => void calls.push({ method, args })

  const head = (events: readonly Event[]) =>
    events.reduce((high, event) => (event.seq > high ? event.seq : high), 0)

  const say = (payload: Payload) =>
    Effect.gen(function* () {
      const event: Event = {
        id: eventID(`ev_${committed.length + 1}`),
        seq: committed.length + 1,
        at: { wall: "2026-08-25T00:00:00.000Z" },
        run: runID("run_1"),
        session: SESSION,
        parent: null,
        payload,
      }
      committed.push(event)
      yield* PubSub.publish(hub, event)
    })

  /**
   * What a resumed watch says: the committed groups after the cursor, then
   * the trace as it grows. The subscription is already open, so an event that
   * commits between it and the read is held by the subscription and dropped
   * by the position filter — exactly once, whichever side wins.
   */
  const behind = (tail: Stream.Stream<Event>, from: Cursor) => {
    const read = [...committed]
    const boundary = Math.max(head(read), from.seq)
    return Stream.concat(
      Stream.fromIterable(
        read.filter((event) => event.seq > from.seq).map((event) => event.payload),
      ),
      Stream.map(
        Stream.filter(tail, (event) => event.seq > boundary),
        (event) => event.payload,
      ),
    )
  }

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
    /**
     * A watch is counted once it has really subscribed — not once it was
     * asked for — so a test that has to drop a live one can wait for it
     * rather than guess at it.
     */
    watch: ((id: SessionID, from?: Cursor) => {
      took("watch", ...(from === undefined ? [id] : [id, from]))
      return Stream.unwrap(
        Effect.gen(function* () {
          if (from !== undefined && refusals > 0) {
            refusals -= 1
            return Stream.fail(new ResumeTooFarBehind({ from, head: head(committed) }))
          }
          const tail = Stream.fromSubscription(yield* PubSub.subscribe(hub))
          open += 1
          return Stream.ensuring(
            from === undefined ? Stream.map(tail, (event) => event.payload) : behind(tail, from),
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
        if (ending === "waits") yield* Deferred.await(letGo)
        if (ending !== "silent") yield* say(CLOSE)
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

  return {
    api,
    calls,
    open: () => open,
    said,
    say,
    release: Effect.asVoid(Deferred.succeed(letGo, undefined)),
    refuse: (times: number) => void (refusals += times),
  }
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
