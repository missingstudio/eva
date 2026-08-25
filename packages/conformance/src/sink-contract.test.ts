import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SinkClosedError, type TraceSink } from "@missingstudio/eva-core"
import {
  encodeLine,
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { makeJsonlSink } from "@missingstudio/eva-trace-jsonl"
import { makeMemorySink } from "@missingstudio/eva-trace-memory"
import { Effect, Exit, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"

const temp = () => join(mkdtempSync(join(tmpdir(), "eva-sink-")), "trace.jsonl")

// One suite, both sinks. `sequenced` in core owns the trace-position rule
// and its own suite proves it, so what is left here is what a sink still
// decides for itself: that it is wired through the rule at all, and where
// the records it keeps come back from.
const sinks: readonly [string, () => Effect.Effect<TraceSink>][] = [
  ["eva.trace.memory", () => makeMemorySink()],
  ["eva.trace.jsonl", () => makeJsonlSink(temp())],
]

const SESSION = sessionID("sess_a")
const OTHER = sessionID("sess_b")

let counter = 0
const event = (payload: Payload, session: SessionID = SESSION): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: 0,
    at: { wall: "2026-08-15T09:00:00.000Z" },
    run: runID("run_a"),
    session,
    parent: null,
    payload,
  }
}

const text = (value: string, block = 0): Payload => ({
  kind: "text",
  block,
  content: { type: "text", text: value },
})

const usage: Payload = {
  kind: "usage",
  model: "anthropic/claude-sonnet-4-5",
  inputTokens: 1,
  outputTokens: 1,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
}

describe.each(sinks)("the %s sink honors the contract", (_name, make) => {
  it("numbers each session's trace positions from 1", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* make()
        const first = yield* sink.append([event(text("a")), event(usage)])
        const other = yield* sink.append([event(text("b"), OTHER)])
        const third = yield* sink.append([event(usage)])
        return [...first, ...other, ...third].map((committed) => [committed.session, committed.seq])
      }),
    )
    expect(found).toEqual([
      [SESSION, 1],
      [SESSION, 2],
      [OTHER, 1],
      [SESSION, 3],
    ])
  })

  it("replays only the session asked for, in trace order", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* make()
        yield* sink.append([event(text("mine"))])
        yield* sink.append([event(text("theirs"), OTHER)])
        yield* sink.append([event(usage)])
        const replayed = yield* Stream.runCollect(sink.replay(SESSION))
        return [...replayed].map((one) => [one.seq, one.payload.kind])
      }),
    )
    expect(found).toEqual([
      [1, "text"],
      [2, "usage"],
    ])
  })

  it("lists every session it holds", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* make()
        yield* sink.append([event(text("mine"))])
        yield* sink.append([event(text("theirs"), OTHER)])
        return yield* sink.sessions
      }),
    )
    expect([...found].sort()).toEqual([SESSION, OTHER].sort())
  })

  it("says where each session's trace got to", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* make()
        yield* sink.append([event(text("a")), event(usage)])
        yield* sink.append([event(text("b"), OTHER)])
        const water = yield* sink.highWater
        return [water.get(SESSION), water.get(OTHER)]
      }),
    )
    expect(found).toEqual([2, 1])
  })

  /**
   * The subscription is taken when `follow` resolves, not when the stream
   * runs. So the event appended before the follow is not delivered, the
   * other session's event is not delivered, and the one appended after is —
   * even though nothing drained the stream until the end.
   */
  it("follows the record from the moment of subscription, one session only", async () => {
    const found = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sink = yield* make()
          yield* sink.append([event(text("before"))])
          const tail = yield* sink.follow(SESSION)
          const taking = yield* Effect.forkChild(Stream.runCollect(tail.pipe(Stream.take(1))))
          yield* sink.append([event(text("theirs"), OTHER)])
          yield* sink.append([event(text("mine"))])
          const first = [...(yield* Fiber.join(taking))]
          return first.map((one) => [one.session, one.seq, one.payload.kind])
        }),
      ),
    )
    expect(found).toEqual([[SESSION, 2, "text"]])
  })

  it("refuses to append once it is closed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sink = yield* make()
        yield* sink.append([event(text("a"))])
        yield* sink.close
        return yield* sink.append([event(text("b"))])
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain(SinkClosedError.name)
  })
})

// Only the JSONL sink is durable, so recovery is its own concern.
describe("the eva.trace.jsonl sink survives a killed process", () => {
  it("resumes numbering from the high-water mark it finds on disk", async () => {
    const path = temp()
    const first = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* makeJsonlSink(path)
        yield* sink.append([event(text("a")), event(usage)])
        yield* sink.close
        return path
      }),
    )
    const resumed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* makeJsonlSink(first)
        return yield* sink.append([event(text("b"))])
      }),
    )
    expect(resumed[0]?.seq).toBe(3)
  })

  it("keeps every whole record before a torn trailing line", async () => {
    const path = temp()
    await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* makeJsonlSink(path)
        yield* sink.append([event(text("a")), event(usage)])
        yield* sink.close
      }),
    )
    writeFileSync(path, readFileSync(path, "utf8") + '{"id":"evt_torn","seq":3,"wire')

    const sink = await Effect.runPromise(makeJsonlSink(path))
    expect(sink.recovery.tornTrailingLine).toBe(true)
    expect(sink.recovery.highWater.get(SESSION)).toBe(2)

    const next = await Effect.runPromise(sink.append([event(text("b"))]))
    expect(next[0]?.seq).toBe(3)
  })

  it("parses a trace a kill left behind", async () => {
    const path = temp()
    const whole = encodeLine({ ...event(text("a")), seq: 1 })
    writeFileSync(path, `${whole}\n{"id":"evt_torn","seq":2,`)
    const replayed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* makeJsonlSink(path)
        return yield* Stream.runCollect(sink.replay(SESSION))
      }),
    )
    expect([...replayed]).toHaveLength(1)
  })
})
