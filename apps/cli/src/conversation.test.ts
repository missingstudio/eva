import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  foldTranscript,
  providerTurn,
  type ModelRef,
  type Provider,
  type ProviderRequest,
  type SessionAPI,
} from "@missingstudio/eva-core"
import { sessionID, type Event, type Payload } from "@missingstudio/eva-schema"
import { trace } from "@missingstudio/eva-trace"
import { makeJsonlSink, traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { FAKE_PROVIDER, providing } from "@missingstudio/eva-testkit"
import { boot, buildOf, makeSessionAPI } from "@missingstudio/eva-boot"
import { runPrint } from "./run.js"

const SESSION = sessionID("sess_conversation")
const FAKE_MODEL: ModelRef = { provider: "fake", model: "model" }

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const usage = (input: number, output: number): Payload => ({
  kind: "usage",
  model: "fake/model",
  inputTokens: input,
  outputTokens: output,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
})

// Answers with whatever the script says, and records what history it was
// handed so the test can check the conversation carried forward.
const scripted = (script: readonly (readonly Payload[])[], seen: ProviderRequest[]): Provider => {
  let turn = 0
  return {
    id: "eva.provider.fake",
    available: () => true,
    turn: (request) => {
      seen.push(request)
      const payloads = script[Math.min(turn, script.length - 1)] ?? []
      turn += 1
      return providerTurn(Stream.fromIterable(payloads))
    },
  }
}

const started = <A>(
  provider: Provider,
  body: (api: SessionAPI, path: string) => Effect.Effect<A>,
): Promise<A> => {
  const path = join(mkdtempSync(join(tmpdir(), "eva-conv-")), "trace.jsonl")
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: [
          { id: "eva.trace" },
          { id: "eva.trace.jsonl", options: { path } },
          { id: FAKE_PROVIDER },
        ],
        build: buildOf([trace, traceJsonl, providing(provider)]),
      })
      const api = yield* makeSessionAPI(kernel, FAKE_MODEL, scope)
      const result = yield* body(api.session, path)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )
}

const onDisk = (path: string, session = SESSION) =>
  Effect.gen(function* () {
    const reader = yield* makeJsonlSink(path)
    const found = yield* Stream.runCollect(reader.replay(session))
    yield* reader.close
    return [...found] as readonly Event[]
  })

// A conversation over several Runs keeps the correct history, streams its
// output, and reports what it spent.
describe("a conversation over several Runs", () => {
  it("keeps every Run in one session's fold, in order", async () => {
    const seen: ProviderRequest[] = []
    const provider = scripted(
      [
        [text("first answer"), usage(10, 4)],
        [text("second answer"), usage(20, 6)],
      ],
      seen,
    )

    const found = await started(provider, (api, path) =>
      Effect.gen(function* () {
        const first = yield* runPrint(api, "first question", { write: () => {} })
        yield* runPrint(api, "second question", {
          session: first.session,
          write: () => {},
        })
        return yield* onDisk(path, first.session)
      }),
    )

    // Both Runs landed in the trace, and the fold gives the conversation back.
    const messages = foldTranscript(found[0]!.session, found).messages()
    expect(messages.map((message) => message.author)).toEqual(["human", "agent", "human", "agent"])
    expect(JSON.stringify(messages)).toContain("first question")
    expect(JSON.stringify(messages)).toContain("second answer")
  })

  it("streams the output as it arrives rather than after the Run", async () => {
    const seen: ProviderRequest[] = []
    const chunks: string[] = []
    const provider = scripted([[text("st"), text("rea"), text("med"), usage(1, 3)]], seen)

    await started(provider, (api) =>
      runPrint(api, "stream it", { write: (piece) => void chunks.push(piece) }),
    )

    expect(chunks).toEqual(["st", "rea", "med"])
  })

  it("reports the whole session's spend, and says so when cost is unreported", async () => {
    const seen: ProviderRequest[] = []
    const provider = scripted([[text("hi"), usage(1200, 340)]], seen)

    const printed = await started(provider, (api) => runPrint(api, "spend", { write: () => {} }))

    expect(printed.costLine).toBe("1.2k in / 340 out · cost unreported")
  })

  it("suppresses the total when one Run reported no counts", async () => {
    const silent: Payload = {
      kind: "usage",
      model: "fake/model",
      inputTokens: null,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
    }
    const seen: ProviderRequest[] = []
    const provider = scripted([[text("hi"), usage(10, 4), silent]], seen)

    const printed = await started(provider, (api) => runPrint(api, "silent", { write: () => {} }))
    expect(printed.costLine).toBe("cost unreported")
  })
})

describe("cancelling mid-stream", () => {
  it("keeps the partial work and closes the Run cancelled, leaving a foldable trace", async () => {
    const seen: ProviderRequest[] = []
    const found = await started(
      {
        id: "eva.provider.hanging",
        available: () => true,
        turn: () =>
          providerTurn(
            Stream.fromIterable([text("par"), text("tial")]).pipe(
              Stream.concat(Stream.fromEffect(Effect.never)),
            ),
          ),
      },
      (api, path) =>
        Effect.gen(function* () {
          const streaming = yield* Deferred.make<void>()
          const session = sessionID("sess_cancelled")
          const fiber = yield* Effect.forkChild(
            runPrint(api, "cancel me", {
              session,
              write: () => {
                Effect.runFork(Deferred.succeed(streaming, undefined))
              },
            }),
          )
          yield* Deferred.await(streaming)
          yield* Fiber.interrupt(fiber)
          return yield* onDisk(path, session)
        }),
    )

    void seen
    const closing = found.at(-1)
    expect(closing?.payload).toMatchObject({ kind: "finished", stopReason: "cancelled" })
    // The partial answer survived, and every record still parses — a
    // replay that reached one bad line would have stopped at it.
    expect(JSON.stringify(found)).toContain("par")
    expect(found.every((event) => event.seq > 0)).toBe(true)
  })
})

describe("the trace a killed process leaves", () => {
  it("still parses, record by record", async () => {
    const seen: ProviderRequest[] = []
    const provider = scripted([[text("hi"), usage(1, 1)]], seen)
    const lines = await started(provider, (api, path) =>
      Effect.gen(function* () {
        yield* runPrint(api, "record me", { write: () => {} })
        return path
      }),
    ).then((path) => path)

    const reader = await Effect.runPromise(makeJsonlSink(lines))
    expect(reader.recovery.tornTrailingLine).toBe(false)
    await Effect.runPromise(reader.close)
  })
})
