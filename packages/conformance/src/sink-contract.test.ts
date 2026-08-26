import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs"
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
import { fileOf, makeJsonlSink } from "@missingstudio/eva-trace-jsonl"
import { makeMemorySink } from "@missingstudio/eva-trace-memory"
import { makePostgresSink } from "@missingstudio/eva-trace-postgres"
import { makeSqliteSink } from "@missingstudio/eva-trace-sqlite"
import { Effect, Exit, Fiber, Stream } from "effect"
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-sink-"))

/**
 * The one store that needs a server, when one is pointed at. Postgres is
 * why `TraceStore` allocates at all — it is the only store Eva has with
 * many writers on many machines — so it belongs in the contract suite and
 * not only in its own.
 *
 * A fresh schema per sink, because every other store here is handed an
 * empty scratch directory and the contract is written for a store that
 * starts at nothing. The schemas are dropped when the suite ends.
 */
const postgresURL = process.env["EVA_TEST_POSTGRES_URL"]
const schemas: string[] = []

const freshSchema = (): string => {
  const name = `eva_conf_${schemas.length}_${Math.random().toString(36).slice(2, 8)}`
  schemas.push(name)
  return name
}

afterAll(async () => {
  if (postgresURL === undefined || schemas.length === 0) return
  const sql = postgres(postgresURL, { max: 1, onnotice: () => {} })
  for (const name of schemas) await sql.unsafe(`DROP SCHEMA IF EXISTS ${name} CASCADE`)
  await sql.end({ timeout: 5 })
})

// One row per implementation: a name, and a factory for a fresh sink.
type Row = readonly [string, () => Effect.Effect<TraceSink>]

// The row stores that answer a Header exactly, because the row moves with
// every event they take.
const exact: readonly Row[] = [
  ["eva.trace.memory", () => makeMemorySink()],
  ["eva.trace.sqlite", () => makeSqliteSink(join(scratch(), "trace.sqlite"))],
  ...(postgresURL === undefined
    ? []
    : [
        [
          "eva.trace.postgres",
          () => makePostgresSink(postgresURL, { schema: freshSchema(), pool: 2 }),
        ] satisfies Row,
      ]),
]

// One suite, every sink this build carries. `sequenced` in core owns the
// coalescing rule and its own suite proves it, so what is left here is what
// a sink still decides for itself: that it is wired through the rule at all,
// where the records it keeps come back from, and that its numbering honors
// the contract.
const sinks: readonly Row[] = [...exact, ["eva.trace.jsonl", () => makeJsonlSink(scratch())]]

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

const started = (intent: string): Payload => ({ kind: "started", intent })

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

  it("says where one session's trace got to", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* make()
        yield* sink.append([event(text("a")), event(usage)])
        yield* sink.append([event(text("b"), OTHER)])
        return [yield* sink.highWater(SESSION), yield* sink.highWater(OTHER)]
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

  // Every sink answers `headers`, whether it keeps them beside the log or
  // is folded behind the seam. What it may not do is leave a Session out.
  it("answers a Header for every session it holds", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* make()
        yield* sink.append([event(started("mine"))])
        yield* sink.append([event(started("theirs"), OTHER)])
        const headers = yield* sink.headers
        return headers.map((one) => one.id).sort()
      }),
    )
    expect(found).toEqual([SESSION, OTHER].sort())
  })
})

/**
 * The one place the sinks are allowed to differ, stated rather than left to
 * be discovered. A Header is a fold over the Trace, and a store that keeps
 * one beside the log is caching that fold: the row stores answer exactly,
 * because the row moves with every event. The JSONL store answers from the
 * file's first line, which is the shortcut
 * [trace-storage.md](../../../docs/reference/trace-storage.md) prices and
 * accepts — so a rename that arrives late is missed there, and the README
 * says so.
 *
 * Both are correct. Neither is an accident, and this is the test that keeps
 * it that way.
 */
const renames = (sink: TraceSink) =>
  Effect.gen(function* () {
    yield* sink.append([event(started("as opened"))])
    yield* sink.append([event({ kind: "info", title: "renamed late" })])
    const headers = yield* sink.headers
    return headers.find((one) => one.id === SESSION)?.title
  })

describe("the Header a sink derives", () => {
  it.each(exact)("is exact over %s: a later info renames the Session", async (_name, make) => {
    const found = await Effect.runPromise(Effect.flatMap(make(), renames))
    expect(found).toBe("renamed late")
  })

  it("is the opening intent over eva.trace.jsonl, because it reads the first line", async () => {
    const found = await Effect.runPromise(Effect.flatMap(makeJsonlSink(scratch()), renames))
    expect(found).toBe("as opened")
  })
})

// The durable sinks survive a killed process; the file sink also owns the
// torn-tail rule, because only a file can tear.
describe.each([
  ["eva.trace.jsonl", (dir: string) => makeJsonlSink(dir)],
  ["eva.trace.sqlite", (dir: string) => makeSqliteSink(join(dir, "trace.sqlite"))],
] as const)("the %s sink survives a killed process", (_name, reopen) => {
  it("resumes numbering from the high-water mark it finds on disk", async () => {
    const dir = scratch()
    await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* reopen(dir)
        yield* sink.append([event(text("a")), event(usage)])
        yield* sink.close
      }),
    )
    const resumed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* reopen(dir)
        return yield* sink.append([event(text("b"))])
      }),
    )
    expect(resumed[0]?.seq).toBe(3)
  })
})

describe("the eva.trace.jsonl torn tail", () => {
  it("keeps every whole record before a torn trailing line", async () => {
    const dir = scratch()
    await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* makeJsonlSink(dir)
        yield* sink.append([event(text("a")), event(usage)])
        yield* sink.close
      }),
    )
    appendFileSync(fileOf(dir, SESSION), '{"id":"evt_torn","seq":3,"wire')

    const sink = await Effect.runPromise(makeJsonlSink(dir))
    expect(await Effect.runPromise(sink.highWater(SESSION))).toBe(2)

    const next = await Effect.runPromise(sink.append([event(text("b"))]))
    expect(next[0]?.seq).toBe(3)
    await Effect.runPromise(sink.close)
  })

  it("parses a trace a kill left behind", async () => {
    const dir = scratch()
    const whole = encodeLine({ ...event(text("a")), seq: 1 })
    writeFileSync(fileOf(dir, SESSION), `${whole}\n{"id":"evt_torn","seq":2,`)
    const replayed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* makeJsonlSink(dir)
        return yield* Stream.runCollect(sink.replay(SESSION))
      }),
    )
    expect([...replayed]).toHaveLength(1)
  })
})
