import {
  byRecency,
  foldTranscript,
  newSessionID,
  ResumeTooFarBehind,
  submit,
  WATCH_REPLAY_BOUND,
  type Approving,
  type CancelCause,
  type FrontendAnswer,
  type HarnessHost,
  type ModelRef,
  type RequestID,
  type SessionAPI,
  type SessionHeader,
  type SubmitInput,
  type Transcript,
} from "@missingstudio/eva-core"
import type {
  Claim,
  Cursor,
  Event,
  Payload,
  SessionID,
  TranscriptMessage,
} from "@missingstudio/eva-schema"
import { nearest } from "@missingstudio/eva-sdk"
import { Deferred, Effect, Fiber, PubSub, Stream, Scope } from "effect"
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
  // How an `ask` reaches a person. This Run names no tools, so nothing asks;
  // it is carried so one path builds the Run whatever opened it.
  readonly approving?: Approving
}

/**
 * `HarnessHost` over this kernel. `run` binds the kernel's slots and hooks
 * into `submit`, so a Harness needs no kernel of its own. The contract itself
 * is in packages/core/src/harness.ts. The session is what a reported group
 * that opens its own Run is recorded under.
 *
 * Still two members. A Harness that wants tools names them on its `RunInput`
 * and reads what they answered off its `RunResult`, so the tool pipeline
 * reaches a Harness through the Run it already opens — and a native harness
 * still never holds a `HarnessClient`.
 */
export const harnessHost = (
  kernel: Kernel,
  session: SessionID,
  emit: (payload: Payload) => Effect.Effect<void>,
  approving?: Approving,
): HarnessHost => ({
  run: (input) => submit(runDeps(kernel, emit, approving), input),

  /**
   * Emit, then commit. `submit`'s own report buffers first, because an
   * interrupt between the two would show a payload the Trace never received.
   * Here the group arrives complete and nothing is buffered, so there is no
   * such gap and this order is safe.
   */
  report: Effect.fn("session.report")(function* (payloads: readonly Payload[]) {
    for (const payload of payloads) yield* emit(payload)
    const recorder = yield* kernel.slot.recorder.peek
    if (recorder === undefined) return

    /**
     * A group that opens with `started` is a whole Run of its own: the
     * refusal a Harness reports before its first Run. It goes through the
     * Recorder's open and close like every Run, because before the first
     * Run the Recorder has none open and a bare commit has no Run to land
     * in — the record would lose the refusal.
     */
    if (payloads[0]?.kind === "started") {
      yield* recorder.open(session)
      yield* recorder.commit(payloads.filter((payload) => payload.kind !== "finished"))
      const finished = payloads.find(
        (payload): payload is Extract<Payload, { kind: "finished" }> => payload.kind === "finished",
      )
      if (finished !== undefined) yield* recorder.close(finished.claim, finished.stopReason)
      return
    }

    yield* recorder.commit(payloads)
  }),
})

// One Run against the resolved model, with every hook and the Budget wired.
export const runTurn = Effect.fn("session.runTurn")(function* (kernel: Kernel, input: TurnInput) {
  return yield* harnessHost(kernel, input.session, input.emit, input.approving).run({
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

/**
 * A Run that opens and closes with a failed Claim, and takes no Provider Turn.
 * A Prompt that names a Harness which cannot answer is refused before a model
 * is resolved, and the refusal is a Run so a person can read it back.
 *
 * `HarnessHost.report` is not used here. That commits outside a Run and this
 * commits inside one. No Harness reaches this code either: it runs before a
 * Harness exists, so `run` is still the only Run a Harness opens.
 *
 * The Recorder is read once, because a refusal is one short operation with no
 * Provider Turn to be swapped across. `submit` reads the Slot again per phase
 * because a Run is long enough for the plugin behind it to change.
 */
const refuse = Effect.fn("session.refuse")(function* (
  kernel: Kernel,
  session: SessionID,
  intent: string,
  claim: Claim,
  emit: (payload: Payload) => Effect.Effect<void>,
) {
  const recorder = yield* kernel.slot.recorder.peek
  if (recorder !== undefined) yield* recorder.open(session)

  // A Run that could not record says so, which is the rule `submit` follows.
  const opened: readonly Payload[] =
    recorder === undefined
      ? [
          { kind: "started", intent },
          { kind: "degraded", missing: ["Recorder"] },
        ]
      : [{ kind: "started", intent }]

  for (const payload of opened) yield* emit(payload)
  if (recorder !== undefined) yield* recorder.commit(opened)

  yield* emit({ kind: "finished", claim })
  // The Recorder writes the closing record, so nothing else may.
  if (recorder !== undefined) yield* recorder.close(claim)
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
   * A tool call's `ask` is the first caller, through the `Gate` this API is
   * built with. It stays on `Api` because a caller may hold the other half of
   * one request without holding the gate.
   */
  readonly request: (id: RequestID) => Effect.Effect<FrontendAnswer>
}

/**
 * How this build turns a tool call's `ask` into an answer, given the request
 * half `makeSessionAPI` mints. It is a function of that half rather than an
 * `Approving` outright, because the half does not exist until the API does —
 * and because the asker that reaches a person and the rule language that
 * remembers an answer belong to two different plugins, which meet in the
 * composition root.
 */
export type Gate = (request: (id: RequestID) => Effect.Effect<FrontendAnswer>) => Approving

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
  gate?: Gate,
): Effect.Effect<Api> =>
  Effect.sync(() => {
    const live = new Map<SessionID, Live>()
    const pending = new Map<RequestID, Deferred.Deferred<FrontendAnswer>>()

    /**
     * Opens a question the surface must answer, and waits. The request is
     * open from the moment this is called rather than from when the fiber
     * runs, so an answer can never arrive before there is something to
     * answer.
     */
    const request = (id: RequestID): Effect.Effect<FrontendAnswer> => {
      const waiting = Deferred.makeUnsafe<FrontendAnswer>()
      pending.set(id, waiting)
      return Deferred.await(waiting)
    }

    // The gate is built here because the request half is minted here. A build
    // that named none asks nobody, and an `ask` is then a denial.
    const approving = gate?.(request)

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

    const emitTo = (state: Live) => (payload: Payload) =>
      PubSub.publish(state.hub, payload).pipe(Effect.asVoid)

    const turn = Effect.fn("session.turn")(function* (session: SessionID, prompt: string) {
      const state = yield* of(session)
      const history = yield* priorMessages(kernel, session)
      return yield* runTurn(kernel, {
        session,
        model: state.model,
        prompt,
        history,
        emit: emitTo(state),
        ...(approving === undefined ? {} : { approving }),
      })
    })

    /**
     * The Harness the Prompt named, or the refusal that says why none answers.
     * An id that names no row and a row that cannot run are two different
     * mistakes, so each says its own sentence. One sentence for both would
     * tell a person to correct the spelling of an id that is already correct.
     *
     * The Harness is opened in the API's scope, because a Harness outlives the
     * Run it answers: five sessions of one kind are five instances, and the
     * scope is what closes each one.
     */
    const throughHarness = Effect.fn("session.throughHarness")(function* (
      session: SessionID,
      input: Extract<SubmitInput, { kind: "prompt" }>,
      wanted: string,
    ) {
      const state = yield* of(session)
      const emit = emitTo(state)
      const rows = yield* kernel.domains.harness.get
      const row = rows.find((one) => one.id === wanted)

      if (row === undefined) {
        const meant = nearest(
          wanted,
          rows.map((one) => one.id),
        )
        return yield* refuse(
          kernel,
          session,
          input.text,
          {
            result: "failed",
            summary:
              meant === undefined
                ? `no harness answers ${wanted}`
                : `no harness answers ${wanted}, did you mean ${meant}`,
            errorClass: "other",
          },
          emit,
        )
      }

      if (row.open === undefined) {
        return yield* refuse(
          kernel,
          session,
          input.text,
          {
            result: "failed",
            summary: `harness ${wanted} is registered and cannot run`,
            errorClass: "other",
          },
          emit,
        )
      }

      const harness = yield* Effect.provideService(
        row.open(harnessHost(kernel, session, emit, approving)),
        Scope.Scope,
        scope,
      )
      yield* harness.prompt(session, input)
    })

    const session: SessionAPI = {
      // The directory is what a harness will take as its `cwd`. A native
      // harness answers inside this Session rather than opening one of its
      // own, so nothing reads it yet and the Session is opened here.
      create: Effect.fn("session.create")(function* (_location: string) {
        const store = yield* kernel.slot.sessionStore.peek
        const made = store === undefined ? newSessionID() : (yield* store.create).id
        yield* of(made)
        return made
      }),

      // A build with no store lists what this process opened. The order is
      // the same order a store owes, because a listing states one order
      // whatever produced it.
      list: Effect.fn("session.list")(function* () {
        const store = yield* kernel.slot.sessionStore.peek
        if (store !== undefined) return yield* store.list
        return [...live.keys()]
          .map((id) => ({ id }))
          .sort(byRecency) satisfies readonly SessionHeader[]
      })(),

      attach: Effect.fn("session.attach")(function* (id: SessionID): Effect.fn.Return<Transcript> {
        const store = yield* kernel.slot.sessionStore.peek
        if (store !== undefined) return yield* store.fold(id)
        const prices = yield* kernel.prices
        return foldTranscript(id, yield* events(id), prices)
      }),

      /**
       * Without a cursor: the live stream, from here on. With one: the
       * record. A cursor is a trace position, and positions exist only on
       * committed events — the live hub carries payloads the sink has not
       * numbered yet, so it cannot be resumed into. The cursor path
       * subscribes to the committed stream first and reads the record
       * second; an event that commits between the two is held by the
       * subscription, and the position filter drops the copy the read
       * already returned. Exactly once, whichever side wins.
       */
      // Cast because the two forms differ in their error channel and the
      // implementation is one function: the failure lives entirely inside
      // the `from !== undefined` branch, so the uncursored form cannot
      // fail and the contract says so.
      watch: ((id: SessionID, from?: Cursor) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* of(id)
            if (from === undefined) return Stream.fromPubSub(state.hub)

            const sink = yield* kernel.slot.traceSink.peek
            /**
             * A build with no trace has committed nothing, so nothing sits
             * after this position and nothing will. The stream is empty and
             * stays open rather than degrading to the live hub: a caller
             * counting positions from the Cursor would number a live payload
             * that has none, and every position after it would be wrong. What
             * a build with no trace says about itself, it says on the
             * uncursored form and in the `degraded` record a Run commits.
             */
            if (sink === undefined) return Stream.never

            const head = yield* sink.highWater(id)
            if (head - from.seq > WATCH_REPLAY_BOUND) {
              return Stream.fail(new ResumeTooFarBehind({ from, head }))
            }

            const tail = yield* sink.follow(id)
            const committed = [...(yield* Stream.runCollect(sink.replay(id)))]
            const readHead = committed.reduce(
              (high, event) => (event.seq > high ? event.seq : high),
              0,
            )
            const boundary = readHead > from.seq ? readHead : from.seq
            return Stream.concat(
              Stream.fromIterable(
                committed.filter((event) => event.seq > from.seq).map((event) => event.payload),
              ),
              tail.pipe(
                Stream.filter((event) => event.seq > boundary),
                Stream.map((event) => event.payload),
              ),
            )
          }),
        )) as SessionAPI["watch"],

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
        // A Harness gets the Prompt with the steering already in it, so it
        // reads all of what the person asked for.
        const opened =
          input.harness === undefined
            ? turn(id, prompt)
            : throughHarness(id, { ...input, text: prompt }, input.harness)
        const running = yield* Effect.forkIn(opened, scope)
        state.fiber = running
        yield* Fiber.await(running)
        state.fiber = undefined
      }),

      // Interrupting is what closes the Run: `submit` commits the
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

    return { session, request }
  })
