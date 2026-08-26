import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  encodeLine,
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Exit, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeSqliteSink } from "./sink.js"

const scratch = () => join(mkdtempSync(join(tmpdir(), "eva-sqlite-")), "trace.sqlite")

let counter = 0
const event = (session: SessionID, payload: Payload): Event => ({
  id: eventID(`evt_q${(counter += 1)}`),
  seq: 0,
  at: { wall: `2026-01-01T00:00:${String(counter % 60).padStart(2, "0")}.000Z` },
  run: runID("run_1"),
  session,
  parent: null,
  payload,
})

const started = (intent: string): Payload => ({ kind: "started", intent })

const info = (title: string): Payload => ({ kind: "info", title })

const open = (path: string) => Effect.runPromise(makeSqliteSink(path))

describe("the sqlite sink", () => {
  it("carries on numbering where an earlier process stopped", async () => {
    const path = scratch()
    const session = sessionID("sess_resumed")
    const first = await open(path)
    await Effect.runPromise(first.append([event(session, started("one"))]))
    await Effect.runPromise(first.close)

    const second = await open(path)
    const next = await Effect.runPromise(second.append([event(session, started("two"))]))
    await Effect.runPromise(second.close)

    expect(next[0]?.seq).toBe(2)
  })

  /**
   * The allocation happens inside the write transaction, so two sinks over
   * one file — two processes, as WAL allows — cannot claim one position.
   * The appends are started together and awaited together: sequenced calls
   * would only prove that each one re-reads the head, which is the weaker
   * claim and the one this test used to make.
   */
  it("numbers safely under a second writer on the same file", async () => {
    const path = scratch()
    const session = sessionID("sess_shared")
    const one = await open(path)
    const two = await open(path)

    await Promise.all([
      Effect.runPromise(one.append([event(session, started("a"))])),
      Effect.runPromise(two.append([event(session, started("b"))])),
      Effect.runPromise(one.append([event(session, started("c"))])),
      Effect.runPromise(two.append([event(session, started("d"))])),
    ])

    const replayed = await Effect.runPromise(Stream.runCollect(one.replay(session)))
    await Effect.runPromise(one.close)
    await Effect.runPromise(two.close)

    expect([...replayed].map((row) => row.seq)).toEqual([1, 2, 3, 4])
  })

  it("replays only the session asked for, decoded through the codec", async () => {
    const path = scratch()
    const wanted = sessionID("sess_wanted")
    const sink = await open(path)
    await Effect.runPromise(sink.append([event(wanted, started("mine"))]))
    await Effect.runPromise(sink.append([event(sessionID("sess_other"), started("theirs"))]))

    const replayed = await Effect.runPromise(Stream.runCollect(sink.replay(wanted)))
    await Effect.runPromise(sink.close)

    expect([...replayed].map((one) => [one.session, one.payload.kind])).toEqual([
      [wanted, "started"],
    ])
  })

  it("holds the durability the config asked for", async () => {
    const sink = await Effect.runPromise(makeSqliteSink(scratch(), { synchronous: "full" }))
    const committed = await Effect.runPromise(
      sink.append([event(sessionID("sess_full"), started("safe"))]),
    )
    await Effect.runPromise(sink.close)
    expect(committed[0]?.seq).toBe(1)
  })
})

/**
 * The head row holds the Header the fold would give, kept as events land.
 * The order is the listing's and is held over every sink in conformance;
 * what is this store's own is that the Header is exact — a rename arriving
 * at any position wins, because the row moved with it.
 */
describe("the sqlite headers", () => {
  it("renames a session when a later info says so", async () => {
    const path = scratch()
    const older = sessionID("sess_h_older")
    const newer = sessionID("sess_h_newer")
    const sink = await open(path)

    await Effect.runPromise(sink.append([event(older, started("the first ask"))]))
    await Effect.runPromise(sink.append([event(newer, started("the second ask"))]))
    await Effect.runPromise(sink.append([event(older, info("renamed late"))]))

    const headers = await Effect.runPromise(sink.headers)
    await Effect.runPromise(sink.close)

    expect(
      [...headers].sort((a, b) => a.id.localeCompare(b.id)).map((one) => [one.id, one.title]),
    ).toEqual([
      [newer, "the second ask"],
      [older, "renamed late"],
    ])
  })

  /**
   * A Header cached under an older rule is not read as current. The column
   * is set back by hand to stand for a row this Eva did not write, and the
   * next open folds it again from the events it summarizes.
   */
  it("folds a Header again when the rule that wrote it has moved", async () => {
    const path = scratch()
    const session = sessionID("sess_h_stale")
    const first = await open(path)
    await Effect.runPromise(first.append([event(session, started("as written"))]))
    await Effect.runPromise(first.append([event(session, info("the true title"))]))
    await Effect.runPromise(first.close)

    const db = new DatabaseSync(path)
    db.exec("UPDATE session_head SET title = 'stale', rule = 0")
    db.close()

    const second = await open(path)
    expect(second.rebuilt).toBe(1)
    const headers = await Effect.runPromise(second.headers)
    await Effect.runPromise(second.close)

    expect(headers.map((one) => one.title)).toEqual(["the true title"])
  })
})

describe("a re-committed group", () => {
  it("answers with the positions it already gave, and takes no new ones", async () => {
    const path = scratch()
    const session = sessionID("sess_again")
    const sink = await open(path)

    const group = [event(session, started("once")), event(session, started("twice"))]
    const first = await Effect.runPromise(sink.append(group))
    const again = await Effect.runPromise(sink.append(group))
    const next = await Effect.runPromise(sink.append([event(session, started("after"))]))
    const replayed = await Effect.runPromise(Stream.runCollect(sink.replay(session)))
    await Effect.runPromise(sink.close)

    expect(first.map((one) => one.seq)).toEqual([1, 2])
    expect(again.map((one) => one.seq)).toEqual([1, 2])
    expect(next[0]?.seq).toBe(3)
    expect([...replayed]).toHaveLength(3)
  })

  /**
   * A group where only some records are stored is not a re-commit: nothing
   * committed it whole, so nothing can say what its positions were. The
   * store refuses by name rather than inventing them, and the refusal is
   * what a caller sees instead of a driver's constraint message.
   */
  it("refuses a group only half of which was stored", async () => {
    const path = scratch()
    const session = sessionID("sess_half")
    const sink = await open(path)

    const stored = event(session, started("already in"))
    await Effect.runPromise(sink.append([stored]))

    const exit = await Effect.runPromiseExit(
      sink.append([stored, event(session, started("brand new"))]),
    )
    await Effect.runPromise(sink.close)

    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain("PartialRecommit")
  })
})

describe("the legacy import", () => {
  const legacyLines = (session: SessionID): string =>
    [
      encodeLine({ ...event(session, started("from the one file")), seq: 1 }),
      encodeLine({ ...event(session, info("titled later")), seq: 2 }),
    ].join("\n") + "\n"

  it("loads a one-file trace whole, keeping every trace position", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eva-sqlite-"))
    const legacy = join(dir, "trace.jsonl")
    const session = sessionID("sess_legacy")
    writeFileSync(legacy, legacyLines(session))

    const sink = await Effect.runPromise(
      makeSqliteSink(join(dir, "trace.sqlite"), { importFrom: legacy }),
    )
    expect(sink.imported).toBe(2)

    const next = await Effect.runPromise(sink.append([event(session, started("continues"))]))
    expect(next[0]?.seq).toBe(3)

    const headers = await Effect.runPromise(sink.headers ?? Effect.succeed([]))
    expect(headers.map((one) => one.title)).toEqual(["titled later"])
    await Effect.runPromise(sink.close)
  })

  it("imports once: an occupied store never looks again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eva-sqlite-"))
    const legacy = join(dir, "trace.jsonl")
    const path = join(dir, "trace.sqlite")
    const session = sessionID("sess_once")
    writeFileSync(legacy, legacyLines(session))

    const first = await Effect.runPromise(makeSqliteSink(path, { importFrom: legacy }))
    expect(first.imported).toBe(2)
    await Effect.runPromise(first.close)

    const second = await Effect.runPromise(makeSqliteSink(path, { importFrom: legacy }))
    expect(second.imported).toBe(0)
    const replayed = await Effect.runPromise(Stream.runCollect(second.replay(session)))
    expect([...replayed]).toHaveLength(2)
    await Effect.runPromise(second.close)
  })

  it("imports nothing when there is no file to import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eva-sqlite-"))
    const sink = await Effect.runPromise(
      makeSqliteSink(join(dir, "trace.sqlite"), { importFrom: join(dir, "absent.jsonl") }),
    )
    expect(sink.imported).toBe(0)
    await Effect.runPromise(sink.close)
  })
})
