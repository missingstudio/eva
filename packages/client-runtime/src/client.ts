import type { SessionAPI, SubmitInput } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { Effect, Stream, SubscriptionRef } from "effect"
import {
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

  return {
    api: transport.api,
    state,
    run: (session, input, each, options) =>
      Effect.ensuring(
        Effect.suspend(() => {
          open += 1
          return runPrompt({ transport, state, session }, input, each, options)
        }),
        Effect.suspend(() => {
          open -= 1
          // The last Run is over, so what the pipe says now is the whole
          // story again.
          if (open > 0) return Effect.void
          return Effect.flatMap(SubscriptionRef.get(transport.health), (health) =>
            SubscriptionRef.set(state, health),
          )
        }),
      ),
  }
})
