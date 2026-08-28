import type { SessionAPI, SubmitInput } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream, SubscriptionRef } from "effect"
import {
  followSession,
  runPrompt,
  type ClientState,
  type RunOptions,
  type RunOutcome,
  type RunSignal,
} from "./run.js"
import type { Transport } from "./transport.js"

/**
 * What a surface holds: the whole session contract, the protocol over it, and
 * where the runtime is while it runs.
 */
export interface Client {
  readonly api: SessionAPI
  // Where the runtime is. A surface reads it to say so, and acts on nothing
  // else about the pipe.
  readonly state: SubscriptionRef.SubscriptionRef<ClientState>
  readonly run: (
    session: SessionID,
    input: SubmitInput,
    each: (signal: RunSignal) => void,
    options?: RunOptions,
  ) => Effect.Effect<RunOutcome>
  /**
   * One Session, watched rather than opened: fold, watch to the close of the
   * Run that is open, fold again. It never ends on its own, so a caller stops
   * it by interrupting.
   *
   * A surface that only reads a Session takes this instead of reaching past
   * the handle to `api.attach` and `api.watch`. The refold rule is the
   * runtime's — which positions are honest, what a refused Cursor means, when
   * the pipe is worth mentioning — and a surface that spelled it again would
   * be a second answer to keep in step. `running` rides beside every signal
   * for the same reason: whether a Run is open — whichever door opened it —
   * is the runtime's reading of its own stream, never a surface's.
   */
  readonly follow: (
    session: SessionID,
    each: (signal: RunSignal, running: boolean) => void,
  ) => Effect.Effect<void>
}

/**
 * One handle over one Transport. `api` is the same contract the caller gave,
 * so a consumer that only reads it — a command, say — takes the handle and
 * changes nothing of its own.
 *
 * The health of the pipe becomes the state a surface reads. A drop is
 * `disconnected` whatever else is happening. What follows a restore depends
 * on whether there is a Run to catch up on: an open Run says when it is
 * `ready` again, because only it knows when its fold has replaced its
 * stream; between Runs there is nothing to synchronize, so `ready` follows
 * `disconnected` directly.
 */
export const makeClient = Effect.fn("eva.client")(function* (
  transport: Transport,
): Effect.fn.Return<Client> {
  const state = yield* SubscriptionRef.make<ClientState>("ready")
  let open = 0

  yield* Effect.forkChild(
    Stream.runForEach(SubscriptionRef.changes(transport.health), (health) =>
      Effect.gen(function* () {
        if (health === "disconnected") return yield* SubscriptionRef.set(state, "disconnected")
        // The pipe is back. An open Run says for itself when it has caught
        // up; with none open there is nothing to catch up on.
        if (open === 0) yield* SubscriptionRef.set(state, "ready")
      }),
    ),
  )

  /**
   * One reader of the Session, counted while it reads. A reader says for
   * itself when it has caught up after a restore, so the health watcher above
   * leaves the state alone while any of them is open — and the last one to
   * finish gives the state back to the pipe.
   */
  const counted = <A>(reading: Effect.Effect<A>): Effect.Effect<A> =>
    Effect.ensuring(
      Effect.suspend(() => {
        open += 1
        return reading
      }),
      Effect.suspend(() => {
        open -= 1
        // The last reader is done, so what the pipe says now is the whole
        // story again.
        if (open > 0) return Effect.void
        return Effect.flatMap(SubscriptionRef.get(transport.health), (health) =>
          SubscriptionRef.set(state, health),
        )
      }),
    )

  return {
    api: transport.api,
    state,
    run: (session, input, each, options) =>
      counted(Effect.suspend(() => runPrompt({ transport, state, session }, input, each, options))),
    follow: (session, each) =>
      counted(Effect.suspend(() => followSession({ transport, state, session }, each))),
  }
})
