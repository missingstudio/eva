import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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
import { fileOf, makeJsonlSink } from "./sink.js"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-sink-"))

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

const open = (dir: string) => Effect.runPromise(makeJsonlSink(dir))

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("the sessions a trace holds", () => {
  it("names every session on disk, one file each", async () => {
    const dir = scratch()
    const first = sessionID("sess_first")
    const second = sessionID("sess_second")

    const writer = await open(dir)
    await Effect.runPromise(writer.append([event(first, started("one"))]))
    await Effect.runPromise(writer.append([event(second, started("two"))]))
    await Effect.runPromise(writer.append([event(first, started("one again"))]))
    await Effect.runPromise(writer.close)

    // A second sink over the same directory stands for a later process.
    const reader = await open(dir)
    const found = await Effect.runPromise(reader.sessions)
    await Effect.runPromise(reader.close)

    expect([...found].sort()).toEqual([first, second].sort())
    expect(readFileSync(fileOf(dir, first), "utf8").trim().split("\n")).toHaveLength(2)
  })

  it("names none when the directory is fresh", async () => {
    const sink = await open(scratch())
    expect(await Effect.runPromise(sink.sessions)).toEqual([])
    await Effect.runPromise(sink.close)
  })

  // A killed process leaves a half-written line. Everything whole before it
  // still counts, and only the torn session pays: the fault a shared file
  // spread across every session now ends at one file's tail.
  it("keeps a torn tail inside the one session that tore", async () => {
    const dir = scratch()
    const torn = sessionID("sess_torn")
    const whole = sessionID("sess_whole")
    const writer = await open(dir)
    await Effect.runPromise(writer.append([event(torn, started("kept"))]))
    await Effect.runPromise(writer.append([event(whole, started("untouched"))]))
    await Effect.runPromise(writer.close)
    appendFileSync(fileOf(dir, torn), '{"id":"evt_torn","session":"sess_torn"')

    const reader = await open(dir)
    const next = await Effect.runPromise(reader.append([event(torn, started("resumed"))]))
    expect(next[0]?.seq).toBe(2)
    expect(await Effect.runPromise(reader.highWater(whole))).toBe(1)
    await Effect.runPromise(reader.close)
  })
})

describe("the jsonl sink", () => {
  it("numbers each session from one, independently", async () => {
    const dir = scratch()
    const first = sessionID("sess_a")
    const second = sessionID("sess_b")
    const sink = await open(dir)

    await Effect.runPromise(sink.append([event(first, started("a1"))]))
    await Effect.runPromise(sink.append([event(second, started("b1"))]))
    const third = await Effect.runPromise(sink.append([event(first, started("a2"))]))
    await Effect.runPromise(sink.close)

    expect(third[0]?.seq).toBe(2)
    const lines = readFileSync(fileOf(dir, first), "utf8").trim().split("\n").map(decodeLine)
    expect(lines.map((one) => [one.session, one.seq])).toEqual([
      [first, 1],
      [first, 2],
    ])
  })

  it("carries on numbering where an earlier process stopped", async () => {
    const dir = scratch()
    const session = sessionID("sess_resumed")
    const first = await open(dir)
    await Effect.runPromise(first.append([event(session, started("one"))]))
    await Effect.runPromise(first.close)

    const second = await open(dir)
    const next = await Effect.runPromise(second.append([event(session, started("two"))]))
    await Effect.runPromise(second.close)

    expect(next[0]?.seq).toBe(2)
  })

  it("replays only the session that was asked for", async () => {
    const dir = scratch()
    const wanted = sessionID("sess_wanted")
    const sink = await open(dir)
    await Effect.runPromise(sink.append([event(wanted, started("wanted"))]))
    await Effect.runPromise(sink.append([event(sessionID("sess_other"), started("other"))]))

    const replayed = await Effect.runPromise(Stream.runCollect(sink.replay(wanted)))
    await Effect.runPromise(sink.close)

    expect([...replayed].map((one) => one.session)).toEqual([wanted])
  })

  // A bad line mid-file stops that session's replay at the break. The other
  // sessions do not share the file, so they lose nothing.
  it("bounds a corrupt line to the session that holds it", async () => {
    const dir = scratch()
    const hurt = sessionID("sess_hurt")
    const fine = sessionID("sess_fine")
    const sink = await open(dir)
    await Effect.runPromise(sink.append([event(hurt, started("kept"))]))
    await Effect.runPromise(sink.append([event(fine, started("kept too"))]))
    await Effect.runPromise(sink.close)

    const path = fileOf(dir, hurt)
    writeFileSync(path, readFileSync(path, "utf8") + "not json at all\n")
    appendFileSync(path, encodeLine({ ...event(hurt, started("after the break")), seq: 2 }) + "\n")

    const reader = await open(dir)
    const replayed = await Effect.runPromise(Stream.runCollect(reader.replay(hurt)))
    expect([...replayed]).toHaveLength(1)
    expect(await Effect.runPromise(reader.highWater(fine))).toBe(1)
    await Effect.runPromise(reader.close)
  })
})

/**
 * What this store derives a Header from, and nothing about the order — the
 * listing states that, and the conformance suite holds it over every sink.
 * The shortcut is the file posture's: the first line's intent, and `mtime`
 * for when the Session last moved.
 */
describe("the jsonl headers", () => {
  it("titles a session by its opening intent, and dates it by the last append", async () => {
    const dir = scratch()
    const older = sessionID("sess_older")
    const newer = sessionID("sess_newer")
    const sink = await open(dir)

    await Effect.runPromise(sink.append([event(older, started("the first ask"))]))
    await settle()
    await Effect.runPromise(sink.append([event(newer, started("the second ask"))]))

    const headers = await Effect.runPromise(sink.headers)
    await Effect.runPromise(sink.close)

    expect(
      [...headers].sort((a, b) => a.id.localeCompare(b.id)).map((one) => [one.id, one.title]),
    ).toEqual([
      [newer, "the second ask"],
      [older, "the first ask"],
    ])
    expect(headers.every((one) => one.updatedAt !== undefined)).toBe(true)
  })

  it("moves a session's date when it commits again", async () => {
    const dir = scratch()
    const first = sessionID("sess_first")
    const second = sessionID("sess_second")
    const sink = await open(dir)

    await Effect.runPromise(sink.append([event(first, started("one"))]))
    await settle()
    await Effect.runPromise(sink.append([event(second, started("two"))]))
    await settle()
    await Effect.runPromise(sink.append([event(first, started("one moves up"))]))

    const headers = await Effect.runPromise(sink.headers)
    await Effect.runPromise(sink.close)

    const dateOf = (id: SessionID) => headers.find((one) => one.id === id)?.updatedAt ?? ""
    expect(dateOf(first) > dateOf(second)).toBe(true)
  })
})
