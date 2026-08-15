import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeLine, type Event, type SessionID } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { foldTranscript, headerOf } from "./transcript.js"

const fixtures = new URL("../../schema/fixtures", import.meta.url).pathname
const files = readdirSync(fixtures).filter((name) => name.endsWith(".jsonl"))

const load = (file: string): readonly Event[] =>
  readFileSync(join(fixtures, file), "utf8").split("\n").filter(Boolean).map(decodeLine)

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
