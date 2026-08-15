import {
  foldTranscript,
  newSessionID,
  submit,
  type CancelCause,
  type FrontendAnswer,
  type ModelRef,
  type RequestID,
  type SessionAPI,
  type SessionHeader,
  type SubmitInput,
  type Transcript,
} from "@missingstudio/eva-core"
import type {
  Cursor,
  Event,
  Payload,
  SessionID,
  TranscriptMessage,
} from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber, PubSub, Stream, type Scope } from "effect"
import type { Kernel } from "./boot.js"
import { runDeps } from "./deps.js"

interface Live {
  readonly hub: PubSub.PubSub<Payload>
  model: ModelRef
  // The Run in flight, so a cancel has something to interrupt.
  fiber: Fiber.Fiber<unknown, unknown> | undefined
  // Steering that arrived while no Run was open. It rides the next prompt.
  readonly steered: string[]
}

export interface TurnInput {
  readonly session: SessionID
  readonly model: ModelRef
  readonly prompt: string
  // Prior Runs, folded from the record. The stream is never the history.
  readonly history: readonly TranscriptMessage[]
  readonly emit: (payload: Payload) => Effect.Effect<void>
}

// One Run against the resolved model, with every hook and the Budget wired.
export const runTurn = Effect.fn("session.runTurn")(function* (kernel: Kernel, input: TurnInput) {
  return yield* submit(runDeps(kernel, input.emit), {
    session: input.session,
    spec: { intent: input.prompt },
    model: input.model,
    history: [
      ...input.history,
      {
        author: "human",
        blocks: [{ type: "content", block: 0, content: { type: "text", text: input.prompt } }],
      },
    ],
  })
})

// The record is the source of the history, so a resumed Session sees exactly
// what was committed and nothing the stream merely showed.
export const priorMessages = Effect.fn("session.priorMessages")(function* (
  kernel: Kernel,
  session: SessionID,
) {
  const store = yield* kernel.slot.sessionStore.peek
  if (store === undefined) return [] as readonly TranscriptMessage[]
  return (yield* store.fold(session)).messages()
})

export interface Api {
  readonly session: SessionAPI
  /**
   * Opens a question the surface must answer, and waits. The request is open
   * from the moment this is called rather than from when the fiber runs, so
   * an answer can never arrive before there is something to answer.
   *
   * Nothing at stage 0 asks. A harness needing a permission is the first
   * caller, and this is the seam it uses.
   */
  readonly request: (id: RequestID) => Effect.Effect<FrontendAnswer>
}

/**
 * The whole of what a Surface may do to Eva, over this kernel. A surface
 * reads two sources and never confuses them: `watch` while a Run is open,
 * `attach` for everything committed.
 *
 * This sits beside `boot` rather than in an app because `SessionAPI` is
 * core's contract and every Surface calls it — an app that held the only
 * implementation would make a second app copy it, which is the reason boot
 * is a package at all. What differs per artifact stays in the composition
 * root; answering a Surface does not.
 *
 * The model is handed in rather than read: the Catalog owns the default, and
 * `model` is a key the kernel carries and does not interpret.
 */
export const makeSessionAPI = (
  kernel: Kernel,
  model: ModelRef,
  scope: Scope.Scope,
): Effect.Effect<Api> =>
  Effect.sync(() => {
    const live = new Map<SessionID, Live>()
    const pending = new Map<RequestID, Deferred.Deferred<FrontendAnswer>>()

    const of = Effect.fn("session.of")(function* (session: SessionID) {
      const found = live.get(session)
      if (found !== undefined) return found
      // Unbounded, so a slow surface cannot stall the Run that feeds it.
      const made: Live = {
        hub: yield* PubSub.unbounded<Payload>(),
        model,
        fiber: undefined,
        steered: [],
      }
      live.set(session, made)
      return made
    })

    const events = Effect.fn("session.events")(function* (session: SessionID) {
      const sink = yield* kernel.slot.traceSink.peek
      if (sink === undefined) return [] as readonly Event[]
      return [...(yield* Stream.runCollect(sink.replay(session)))]
    })

    const turn = Effect.fn("session.turn")(function* (session: SessionID, prompt: string) {
      const state = yield* of(session)
      const history = yield* priorMessages(kernel, session)
      return yield* runTurn(kernel, {
        session,
        model: state.model,
        prompt,
        history,
        emit: (payload) => PubSub.publish(state.hub, payload).pipe(Effect.asVoid),
      })
    })

    const session: SessionAPI = {
      // The directory is what a harness will take as its `cwd`. Stage 0 has no
      // harness, so nothing reads it and the Session is opened here.
      create: Effect.fn("session.create")(function* (_location: string) {
        const store = yield* kernel.slot.sessionStore.peek
        const made = store === undefined ? newSessionID() : (yield* store.create).id
        yield* of(made)
        return made
      }),

      list: Effect.fn("session.list")(function* () {
        const store = yield* kernel.slot.sessionStore.peek
        if (store !== undefined) return yield* store.list
        return [...live.keys()].map((id) => ({ id })) satisfies readonly SessionHeader[]
      })(),

      attach: Effect.fn("session.attach")(function* (id: SessionID): Effect.fn.Return<Transcript> {
        const store = yield* kernel.slot.sessionStore.peek
        if (store !== undefined) return yield* store.fold(id)
        const prices = yield* kernel.prices
        return foldTranscript(id, yield* events(id), prices)
      }),

      /**
       * The live stream. With a cursor it first replays what committed after
       * that position, so a surface that reconnects misses nothing; without
       * one it shows only what arrives from here.
       */
      watch: (id: SessionID, from?: Cursor) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* of(id)
            const tail = Stream.fromPubSub(state.hub)
            if (from === undefined) return tail
            const replayed = (yield* events(id))
              .filter((event) => event.seq > from.seq)
              .map((event) => event.payload)
            return Stream.concat(Stream.fromIterable(replayed), tail)
          }),
        ),

      /**
       * A prompt opens a Run on its own fiber, so the caller is free while it
       * streams. Steering that arrives between Runs is kept and prepended to
       * the next prompt; stage 0 has no steps inside a Run, so `next-step`
       * lands on the next Run too.
       */
      submit: Effect.fn("session.submit")(function* (id: SessionID, input: SubmitInput) {
        const state = yield* of(id)
        if (input.kind === "steer") {
          state.steered.push(input.text)
          yield* PubSub.publish(state.hub, {
            kind: "message",
            content: { type: "text", text: input.text },
            target: input.target,
          })
          return
        }

        const prompt = [...state.steered, input.text].join("\n")
        state.steered.length = 0
        const running = yield* Effect.forkIn(turn(id, prompt), scope)
        state.fiber = running
        yield* Fiber.await(running)
        state.fiber = undefined
      }),

      // Interrupting is what closes the Run: the orchestrator commits the
      // partial work and closes it `cancelled`.
      cancel: Effect.fn("session.cancel")(function* (id: SessionID, _cause: CancelCause) {
        const state = live.get(id)
        if (state?.fiber === undefined) return
        yield* Fiber.interrupt(state.fiber)
        state.fiber = undefined
      }),

      model: {
        get: Effect.fn("session.model.get")(function* (id: SessionID) {
          return (yield* of(id)).model
        }),
        set: Effect.fn("session.model.set")(function* (id: SessionID, next: ModelRef) {
          ;(yield* of(id)).model = next
        }),
      },

      // An answer to a request that is not open is dropped. A surface that
      // reconnects and replays a stale answer must not stop Eva.
      answer: Effect.fn("session.answer")(function* (id: RequestID, given: FrontendAnswer) {
        const waiting = pending.get(id)
        if (waiting === undefined) return
        pending.delete(id)
        yield* Deferred.succeed(waiting, given)
      }),
    }

    const request = (id: RequestID): Effect.Effect<FrontendAnswer> => {
      const waiting = Deferred.makeUnsafe<FrontendAnswer>()
      pending.set(id, waiting)
      return Deferred.await(waiting)
    }

    return { session, request }
  })
