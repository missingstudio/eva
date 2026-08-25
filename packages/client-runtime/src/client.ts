import type { SessionAPI, SubmitInput, Transcript } from "@missingstudio/eva-core"
import type { Payload, SessionID } from "@missingstudio/eva-schema"
import type { Effect } from "effect"
import { runPrompt, type RunOptions } from "./run.js"

/** What a surface holds: the whole session contract, plus the protocol. */
export interface Client {
  readonly api: SessionAPI
  readonly run: (
    session: SessionID,
    input: SubmitInput,
    each: (payload: Payload) => void,
    options?: RunOptions,
  ) => Effect.Effect<Transcript>
}

/**
 * One handle over one Session API. `api` is the same contract the caller
 * gave, so a consumer that only reads it — a command, say — takes the handle
 * and changes nothing of its own.
 */
export const makeClient = (api: SessionAPI): Client => ({
  api,
  run: (session, input, each, options) => runPrompt(api, session, input, each, options),
})
