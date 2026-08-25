import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { foldTranscript, providerTurn, type ModelRef } from "@missingstudio/eva-core"
import { sessionID, type Event, type Payload } from "@missingstudio/eva-schema"
import { trace } from "@missingstudio/eva-trace"
import { makeJsonlSink, traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { providing, scripted, withKernel } from "@missingstudio/eva-testkit"
import type { Plugin } from "@missingstudio/eva-sdk"
import { makeSessionAPI } from "@missingstudio/eva-boot"
import { localTransport, makeClient, type Client } from "@missingstudio/eva-client-runtime"
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

const started = <A>(
  provider: Plugin,
  body: (client: Client, path: string) => Effect.Effect<A>,
): Promise<A> => {
  const path = join(mkdtempSync(join(tmpdir(), "eva-conv-")), "trace.jsonl")
  return withKernel([trace, { plugin: traceJsonl, options: { path } }, provider], (kernel, scope) =>
    Effect.flatMap(makeSessionAPI(kernel, FAKE_MODEL, scope), (api) =>
      Effect.flatMap(Effect.flatMap(localTransport(api.session), makeClient), (client) =>
        body(client, path),
      ),
    ),
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
    const provider = scripted([
      { payloads: [text("first answer"), usage(10, 4)] },
      { payloads: [text("second answer"), usage(20, 6)] },
    ]).plugin

    const found = await started(provider, (client, path) =>
      Effect.gen(function* () {
        const first = yield* runPrint(client, "first question", { write: () => {} })
        yield* runPrint(client, "second question", {
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
    const chunks: string[] = []
    const provider = scripted([
      { payloads: [text("st"), text("rea"), text("med"), usage(1, 3)] },
    ]).plugin

    await started(provider, (client) =>
      runPrint(client, "stream it", { write: (piece) => void chunks.push(piece) }),
    )

    expect(chunks).toEqual(["st", "rea", "med"])
  })

  it("reports the whole session's spend, and says so when cost is unreported", async () => {
    const provider = scripted([{ payloads: [text("hi"), usage(1200, 340)] }]).plugin

    const printed = await started(provider, (client) =>
      runPrint(client, "spend", { write: () => {} }),
    )

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
    const provider = scripted([{ payloads: [text("hi"), usage(10, 4), silent] }]).plugin

    const printed = await started(provider, (client) =>
      runPrint(client, "silent", { write: () => {} }),
    )
    expect(printed.costLine).toBe("cost unreported")
  })
})

/**
 * The print path and the harness path ask the same question — what did this
 * Run produce — and the record answers both. Where there is no record, the
 * protocol falls back to what the stream said the Run closed with, which is
 * the one thing a build with no Trace can still be sure of.
 */
describe("what a Run answered", () => {
  it("is the record's Claim, not the stream scraped a second time", async () => {
    const provider = scripted([{ payloads: [text("answered it"), usage(1, 1)] }]).plugin

    const printed = await started(provider, (client) =>
      runPrint(client, "ask", { write: () => {} }),
    )

    expect(printed.claim.result).toBe("done")
  })

  it("falls back to what the stream said when the build carries no Trace", async () => {
    const provider = scripted([{ payloads: [text("hello")] }]).plugin

    const printed = await withKernel([provider], (kernel, scope) =>
      Effect.flatMap(makeSessionAPI(kernel, FAKE_MODEL, scope), (api) =>
        Effect.flatMap(Effect.flatMap(localTransport(api.session), makeClient), (client) => {
          let written = ""
          return Effect.map(
            runPrint(client, "hi", { write: (piece) => void (written += piece) }),
            (out) => ({ ...out, written }),
          )
        }),
      ),
    )

    // Nothing was recorded, so nothing folds — and the Run still answered.
    expect(printed.written).toBe("hello")
    expect(printed.claim.result).toBe("done")
    expect(printed.costLine).toBe("cost unreported")
  })
})

describe("cancelling mid-stream", () => {
  it("keeps the partial work and closes the Run cancelled, leaving a foldable trace", async () => {
    const found = await started(
      providing({
        id: "eva.provider.hanging",
        available: () => true,
        turn: () =>
          providerTurn(
            Stream.fromIterable([text("par"), text("tial")]).pipe(
              Stream.concat(Stream.fromEffect(Effect.never)),
            ),
          ),
      }),
      (client, path) =>
        Effect.gen(function* () {
          const streaming = yield* Deferred.make<void>()
          const session = sessionID("sess_cancelled")
          const fiber = yield* Effect.forkChild(
            runPrint(client, "cancel me", {
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
    const provider = scripted([{ payloads: [text("hi"), usage(1, 1)] }]).plugin
    const lines = await started(provider, (client, path) =>
      Effect.gen(function* () {
        yield* runPrint(client, "record me", { write: () => {} })
        return path
      }),
    ).then((path) => path)

    const reader = await Effect.runPromise(makeJsonlSink(lines))
    expect(reader.recovery.tornTrailingLine).toBe(false)
    await Effect.runPromise(reader.close)
  })
})
