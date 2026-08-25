import type { SessionAPI, SubmitInput, Transcript } from "@missingstudio/eva-core"
import type { Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream } from "effect"

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
 * One open Run, from the input that opens it to the record that replaces
 * its stream. Subscribe, submit, drain in a bound, then fold.
 *
 * Every payload the Run says reaches `each`, the close included — the close
 * carries the Claim. What a surface does with them is the surface's: the
 * protocol carries payloads and gives back the record.
 */
export const runPrompt = Effect.fn("eva.client.run")(function* (
  api: SessionAPI,
  session: SessionID,
  input: SubmitInput,
  each: (payload: Payload) => void,
  options: RunOptions = {},
): Effect.fn.Return<Transcript> {
  // The watcher is forked before `submit`, so a Run that says its first word
  // at once is heard.
  const watching = yield* Effect.forkChild(
    Stream.runForEach(
      Stream.takeUntil(api.watch(session), (one) => one.kind === "finished"),
      (one) => Effect.sync(() => each(one)),
    ),
  )
  // Being asked to stop is a cancel, so the Run still closes and the partial
  // work is kept.
  yield* Effect.onInterrupt(api.submit(session, input), () => api.cancel(session, "user"))
  // `submit` is what says the Run is over: it does not return until the Run
  // has closed. So the stream has already said everything it will say, and
  // the watcher is only draining what is in hand. It is given its turn to
  // finish, and is then stopped rather than waited on.
  yield* Effect.timeoutOption(Fiber.await(watching), options.settle ?? SETTLE)
  yield* Fiber.interrupt(watching)
  // The fold replaces the stream. Its `at` is the position a reconnect
  // resumes from.
  return yield* Effect.scoped(api.attach(session))
})
