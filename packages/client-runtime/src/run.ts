import type { ResumeTooFarBehind, SubmitInput, Transcript } from "@missingstudio/eva-core"
import type { Answer, Claim, Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import type { Transport } from "./transport.js"

/**
 * How long the drain may take after the Run it belongs to has closed. It is
 * a stop rather than a wait: everything the stream will say is published by
 * then, so a drain that has not finished by now is a subscription that never
 * started.
 */
export const SETTLE = 2000

export interface RunOptions {
  // How long the drain may run after `submit` returns. A test reaches the
  // stop without waiting for the full bound.
  readonly settle?: number
}

/**
 * Where the runtime is, in the three values a surface acts on. It lives here
 * rather than beside the handle because this is what moves it: the transport
 * says two, and `synchronizing` is this module refolding.
 */
export type ClientState = "ready" | "synchronizing" | "disconnected"

/**
 * What one open Run says to its caller, on one queue. A payload is a word of
 * the live stream; a fold is the record taking that stream's place. Always
 * qualified, because the bare word is claimed elsewhere.
 */
export type RunSignal =
  | { readonly kind: "payload"; readonly payload: Payload }
  /**
   * The record replaced the stream. Repaint from it; everything before it
   * arrived through it, so nothing is shown twice. What follows is committed
   * groups, coarser than the live deltas that preceded the drop — the eye may
   * see chunks where it saw words, and by position nothing is missing.
   */
  | { readonly kind: "folded"; readonly transcript: Transcript }

/**
 * What one Run gives back: the record that replaced its stream, and what it
 * answered.
 *
 * `answer` is the record's own fold, except where the record holds no Claim
 * and the stream said one — a build with no Trace has nothing to fold, and
 * the Run still answered. The fallback is the one-Run case it is written
 * for: a Workflow with no Trace cannot answer at all, whatever is filled in
 * here.
 */
export interface RunOutcome {
  readonly transcript: Transcript
  readonly answer: Answer
}

/**
 * What one Run runs over: the pipe it calls through, where the runtime says
 * it is, and which Session is open. The three travel together, because every
 * step of a reconnect needs all of them.
 */
export interface RunOver {
  readonly transport: Transport
  readonly state: SubscriptionRef.SubscriptionRef<ClientState>
  readonly session: SessionID
}

const folded = (transcript: Transcript): RunSignal => ({ kind: "folded", transcript })

const heard = (payload: Payload): RunSignal => ({ kind: "payload", payload })

/**
 * The live stream, and what takes its place when the pipe goes. The seam ends
 * an open watch only when the pipe goes, so the stream ending is the drop.
 * What follows it is built only when it is reached.
 */
const live = (over: RunOver): Stream.Stream<RunSignal> =>
  Stream.concat(
    Stream.map(over.transport.api.watch(over.session), heard),
    // A live watch reads no close: the seam ends it only when the pipe goes.
    Stream.suspend(() => again(over, false)),
  )

/**
 * The committed groups after the fold, and the next fold behind them. It is
 * not one function with `live` because the two differ in their error channel:
 * only a cursor watch can refuse, and a live one must not make a caller
 * handle a refusal that cannot arrive.
 *
 * The watch ends at the close of the Run it is reading, so what follows it is
 * the fold that replaces that Run's stream. A caller reading one Run stops
 * there; one following a Session folds and watches again.
 */
const resumed = (over: RunOver, from: Cursor): Stream.Stream<RunSignal, ResumeTooFarBehind> =>
  Stream.unwrap(
    Effect.sync(() => {
      /**
       * Whether the Run this watch was reading closed. It is read off what the
       * watch delivered and never off the health of the pipe: a watch ends the
       * moment the socket dies and the health that follows is a separate
       * observation, so a pipe read here answers whichever won the race.
       */
      let closed = false
      const watching = Stream.tap(over.transport.api.watch(over.session, from), (payload) =>
        Effect.sync(() => {
          if (payload.kind === "finished") closed = true
        }),
      )
      return Stream.concat(
        Stream.map(
          Stream.takeUntil(watching, (payload) => payload.kind === "finished"),
          heard,
        ),
        Stream.suspend(() => again(over, closed)),
      )
    }),
  )

/**
 * The live deltas of the Run that is open, to its close, and the fold behind
 * them.
 *
 * It is `resumed`'s shape on the cursor-free watch, and the two differ in what
 * they are for rather than in how they are built. A cursor watch carries
 * committed groups, which a Trace writes one per block: a whole answer commits
 * when its block ends, so a reader on that watch waits through the answer and
 * then receives all of it. The live watch carries what `report` emits, which
 * is every delta as the Provider says it.
 *
 * A follower that has not lost its place reads the words. One that has lost it
 * cannot — its only honest positions are folds — so it converges on the cursor
 * watch instead, which is `RunSignal`'s own account of the pair: committed
 * groups are "coarser than the live deltas that preceded the drop".
 *
 * The gap this leaves is the one the fold closes. The watch subscribes after
 * `attach` answered, so a delta said in between reaches no tail — it is in the
 * next fold, and a tail is what a fold replaces. What a reader loses is the
 * start of one answer, once, and only when a Run was already open as they
 * arrived.
 */
const streaming = (over: RunOver): Stream.Stream<RunSignal> =>
  Stream.unwrap(
    Effect.sync(() => {
      let closed = false
      const watching = Stream.tap(over.transport.api.watch(over.session), (payload) =>
        Effect.sync(() => {
          if (payload.kind === "finished") closed = true
        }),
      )
      return Stream.concat(
        Stream.map(
          Stream.takeUntil(watching, (payload) => payload.kind === "finished"),
          heard,
        ),
        Stream.suspend(() => again(over, closed)),
      )
    }),
  )

/**
 * The fold after a watch ended, and whether it is a recovery.
 *
 * A Run that closed is the ordinary course, so the fold that replaces its
 * stream says nothing about the pipe — a surface told it was synchronizing at
 * the end of every Run would be told about a recovery that never happened. A
 * watch that ended with no close ended because the pipe went, and the fold
 * that follows is the catching up.
 */
const again = (over: RunOver, closed: boolean): Stream.Stream<RunSignal> => refolded(over, !closed)

/**
 * Fold fresh, then watch: live while the follower still has its place, and
 * from the fold's own position once it has lost one.
 *
 * Never a remembered live position. A client that was reading live deltas
 * holds no honest cursor, and its only honest positions are folds — so a
 * recovery resumes from the fold it just took and never from where the deltas
 * had reached.
 *
 * A follower that has not dropped is not recovering, and it reads the live
 * stream: a Trace commits one record per block, so a cursor watch would hand
 * a reader the whole of an answer at the moment its block closed and nothing
 * before that. The next clean close puts a recovered follower back on it.
 *
 * Nothing here waits on the health of the pipe. `attach` is the wait: a call
 * made while the pipe is down is slower and never differently typed, and a
 * transport whose health only comes back when a call succeeds would deadlock
 * against a reader that waited for it first. So a recovery says
 * `synchronizing` once the pipe has answered — which is also when it is true.
 */
const refolded = (over: RunOver, recovering: boolean): Stream.Stream<RunSignal> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const transcript = yield* Effect.scoped(over.transport.api.attach(over.session))
      if (recovering) yield* SubscriptionRef.set(over.state, "synchronizing")
      const queued: Stream.Stream<RunSignal, ResumeTooFarBehind> = Stream.concat(
        Stream.make(folded(transcript)),
        Stream.unwrap(
          Effect.as(
            recovering ? SubscriptionRef.set(over.state, "ready") : Effect.void,
            recovering ? resumed(over, transcript.at) : streaming(over),
          ),
        ),
      )
      /**
       * The head moved past the bound between the fold and the watch. Fold
       * fresh again, and watch from the new position. A refusal is decided on
       * the resumed watch's first pull and nothing can be known before that
       * pull, so the state read `ready` for it and returns to `synchronizing`
       * here. The caller sees one more repaint, never the refusal.
       */
      return Stream.catchTag(queued, "ResumeTooFarBehind", () => refolded(over, true))
    }),
  )

/**
 * Whether a Run is open, from the two payloads that bracket one. The record
 * says nothing about a Run that has not closed, so it is read off the live
 * stream — and it says so for a Run any door opened.
 *
 * A follower that subscribed while a Run was already going learns of it at
 * the next `started`: the payload that opened it was folded before the
 * follower attached, and reading it back out of the fold would be a second
 * fold of the record.
 */
const openOf = (running: boolean, payload: Payload): boolean => {
  if (payload.kind === "started") return true
  if (payload.kind === "finished") return false
  return running
}

/**
 * One Session, followed for as long as the caller wants it: fold, watch to the
 * close of the Run that is open, fold again. It never ends on its own, so a
 * caller stops it by interrupting.
 *
 * This is the same rule `runPrompt` reaches after a drop, and it is here
 * rather than at a surface because it is the runtime's: which positions are
 * honest, what a refused Cursor means, and when the pipe is worth mentioning.
 * A surface that spelled it again would be a second answer to keep in step.
 *
 * `running` rides beside every signal for the same reason: whether a Run is
 * open is read off the payloads that bracket one, and a surface that derived
 * it for itself would be a second reading of the same stream. It holds
 * through a fold, because a fold arrives at the close of a Run and, after a
 * drop, with the Run still going.
 */
export const followSession = Effect.fn("eva.client.follow")(function* (
  over: RunOver,
  each: (signal: RunSignal, running: boolean) => void,
) {
  let running = false
  yield* Stream.runForEach(refolded(over, false), (signal) =>
    Effect.sync(() => {
      if (signal.kind === "payload") running = openOf(running, signal.payload)
      each(signal, running)
    }),
  )
})

/**
 * One open Run, from the input that opens it to the record that replaces its
 * stream. Subscribe, submit, drain in a bound, then fold.
 *
 * Every signal the Run says reaches `each`, the close included — the close
 * carries the Claim. A drop while it is open costs the caller one repaint:
 * the record arrives as a fold, and the stream goes on from the fold's own
 * position. What a surface does with them is the surface's: the protocol
 * carries signals and gives back the record and what it answered.
 */
export const runPrompt = Effect.fn("eva.client.run")(function* (
  over: RunOver,
  input: SubmitInput,
  each: (signal: RunSignal) => void,
  options: RunOptions = {},
): Effect.fn.Return<RunOutcome> {
  const { api } = over.transport
  // What the stream said the Run closed with. It is read only where the
  // record holds no Claim, so nothing that has a Trace ever reaches it.
  let claimed: Claim | undefined
  // The watcher is forked before `submit`, so a Run that says its first word
  // at once is heard.
  const watching = yield* Effect.forkChild(
    Stream.runForEach(
      Stream.takeUntil(
        live(over),
        (one) => one.kind === "payload" && one.payload.kind === "finished",
      ),
      (one) =>
        Effect.sync(() => {
          if (one.kind === "payload" && one.payload.kind === "finished") claimed = one.payload.claim
          each(one)
        }),
    ),
  )
  // Being asked to stop is a cancel, so the Run still closes and the partial
  // work is kept.
  yield* Effect.onInterrupt(api.submit(over.session, input), () => api.cancel(over.session, "user"))
  // `submit` is what says the Run is over: it does not return until the Run
  // has closed. So the stream has already said everything it will say, and
  // the watcher is only draining what is in hand. It is given its turn to
  // finish, and is then stopped rather than waited on.
  yield* Effect.timeoutOption(Fiber.await(watching), options.settle ?? SETTLE)
  yield* Fiber.interrupt(watching)
  // The fold replaces the stream. Its `at` is the position a reconnect
  // resumes from.
  const transcript = yield* Effect.scoped(api.attach(over.session))
  const folded = transcript.answer()
  return {
    transcript,
    answer:
      folded.claim === undefined && claimed !== undefined ? { ...folded, claim: claimed } : folded,
  } satisfies RunOutcome
})
