import {
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Exit, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { SinkClosedError, sequenced, type TraceStore } from "./sink.js"

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
  inputTokens: 1,
  outputTokens: 1,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
}

interface Fake extends TraceStore {
  readonly written: () => readonly Event[]
  readonly closes: () => number
}

// The least a store can be: it keeps what it is given and counts closes.
const fake = (start: ReadonlyMap<SessionID, number> = new Map(), failWrites = false): Fake => {
  const written: Event[] = []
  let closes = 0
  return {
    highWater: Effect.succeed(start),
    write: (group) =>
      failWrites
        ? Effect.die(new Error("the disk is full"))
        : Effect.sync(() => void written.push(...group)),
    replay: (session) =>
      Stream.suspend(() => Stream.fromIterable(written.filter((one) => one.session === session))),
    sessions: Effect.sync(() => [...new Set(written.map((one) => one.session))]),
    close: Effect.sync(() => void (closes += 1)),
    written: () => written,
    closes: () => closes,
  }
}

describe("sequenced", () => {
  it("numbers each session's trace positions from 1", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(fake())
        const first = yield* sink.append([event(text("a")), event(usage)])
        const other = yield* sink.append([event(text("b"), OTHER)])
        const third = yield* sink.append([event(usage)])
        return [...first, ...other, ...third].map((one) => [one.session, one.seq])
      }),
    )
    expect(found).toEqual([
      [SESSION, 1],
      [SESSION, 2],
      [OTHER, 1],
      [SESSION, 3],
    ])
  })

  it("resumes from the high water the store reports", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(fake(new Map([[SESSION, 7]])))
        return yield* sink.append([event(text("a"))])
      }),
    )
    expect(found[0]?.seq).toBe(8)
  })

  // Two chunks merge only when every fold key and the block index match,
  // and the merged record keeps the first chunk's stamp.
  it("merges consecutive text chunks in one block", async () => {
    const first = event(text("Hel"))
    const committed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(fake())
        return yield* sink.append([first, event(text("lo.")), event(usage)])
      }),
    )
    expect(committed).toHaveLength(2)
    expect(committed[0]?.payload).toEqual(text("Hello."))
    expect(committed[0]?.id).toBe(first.id)
    expect(committed[0]?.at).toEqual(first.at)
    expect(committed.map((one) => one.seq)).toEqual([1, 2])
  })

  it.each([
    ["the block index differs", () => [event(text("a", 0)), event(text("b", 1))]],
    ["the session differs", () => [event(text("a")), event(text("b"), OTHER)]],
    ["another kind sits between", () => [event(text("a")), event(usage), event(text("b"))]],
  ])("does not merge when %s", async (_reason, build) => {
    const committed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(fake())
        return yield* sink.append(build())
      }),
    )
    expect(committed.filter((one) => one.payload.kind === "text")).toHaveLength(2)
  })

  it("commits an empty group without writing or moving a position", async () => {
    const store = fake()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(store)
        yield* sink.append([])
        const after = yield* sink.append([event(text("a"))])
        return after[0]?.seq
      }),
    )
    expect(found).toBe(1)
    expect(store.written()).toHaveLength(1)
  })

  // A position is provisional until the write lands, so a group that never
  // reached the store leaves the next one to take the number it wanted.
  it("does not move the high water when the write fails", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sink = yield* sequenced(fake(new Map(), true))
        return yield* sink.append([event(text("a"))])
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)

    const store = fake()
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(store)
        return yield* sink.append([event(text("b"))])
      }),
    )
    expect(after[0]?.seq).toBe(1)
  })

  it("refuses to append once it is closed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sink = yield* sequenced(fake())
        yield* sink.append([event(text("a"))])
        yield* sink.close
        return yield* sink.append([event(text("b"))])
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain(SinkClosedError.name)
  })

  it("closes the store once, however often it is asked", async () => {
    const store = fake()
    await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* sequenced(store)
        yield* sink.close
        yield* sink.close
      }),
    )
    expect(store.closes()).toBe(1)
  })
})
