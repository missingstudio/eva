import {
  foldTranscript,
  type CancelCause,
  type ModelRef,
  type SessionAPI,
  type SubmitInput,
  type Transcript,
} from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber, PubSub, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { runPrompt, SETTLE } from "./run.js"

const SESSION = sessionID("sess_client_runtime")
const PROMPT: SubmitInput = { kind: "prompt", text: "say something" }

// A drain bound short enough that a suite reaches the stop, and far enough
// below SETTLE that reaching it proves the injected bound is the one used.
const BOUND = 5

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const CLOSE: Payload = { kind: "finished", claim: { result: "done", summary: "ok" } }

// What `submit` does after the Run has said its payloads: close it, return
// without a close, or stay open until the caller interrupts.
type Ending = "closes" | "silent" | "hangs"

interface Fake {
  readonly api: SessionAPI
  readonly submitted: readonly SubmitInput[]
  readonly cancelled: readonly CancelCause[]
  // Resolved once the Run has said everything it says.
  readonly said: Deferred.Deferred<void>
}

/**
 * One session, over a hub. Every payload the Run says is published live and
 * committed to the trace, so the fold after the stream is the record of the
 * same Run.
 */
const fakeApi = Effect.fn("test.api")(function* (
  says: readonly Payload[],
  ending: Ending = "closes",
): Effect.fn.Return<Fake> {
  const hub = yield* PubSub.unbounded<Payload>()
  const committed: Event[] = []
  const submitted: SubmitInput[] = []
  const cancelled: CancelCause[] = []
  const said = yield* Deferred.make<void>()
  let model: ModelRef = { provider: "fake", model: "model" }

  const say = (payload: Payload) =>
    Effect.gen(function* () {
      committed.push({
        id: eventID(`ev_${committed.length + 1}`),
        seq: committed.length + 1,
        at: { wall: "2026-08-25T00:00:00.000Z" },
        run: runID("run_1"),
        session: SESSION,
        parent: null,
        payload,
      })
      yield* PubSub.publish(hub, payload)
    })

  const api: SessionAPI = {
    create: () => Effect.succeed(SESSION),
    list: Effect.succeed([{ id: SESSION }]),
    attach: () => Effect.sync(() => foldTranscript(SESSION, committed)),
    watch: () => Stream.fromPubSub(hub),
    /**
     * The first word waits one turn of the event loop, which is what the
     * real Session API does — it forks the turn — so the watcher forked
     * before `submit` is subscribed when the Run starts to speak.
     */
    submit: (_id: SessionID, input: SubmitInput) =>
      Effect.gen(function* () {
        submitted.push(input)
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
        for (const payload of says) yield* say(payload)
        yield* Deferred.succeed(said, undefined)
        if (ending === "hangs") return yield* Effect.never
        if (ending === "closes") yield* say(CLOSE)
      }),
    cancel: (_id: SessionID, cause: CancelCause) => Effect.sync(() => void cancelled.push(cause)),
    model: {
      get: () => Effect.succeed(model),
      set: (_id: SessionID, next: ModelRef) => Effect.sync(() => void (model = next)),
    },
    answer: () => Effect.void,
  }

  return { api, submitted, cancelled, said }
})

// Every word the record kept, in the order a reader sees it.
const spoken = (transcript: Transcript): string =>
  transcript
    .messages()
    .flatMap((message) => message.blocks)
    .map((block) =>
      block.type === "content" && block.content.type === "text" ? block.content.text : "",
    )
    .join("")

describe("one Run, over the Session API", () => {
  it("hands every payload to `each`, once, in order", async () => {
    const seen: Payload[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        yield* runPrompt(fake.api, SESSION, PROMPT, (one) => void seen.push(one), {
          settle: BOUND,
        })
        expect(fake.submitted).toEqual([PROMPT])
      }),
    )

    // The close reaches `each` too: it carries the Claim, which is the one
    // thing a Run says that the stream alone can report.
    expect(seen).toEqual([text("par"), text("tial"), CLOSE])
  })

  it("returns the record's own fold, `at` included", async () => {
    const transcript = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        return yield* runPrompt(fake.api, SESSION, PROMPT, () => {}, { settle: BOUND })
      }),
    )

    expect(transcript.session).toBe(SESSION)
    // Two words and the close: the position a reconnect resumes from.
    expect(transcript.at).toEqual({ session: SESSION, seq: 3 })
    expect(spoken(transcript)).toBe("partial")
  })

  it("returns once `submit` has, even when the watch never says `finished`", async () => {
    const started = Date.now()
    const transcript = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")], "silent")
        return yield* runPrompt(fake.api, SESSION, PROMPT, () => {}, { settle: BOUND })
      }),
    )

    // The drain stopped on the injected bound rather than on the default,
    // and never on the close that was not coming.
    expect(Date.now() - started).toBeLessThan(SETTLE)
    expect(transcript.at).toEqual({ session: SESSION, seq: 2 })
  })

  it("cancels the Run when it is interrupted, and the record still folds", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")], "hangs")
        const running = yield* Effect.forkChild(
          runPrompt(fake.api, SESSION, PROMPT, () => {}, { settle: BOUND }),
        )
        yield* Deferred.await(fake.said)
        yield* Fiber.interrupt(running)
        return {
          cancelled: fake.cancelled,
          record: yield* Effect.scoped(fake.api.attach(SESSION)),
        }
      }),
    )

    expect(found.cancelled).toEqual(["user"])
    expect(spoken(found.record)).toBe("partial")
  })

  it("drains for two seconds unless a caller says otherwise", () => {
    expect(SETTLE).toBe(2000)
  })
})
