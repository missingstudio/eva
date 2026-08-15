import { appendFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  decodeLine,
  encodeLine,
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeJsonlSink, recover } from "./sink.js"

const path = () => join(mkdtempSync(join(tmpdir(), "eva-sink-")), "trace.jsonl")

let counter = 0
const event = (session: SessionID, payload: Payload): Event => ({
  id: eventID(`evt_${(counter += 1)}`),
  seq: 0,
  at: { wall: "2026-01-01T00:00:00.000Z" },
  run: runID("run_1"),
  session,
  parent: null,
  payload,
})

const started = (intent: string): Payload => ({
  kind: "started",
  intent,
})

const open = (file: string) => Effect.runPromise(makeJsonlSink(file))

describe("the sessions a trace holds", () => {
  it("names every session on disk, each once", async () => {
    const file = path()
    const first = sessionID("sess_first")
    const second = sessionID("sess_second")

    const writer = await open(file)
    await Effect.runPromise(writer.append([event(first, started("one"))]))
    await Effect.runPromise(writer.append([event(second, started("two"))]))
    await Effect.runPromise(writer.append([event(first, started("one again"))]))
    await Effect.runPromise(writer.close)

    // A second sink over the same file stands for a later process.
    const reader = await open(file)
    const found = await Effect.runPromise(reader.sessions)
    await Effect.runPromise(reader.close)

    expect([...found].sort()).toEqual([first, second].sort())
  })

  it("names none when the file is not there", async () => {
    const sink = await open(path())
    expect(await Effect.runPromise(sink.sessions)).toEqual([])
    await Effect.runPromise(sink.close)
  })

  // A killed process leaves a half-written line. Everything whole before it
  // still counts; nothing after it is guessed at.
  it("stops at a torn trailing line rather than skipping it", async () => {
    const file = path()
    const kept = sessionID("sess_kept")
    const writer = await open(file)
    await Effect.runPromise(writer.append([event(kept, started("kept"))]))
    await Effect.runPromise(writer.close)
    appendFileSync(file, '{"id":"evt_torn","session":"sess_lost"')

    const reader = await open(file)
    expect(await Effect.runPromise(reader.sessions)).toEqual([kept])
    expect(reader.recovery.tornTrailingLine).toBe(true)
    await Effect.runPromise(reader.close)
  })
})

describe("the jsonl sink", () => {
  it("numbers each session from one, independently", async () => {
    const file = path()
    const first = sessionID("sess_a")
    const second = sessionID("sess_b")
    const sink = await open(file)

    await Effect.runPromise(sink.append([event(first, started("a1"))]))
    await Effect.runPromise(sink.append([event(second, started("b1"))]))
    const third = await Effect.runPromise(sink.append([event(first, started("a2"))]))
    await Effect.runPromise(sink.close)

    expect(third[0]?.seq).toBe(2)
    const lines = readFileSync(file, "utf8").trim().split("\n").map(decodeLine)
    expect(lines.map((one) => [one.session, one.seq])).toEqual([
      [first, 1],
      [second, 1],
      [first, 2],
    ])
  })

  it("carries on numbering where an earlier process stopped", async () => {
    const file = path()
    const session = sessionID("sess_resumed")
    const first = await open(file)
    await Effect.runPromise(first.append([event(session, started("one"))]))
    await Effect.runPromise(first.close)

    const second = await open(file)
    const next = await Effect.runPromise(second.append([event(session, started("two"))]))
    await Effect.runPromise(second.close)

    expect(next[0]?.seq).toBe(2)
  })

  it("replays only the session that was asked for", async () => {
    const file = path()
    const wanted = sessionID("sess_wanted")
    const sink = await open(file)
    await Effect.runPromise(sink.append([event(wanted, started("wanted"))]))
    await Effect.runPromise(sink.append([event(sessionID("sess_other"), started("other"))]))

    const replayed = await Effect.runPromise(Stream.runCollect(sink.replay(wanted)))
    await Effect.runPromise(sink.close)

    expect([...replayed].map((one) => one.session)).toEqual([wanted])
  })
})

describe("recover", () => {
  it("reads the high-water mark per session", () => {
    const source = [
      { session: sessionID("sess_a"), seq: 1 },
      { session: sessionID("sess_b"), seq: 1 },
      { session: sessionID("sess_a"), seq: 2 },
    ]
      .map((one) => encodeLine({ ...event(one.session, started("x")), seq: one.seq }))
      .join("\n")

    const found = recover(source)
    expect(found.highWater.get(sessionID("sess_a"))).toBe(2)
    expect(found.highWater.get(sessionID("sess_b"))).toBe(1)
    expect(found.tornTrailingLine).toBe(false)
  })

  it("reads an empty trace as nothing recovered", () => {
    expect(recover("")).toEqual({ highWater: new Map(), tornTrailingLine: false })
  })
})
