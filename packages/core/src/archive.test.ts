import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  encodeLine,
  eventID,
  runID,
  sessionID,
  type Event,
  type SessionID,
} from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { readArchive, traceEvents, traceText } from "./archive.js"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-archive-"))

let counter = 0
const event = (session: SessionID, seq: number): Event => ({
  id: eventID(`evt_a${(counter += 1)}`),
  seq,
  at: { wall: "2026-01-01T00:00:00.000Z" },
  run: runID("run_a"),
  session,
  parent: null,
  payload: { kind: "started", intent: `at ${seq}` },
})

const lines = (events: readonly Event[]): string => events.map(encodeLine).join("\n") + "\n"

describe("a Trace file's text", () => {
  it("reads a path with nothing at it as an empty Trace", () => {
    expect(traceText(join(scratch(), "absent.jsonl"))).toBe("")
  })
})

describe("the records in a Trace's text", () => {
  it("keeps every whole record before a torn trailing line", () => {
    const session = sessionID("sess_torn")
    const source = lines([event(session, 1), event(session, 2)]) + '{"id":"evt_torn","seq":3,'
    expect(traceEvents(source).map((one) => one.seq)).toEqual([1, 2])
  })

  // A line that will not decode anywhere is corruption, not a tear, and the
  // read stops there rather than skipping past it — so a caller never sees
  // a Trace with a hole in the middle of it.
  it("stops at an unreadable line rather than reading past it", () => {
    const session = sessionID("sess_hurt")
    const source = [
      encodeLine(event(session, 1)),
      "{ not a record }",
      encodeLine(event(session, 2)),
    ].join("\n")
    expect(traceEvents(source).map((one) => one.seq)).toEqual([1])
  })

  it("reads no text as no records", () => {
    expect(traceEvents("")).toEqual([])
  })
})

describe("a Trace at a path", () => {
  it("reads one file whole", () => {
    const dir = scratch()
    const session = sessionID("sess_one_file")
    const path = join(dir, "trace.jsonl")
    writeFileSync(path, lines([event(session, 1), event(session, 2)]))
    expect(readArchive(path).map((one) => one.seq)).toEqual([1, 2])
  })

  /**
   * A directory of per-Session files, sorted by file name — a time-ordered
   * SessionID reads back in creation order. Cross-Session interleaving is
   * not recorded there, so none is invented.
   */
  it("reads a directory of per-Session files, in file-name order", () => {
    const dir = join(scratch(), "trace")
    mkdirSync(dir, { recursive: true })
    const first = sessionID("sess_00000001")
    const second = sessionID("sess_00000002")
    writeFileSync(join(dir, `${second}.jsonl`), lines([event(second, 1)]))
    writeFileSync(join(dir, `${first}.jsonl`), lines([event(first, 1), event(first, 2)]))
    // A file that is not a Session's is not read as one.
    writeFileSync(join(dir, "notes.txt"), "not a trace\n")

    expect(readArchive(dir).map((one) => [one.session, one.seq])).toEqual([
      [first, 1],
      [first, 2],
      [second, 1],
    ])
  })

  it("reads a path with nothing at it as a Trace that recorded nothing", () => {
    expect(readArchive(join(scratch(), "never-ran"))).toEqual([])
  })
})
