import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { answerFold, type Event, type SessionID } from "@missingstudio/eva-schema"
import { readTrace } from "@missingstudio/eva-schema/goldens"
import { describe, expect, it } from "vitest"
import { foldTranscript, headerOf } from "./transcript.js"

const fixtures = new URL("../../schema/fixtures", import.meta.url).pathname
const files = readdirSync(fixtures).filter((name) => name.endsWith(".jsonl"))

const load = (file: string): readonly Event[] => readTrace(join(fixtures, file))

// The fold runs against core, not a test double, and still reproduces the
// reviewed goldens.
describe.each(files)("the transcript fold over %s", (file) => {
  const events = load(file)
  const golden = JSON.parse(
    readFileSync(join(fixtures, "goldens", file.replace(".jsonl", ".json")), "utf8"),
  )
  const sessions = [...new Set(events.map((event) => event.session))]

  it("reproduces every reviewed message fold", () => {
    for (const session of sessions) {
      const transcript = foldTranscript(session, events)
      expect(JSON.parse(JSON.stringify(transcript.messages()))).toEqual(golden.transcripts[session])
    }
  })

  it("reproduces every reviewed cost fold", () => {
    for (const session of sessions) {
      expect(foldTranscript(session, events).cost()).toEqual(golden.costs[session])
    }
  })
})

describe("a Transcript", () => {
  const events = load(files[0]!)
  const session = events[0]!.session

  it("hands out deep copies, so a consumer cannot edit the record", () => {
    const transcript = foldTranscript(session, events)
    const first = transcript.messages()
    ;(first as { length: number }).length = 0
    expect(transcript.messages().length).toBeGreaterThan(0)
    expect(transcript.messages()).not.toBe(transcript.messages())
  })

  it("folds only the session it was asked for", () => {
    const own = events.filter((event) => event.session === session)
    expect(own.length).toBeLessThan(events.length)
    expect(foldTranscript(session, events).messages()).toEqual(
      foldTranscript(session, own).messages(),
    )
  })

  /**
   * The record, beside the fold of it. A Surface across a socket is sent
   * this and folds it on its own side, so what it draws is a fold it can
   * check rather than one it has to believe.
   */
  it("hands back the Trace it read, and only this session's part of it", () => {
    const own = events.filter((event) => event.session === session)
    const transcript = foldTranscript(session, events)
    expect(transcript.events()).toEqual(own)
    expect(transcript.events()).not.toBe(transcript.events())
  })
})

describe("where a fold ends", () => {
  const events = load(files[0]!)
  const session = events[0]!.session
  const highest = (id: SessionID, all: readonly Event[]): number =>
    all
      .filter((event) => event.session === id)
      .reduce((high, event) => (event.seq > high ? event.seq : high), 0)

  it("reports the position of the last event it folded", () => {
    expect(foldTranscript(session, events).at).toEqual({
      session,
      seq: highest(session, events),
    })
  })

  it("reports seq 0 when it folded nothing, so a watch from there replays all of it", () => {
    expect(foldTranscript(session, []).at).toEqual({ session, seq: 0 })
  })

  it("takes the position after the filter, so another session cannot raise it", () => {
    const other = events.find((event) => event.session !== session)!.session
    expect(highest(other, events)).not.toBe(highest(session, events))
    expect(foldTranscript(other, events).at).toEqual({
      session: other,
      seq: highest(other, events),
    })
  })

  it("folds to the same position whatever order the store hands the events back", () => {
    expect(foldTranscript(session, [...events].reverse()).at).toEqual(
      foldTranscript(session, events).at,
    )
  })
})

describe("what a Run answered", () => {
  const events = load(files[0]!)
  const session = events[0]!.session

  it("is the fold the record already holds, not a second read of the Trace", () => {
    const own = events.filter((event) => event.session === session)
    expect(foldTranscript(session, events).answer()).toEqual(answerFold(own))
  })

  it("carries the Claim the Run that closed last said, and that Run's words", () => {
    const answered = foldTranscript(session, events).answer()
    const closes = events.filter(
      (event) => event.session === session && event.payload.kind === "finished",
    )
    const last = closes.at(-1)
    expect(answered.claim).toEqual((last?.payload as { claim: unknown } | undefined)?.claim)
  })

  it("answers no Claim and no words when it folded nothing", () => {
    expect(foldTranscript(session, []).answer()).toEqual({ text: "" })
  })

  it("hands out a deep copy, as every other read of the record does", () => {
    const transcript = foldTranscript(session, events)
    expect(transcript.answer()).not.toBe(transcript.answer())
    expect(transcript.answer()).toEqual(transcript.answer())
  })

  it("folds only the session it was asked for", () => {
    const other = events.find((event) => event.session !== session)!.session
    const own = events.filter((event) => event.session === other)
    expect(foldTranscript(other, events).answer()).toEqual(answerFold(own))
  })
})

describe("headerOf", () => {
  it("titles a session from its first intent when nothing said otherwise", () => {
    const events = load(files[0]!)
    const session = events[0]!.session as SessionID
    const started = events.find(
      (event) => event.session === session && event.payload.kind === "started",
    )!
    const intent = (started.payload as { intent: string }).intent
    expect(headerOf(session, events).title).toBe(intent)
  })
})
