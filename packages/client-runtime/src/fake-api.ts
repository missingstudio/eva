/**
 * How this package's suites drive the in-memory filler. The filler itself is
 * `memory-api.ts` and it ships, because the rule it carries is the seam's;
 * what is here is only what one Run says and when it closes, which is a
 * suite's business and nobody else's.
 */

import type { ModelRef, SessionAPI, SubmitInput, Transcript } from "@missingstudio/eva-core"
import { sessionID, type Claim, type Payload } from "@missingstudio/eva-schema"
import { Deferred, Effect } from "effect"
import { memorySessionAPI, type Call, type Method } from "./memory-api.js"

export type { Call, Method } from "./memory-api.js"

export const SESSION = sessionID("sess_client_runtime")
export const PROMPT: SubmitInput = { kind: "prompt", text: "say something" }
export const MODEL: ModelRef = { provider: "fake", model: "model" }

export const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

// What the Run closes with, and the payload that carries it. Named apart so
// a suite can assert the Answer against the same Claim the stream said.
export const CLAIM: Claim = { result: "done", summary: "ok" }

export const CLOSE: Payload = { kind: "finished", claim: CLAIM }

// What `submit` does after the Run has said its payloads: close it, return
// without a close, wait to be let go, or stay open until the caller
// interrupts.
export type Ending = "closes" | "silent" | "hangs" | "waits"

export interface Fake {
  readonly api: SessionAPI
  // Every method reached, in the order it was reached, with what it was given.
  readonly calls: readonly Call[]
  // How many watch streams are running. A `watch` in `calls` was asked for;
  // this one has subscribed.
  readonly open: () => number
  // Resolved once the Run has said everything it says.
  readonly said: Deferred.Deferred<void>
  // Commits and publishes one more payload, as the Run does. A test that has
  // to move the Trace while the pipe is down says it through this.
  readonly say: (payload: Payload) => Effect.Effect<void>
  // Lets a Run that `waits` close.
  readonly release: Effect.Effect<void>
  // The next `times` cursor watches refuse instead of replaying, which is
  // what a head that moved past the bound looks like to a caller.
  readonly refuse: (times: number) => void
}

/**
 * One session, over the in-memory filler. Every payload the Run says is
 * committed and published in one step, so the fold after the stream is the
 * record of the same Run and a cursor names a position in both — and that is
 * the filler's doing, not this file's.
 */
export const fakeApi = Effect.fn("test.api")(function* (
  says: readonly Payload[],
  ending: Ending = "closes",
): Effect.fn.Return<Fake> {
  const said = yield* Deferred.make<void>()
  const letGo = yield* Deferred.make<void>()

  const memory = yield* memorySessionAPI(
    /**
     * The first word waits one turn of the event loop, which is what the real
     * Session API does — it forks the turn — so the watcher forked before
     * `submit` is subscribed when the Run starts to speak.
     */
    (_input, say) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
        for (const payload of says) yield* say(payload)
        yield* Deferred.succeed(said, undefined)
        if (ending === "hangs") return yield* Effect.never
        if (ending === "waits") yield* Deferred.await(letGo)
        if (ending !== "silent") yield* say(CLOSE)
      }),
    { model: MODEL, session: SESSION },
  )

  return {
    api: memory.api,
    calls: memory.calls,
    open: memory.open,
    said,
    say: (payload) => memory.say(payload, SESSION),
    release: Effect.asVoid(Deferred.succeed(letGo, undefined)),
    refuse: memory.refuse,
  }
})

// What one method was given, in the order it was reached.
export const given = (fake: Fake, method: Method): readonly (readonly unknown[])[] =>
  fake.calls.filter((one) => one.method === method).map((one) => one.args)

/**
 * Every word the Run said, in the order a reader sees it. The person's own
 * line is in the record too — a Run opens with it, and the filler says so —
 * and it is not what a suite about the stream is asking after.
 */
export const spoken = (transcript: Transcript): string =>
  transcript
    .messages()
    .filter((message) => message.author !== "human")
    .flatMap((message) => message.blocks)
    .map((block) =>
      block.type === "content" && block.content.type === "text" ? block.content.text : "",
    )
    .join("")
