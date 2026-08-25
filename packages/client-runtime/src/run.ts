import type { ResumeTooFarBehind, SubmitInput, Transcript } from "@missingstudio/eva-core"
import type { Answer, Claim, Cursor, Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { healthAt, type Transport } from "./transport.js"

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
 * qualified: the bare word belongs to the stage 13 domain.
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
    Stream.unwrap(dropped(over)),
  )

/**
 * The committed groups after the fold, and the next drop behind them. It is
 * not one function with `live` because the two differ in their error channel:
 * only a cursor watch can refuse, and a live one must not make a caller
 * handle a refusal that cannot arrive.
 */
const resumed = (over: RunOver, from: Cursor): Stream.Stream<RunSignal, ResumeTooFarBehind> =>
  Stream.concat(
    Stream.map(over.transport.api.watch(over.session, from), heard),
    Stream.unwrap(dropped(over)),
  )

const dropped = (over: RunOver): Effect.Effect<Stream.Stream<RunSignal>> =>
  Effect.gen(function* () {
    // There is nothing to catch up on until the pipe is back.
    yield* healthAt(over.transport.health, "ready")
    return refolded(over)
  })

/**
 * Fold fresh, then watch from the fold's own position. Never a remembered
 * live position: a client that was reading live deltas holds no honest
 * cursor, and its only honest positions are folds. See
 * [decisions.md](../../../docs/decisions.md) for why.
 */
const refolded = (over: RunOver): Stream.Stream<RunSignal> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* SubscriptionRef.set(over.state, "synchronizing")
      const transcript = yield* Effect.scoped(over.transport.api.attach(over.session))
      const queued: Stream.Stream<RunSignal, ResumeTooFarBehind> = Stream.concat(
        Stream.make(folded(transcript)),
        Stream.unwrap(
          Effect.as(SubscriptionRef.set(over.state, "ready"), resumed(over, transcript.at)),
        ),
      )
      /**
       * The head moved past the bound between the fold and the watch. Fold
       * fresh again, and watch from the new position. A refusal is decided on
       * the resumed watch's first pull and nothing can be known before that
       * pull, so the state read `ready` for it and returns to `synchronizing`
       * here. The caller sees one more repaint, never the refusal.
       */
      return Stream.catchTag(queued, "ResumeTooFarBehind", () => refolded(over))
    }),
  )

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
