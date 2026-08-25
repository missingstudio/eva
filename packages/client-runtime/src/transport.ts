import type { ResumeTooFarBehind, SessionAPI } from "@missingstudio/eva-core"
import type { Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream, SubscriptionRef } from "effect"

/**
 * What the filler knows: the pipe is there, or it is not. "synchronizing" is
 * not here — catching up is the runtime's own phase, not a fact about the
 * pipe.
 *
 * A wire filler keeps its own phases behind these two. The three values a
 * consumer acts on are the runtime's, and they are built above this.
 */
export type TransportHealth = "ready" | "disconnected"

/**
 * Where the `SessionAPI` lives, and the one fact the runtime reads about it.
 * The runtime calls the contract and never learns whether the answer came
 * from this process, from a socket, or from a wire that flaps.
 */
export interface Transport {
  // The whole session contract, answered on the far side of this filler.
  readonly api: SessionAPI
  readonly health: SubscriptionRef.SubscriptionRef<TransportHealth>
}

/**
 * The first moment `health` reads `want`. `changes` replays the value the ref
 * holds now, so a wait for the state the transport is already in ends at
 * once, and a change that lands before the waiter subscribes is still heard.
 */
export const healthAt = (
  health: SubscriptionRef.SubscriptionRef<TransportHealth>,
  want: TransportHealth,
): Effect.Effect<void> =>
  Effect.asVoid(
    Stream.runHead(Stream.filter(SubscriptionRef.changes(health), (one) => one === want)),
  )

/**
 * The in-process API, untouched, behind a `health` that is born `ready` and
 * never leaves it. There is no wire, so there is nothing to lose.
 */
export const localTransport = (api: SessionAPI): Effect.Effect<Transport> =>
  Effect.map(SubscriptionRef.make<TransportHealth>("ready"), (health) => ({ api, health }))

export interface DroppableTransport extends Transport {
  // End every open watch and hold every new call until restore.
  readonly drop: Effect.Effect<void>
  readonly restore: Effect.Effect<void>
}

/**
 * The seam's own proof: a filler that can be told to lose its pipe. It ships
 * in the package rather than in a test file because W0's exit test runs on
 * it, and because the second filler will want it again.
 *
 * A drop says what it has to say where it can be acted on: `health` changes,
 * and every open `watch` ends. It says nothing through an error channel —
 * `SessionAPI` has none, and the seam keeps it that way. A call made while
 * the pipe is down is slower, never differently typed.
 */
export const droppableTransport = (api: SessionAPI): Effect.Effect<DroppableTransport> =>
  Effect.gen(function* () {
    const health = yield* SubscriptionRef.make<TransportHealth>("ready")

    // The call is built after the wait, so a held call has reached nothing
    // behind the seam yet.
    const held = <A, E, R>(call: () => Effect.Effect<A, E, R>) =>
      Effect.flatMap(healthAt(health, "ready"), call)

    const wrapped: SessionAPI = {
      create: (location) => held(() => api.create(location)),
      list: held(() => api.list),
      attach: (session) => held(() => api.attach(session)),
      /**
       * Asking for a stream is not making a call: the description is built
       * here, and nothing behind the seam runs until the stream does. So the
       * wait is on the running, and the drop ends what is running.
       *
       * Cast because the two forms differ in their error channel and the
       * implementation is one function, as it is where the API is built.
       */
      watch: ((session: SessionID, from?: Cursor) => {
        const open: Stream.Stream<Payload, ResumeTooFarBehind> =
          from === undefined ? api.watch(session) : api.watch(session, from)
        return Stream.unwrap(
          Effect.map(healthAt(health, "ready"), () =>
            Stream.interruptWhen(open, healthAt(health, "disconnected")),
          ),
        )
      }) as SessionAPI["watch"],
      submit: (session, input) => held(() => api.submit(session, input)),
      cancel: (session, cause) => held(() => api.cancel(session, cause)),
      model: {
        get: (session) => held(() => api.model.get(session)),
        set: (session, model) => held(() => api.model.set(session, model)),
      },
      answer: (request, answer) => held(() => api.answer(request, answer)),
    }

    return {
      api: wrapped,
      health,
      drop: SubscriptionRef.set(health, "disconnected"),
      restore: SubscriptionRef.set(health, "ready"),
    }
  })
