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
import { sinkOf, SinkClosedError, type StampedStore, type TraceStore } from "./sink.js"

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

interface Fake extends StampedStore {
  readonly written: () => readonly Event[]
  readonly closes: () => number
  readonly recoveries: () => readonly SessionID[]
}

// The least a stamped store can be: it keeps what it is given, counts
// closes, and remembers which sessions were asked for their high water.
const fake = (start: ReadonlyMap<SessionID, number> = new Map(), failWrites = false): Fake => {
  const written: Event[] = []
  const recoveries: SessionID[] = []
  let closes = 0
  return {
    highWater: (session) =>
      Effect.sync(() => {
        recoveries.push(session)
        return start.get(session) ?? 0
      }),
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
    recoveries: () => recoveries,
  }
}

// Through the one entry, because that is what a sink author and a test both
// spell: a stamped store is numbered in this process on the way past.
const sink = (store: StampedStore) => sinkOf(store)

describe("numbered over sequenced", () => {
  it("numbers each session's trace positions from 1", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(fake())
        const first = yield* made.append([event(text("a")), event(usage)])
        const other = yield* made.append([event(text("b"), OTHER)])
        const third = yield* made.append([event(usage)])
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
        const made = yield* sink(fake(new Map([[SESSION, 7]])))
        return yield* made.append([event(text("a"))])
      }),
    )
    expect(found[0]?.seq).toBe(8)
  })

  // The store's answer is asked once per session, on first touch, so a
  // store that recovers lazily reads one session's records and not the
  // world's — and never re-reads them.
  it("asks the store for each session's high water once", async () => {
    const store = fake()
    await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(store)
        yield* made.append([event(text("a"))])
        yield* made.append([event(text("b"))])
        yield* made.append([event(text("c"), OTHER)])
        yield* made.highWater(SESSION)
      }),
    )
    expect(store.recoveries()).toEqual([SESSION, OTHER])
  })

  it("says where one session's trace got to", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(fake())
        yield* made.append([event(text("a")), event(usage)])
        yield* made.append([event(text("b"), OTHER)])
        return [yield* made.highWater(SESSION), yield* made.highWater(OTHER)]
      }),
    )
    expect(found).toEqual([2, 1])
  })

  // A position is provisional until the write lands, so a group that never
  // reached the store leaves the next one to take the number it wanted.
  it("does not move the high water when the write fails", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const made = yield* sink(fake(new Map(), true))
        return yield* made.append([event(text("a"))])
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)

    const store = fake()
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(store)
        return yield* made.append([event(text("b"))])
      }),
    )
    expect(after[0]?.seq).toBe(1)
  })
})

describe("sequenced", () => {
  // Two chunks merge only when every fold key and the block index match,
  // and the merged record keeps the first chunk's stamp.
  it("merges consecutive text chunks in one block", async () => {
    const first = event(text("Hel"))
    const committed = await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(fake())
        return yield* made.append([first, event(text("lo.")), event(usage)])
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
        const made = yield* sink(fake())
        return yield* made.append(build())
      }),
    )
    expect(committed.filter((one) => one.payload.kind === "text")).toHaveLength(2)
  })

  it("commits an empty group without writing or moving a position", async () => {
    const store = fake()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(store)
        yield* made.append([])
        const after = yield* made.append([event(text("a"))])
        return after[0]?.seq
      }),
    )
    expect(found).toBe(1)
    expect(store.written()).toHaveLength(1)
  })

  it("refuses to append once it is closed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const made = yield* sink(fake())
        yield* made.append([event(text("a"))])
        yield* made.close
        return yield* made.append([event(text("b"))])
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain(SinkClosedError.name)
  })

  it("closes the store once, however often it is asked", async () => {
    const store = fake()
    await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(store)
        yield* made.close
        yield* made.close
      }),
    )
    expect(store.closes()).toBe(1)
  })
})

/**
 * The one entry answers for either kind of store, which is the whole of what
 * a sink author decides. A store that numbers for itself is passed straight
 * through — nothing in this process may hand it a position — and one that
 * cannot is numbered on the way past.
 */
describe("sinkOf", () => {
  // The store numbers from 100, and the positions come back as it gave
  // them: no in-process allocation happened over the top of it.
  it("lets a store that allocates keep its own numbering", async () => {
    let next = 100
    const store: TraceStore = {
      append: (group) =>
        Effect.sync(() => group.map((one) => ({ ...one, seq: (next += 1) }) as Event)),
      highWater: () => Effect.succeed(next),
      replay: () => Stream.empty,
      sessions: Effect.succeed([]),
      close: Effect.void,
    }
    const found = await Effect.runPromise(
      Effect.flatMap(sinkOf(store), (made) => made.append([event(text("a")), event(usage)])),
    )
    expect(found.map((one) => one.seq)).toEqual([101, 102])
  })

  // A store that keeps no Headers still answers `headers`, folded over its
  // own replay — so no caller ever branches on which sink it got.
  it("folds Headers for a store that keeps none", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* sink(fake())
        yield* made.append([event({ kind: "started", intent: "the ask" })])
        yield* made.append([event(text("b"), OTHER)])
        return yield* made.headers
      }),
    )
    expect(found.map((one) => [one.id, one.title])).toEqual([
      [SESSION, "the ask"],
      [OTHER, undefined],
    ])
  })

  // A store that keeps Headers is asked for them rather than folded.
  it("asks a store that keeps Headers for its own", async () => {
    const store: StampedStore = {
      ...fake(),
      headers: Effect.succeed([{ id: SESSION, title: "from the store" }]),
    }
    const found = await Effect.runPromise(Effect.flatMap(sink(store), (made) => made.headers))
    expect(found).toEqual([{ id: SESSION, title: "from the store" }])
  })
})
