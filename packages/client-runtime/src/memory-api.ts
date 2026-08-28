import {
  foldTranscript,
  headerOf,
  newSessionID,
  ResumeTooFarBehind,
  WATCH_REPLAY_BOUND,
  type CancelCause,
  type FrontendAnswer,
  type ModelRef,
  type RequestID,
  type SessionAPI,
  type SessionHeader,
  type SubmitInput,
} from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  type Cursor,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Fiber, PubSub, Stream } from "effect"

/**
 * One `SessionAPI`, answered from memory. It is a filler of the same seam the
 * kernel's own fills, and it is here rather than in a test file for the reason
 * `droppableTransport` is: the rule it carries is the seam's, not one suite's.
 *
 * That rule is the cursor watch — subscribe, then read the record, then drop
 * the overlap on a strict inequality — and before this it was written out
 * three times, twice inside test files. A copy of a rule is a copy that keeps
 * passing after the rule moves.
 *
 * What it does not decide is what a Run says. That is the caller's, through
 * `answer`, so one filler serves a suite that streams words, one that closes
 * early, and one that never closes at all.
 */

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

// What one `submit` does: say payloads, and return once the Run has closed.
// That is the contract the kernel's filler keeps, so a caller written against
// this one is written against that one.
export type Answering = (
  input: SubmitInput,
  say: (payload: Payload) => Effect.Effect<void>,
  session: SessionID,
) => Effect.Effect<void>

export interface MemorySession {
  readonly api: SessionAPI
  // The session this filler opened for itself, so a suite drives one without
  // calling `create` first.
  readonly session: SessionID
  // Every session `create` minted, newest last.
  readonly opened: () => readonly SessionID[]
  // Every method reached, in the order it was reached, with what it was given.
  readonly calls: readonly Call[]
  // How many watch streams are running. A `watch` in `calls` was asked for;
  // this one has subscribed.
  readonly open: () => number
  /**
   * Commits and publishes one payload, as a Run does. It targets the session
   * `create` opened last, and this filler's own when nothing called `create`.
   * A suite that moves the record while the pipe is down says it through here.
   */
  readonly say: (payload: Payload, session?: SessionID) => Effect.Effect<void>
  /**
   * The next `times` cursor watches refuse instead of replaying. The bound is
   * a thousand commits wide and a suite that must see the refusal should not
   * have to write a thousand events to reach it.
   */
  readonly refuse: (times: number) => void
}

export const MEMORY_MODEL: ModelRef = { provider: "fake", model: "model" }

interface Open {
  readonly hub: PubSub.PubSub<Event>
  readonly committed: Event[]
  model: ModelRef
  // The Run in flight, so a cancel has something to interrupt.
  fiber: Fiber.Fiber<unknown, unknown> | undefined
}

const highest = (events: readonly Event[]): number =>
  events.reduce((high, event) => (event.seq > high ? event.seq : high), 0)

export const memorySessionAPI = (
  answer: Answering,
  options: {
    readonly model?: ModelRef
    // The id of the session this filler opens for itself. A suite that names
    // one reads it back in its own assertions.
    readonly session?: SessionID
  } = {},
): Effect.Effect<MemorySession> =>
  Effect.gen(function* () {
    const sessions = new Map<SessionID, Open>()
    const created: SessionID[] = []
    const calls: Call[] = []
    let live = 0
    let refusals = 0

    const took = (method: Method, ...args: readonly unknown[]) => void calls.push({ method, args })

    const of = (id: SessionID): Effect.Effect<Open> =>
      Effect.suspend(() => {
        const found = sessions.get(id)
        if (found !== undefined) return Effect.succeed(found)
        // Unbounded, so a slow reader cannot stall the Run that feeds it.
        return Effect.map(PubSub.unbounded<Event>(), (hub) => {
          const made: Open = {
            hub,
            committed: [],
            model: options.model ?? MEMORY_MODEL,
            fiber: undefined,
          }
          sessions.set(id, made)
          return made
        })
      })

    // The one filler's own session, so `attach` and `watch` answer before
    // anything has called `create`.
    const own = options.session ?? newSessionID()
    yield* of(own)

    /**
     * Commit, then publish. A payload is numbered one past its session's high
     * water and reaches followers only once it is the record, which is what
     * makes the fold after a stream the record of the same Run and a cursor a
     * position in both.
     */
    const sayTo = (id: SessionID, payload: Payload): Effect.Effect<void> =>
      Effect.gen(function* () {
        const state = yield* of(id)
        const seq = state.committed.length + 1
        const event: Event = {
          id: eventID(`ev_${id}_${seq}`),
          seq,
          at: { wall: "2026-08-25T00:00:00.000Z" },
          run: runID("run_1"),
          session: id,
          parent: null,
          payload,
        }
        state.committed.push(event)
        yield* PubSub.publish(state.hub, event)
      })

    /**
     * What a resumed watch says: the committed groups after the cursor, then
     * the record as it grows. The subscription is already open, so an event
     * that commits between it and the read is held by the subscription and
     * dropped by the position filter — exactly once, whichever side wins.
     */
    const behind = (state: Open, tail: Stream.Stream<Event>, from: Cursor) => {
      const read = [...state.committed]
      const boundary = Math.max(highest(read), from.seq)
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
      create: (location?: string) =>
        Effect.gen(function* () {
          took("create", location)
          const made = newSessionID()
          yield* of(made)
          created.push(made)
          return made
        }),

      list: Effect.sync(() => {
        took("list")
        return [...sessions].map(([id, state]) =>
          headerOf(id, state.committed),
        ) satisfies readonly SessionHeader[]
      }),

      attach: (id: SessionID) =>
        Effect.map(of(id), (state) => {
          took("attach", id)
          return foldTranscript(id, state.committed)
        }),

      /**
       * A watch is counted once it has really subscribed — not once it was
       * asked for — so a suite that must drop a live one waits for it rather
       * than guessing at it.
       *
       * Cast because the two forms differ in their error channel and the
       * implementation is one function, as it is where the kernel builds it.
       */
      watch: ((id: SessionID, from?: Cursor) => {
        took("watch", ...(from === undefined ? [id] : [id, from]))
        return Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* of(id)
            if (from !== undefined) {
              const head = highest(state.committed)
              if (refusals > 0) {
                refusals -= 1
                return Stream.fail(new ResumeTooFarBehind({ from, head }))
              }
              if (head - from.seq > WATCH_REPLAY_BOUND) {
                return Stream.fail(new ResumeTooFarBehind({ from, head }))
              }
            }
            const tail = Stream.fromSubscription(yield* PubSub.subscribe(state.hub))
            live += 1
            return Stream.ensuring(
              from === undefined
                ? Stream.map(tail, (event) => event.payload)
                : behind(state, tail, from),
              Effect.sync(() => void (live -= 1)),
            )
          }),
        )
      }) as SessionAPI["watch"],

      /**
       * The Run opens on a fiber of its own and this waits for it, so `submit`
       * returning is what says the Run has closed — and an interrupt closes
       * the Run rather than the caller. `Fiber.await` rather than `join`: a
       * cancelled Run is a Run that ended, not a failure to report.
       *
       * A Prompt opens with `started`, because that is what a Run is: the
       * fold reads it as the person's line, and every fold that counts Runs
       * counts these. The filler says it rather than the caller, so a suite
       * cannot write a Run that never opened.
       */
      submit: (id: SessionID, input: SubmitInput) =>
        Effect.gen(function* () {
          took("submit", id, input)
          const state = yield* of(id)
          if (input.kind === "prompt") yield* sayTo(id, { kind: "started", intent: input.text })
          const running = yield* Effect.forkChild(
            answer(input, (payload) => sayTo(id, payload), id),
          )
          state.fiber = running
          yield* Fiber.await(running)
          state.fiber = undefined
        }),

      // Interrupting is what closes the Run, as it is where the kernel
      // answers: the partial work is already committed.
      cancel: (id: SessionID, cause: CancelCause) =>
        Effect.gen(function* () {
          took("cancel", id, cause)
          const state = sessions.get(id)
          if (state?.fiber === undefined) return
          const running = state.fiber
          state.fiber = undefined
          yield* Fiber.interrupt(running)
        }),

      model: {
        get: (id: SessionID) =>
          Effect.map(of(id), (state) => {
            took("model.get", id)
            return state.model
          }),
        set: (id: SessionID, next: ModelRef) =>
          Effect.map(of(id), (state) => {
            took("model.set", id, next)
            state.model = next
          }),
      },

      answer: (request: RequestID, given: FrontendAnswer) =>
        Effect.sync(() => took("answer", request, given)),
    }

    return {
      api,
      session: own,
      opened: () => [...created],
      calls,
      open: () => live,
      say: (payload, id) => sayTo(id ?? created.at(-1) ?? own, payload),
      refuse: (times: number) => void (refusals += times),
    }
  })
