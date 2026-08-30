import { foldTranscript } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type Cursor,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import {
  attentionFold,
  attentionOf,
  attentionRank,
  byAttention,
  needsAPerson,
  type Attention,
} from "./attention.js"

/**
 * What a Session wants from a person, from its own Trace. Every case here is
 * a record a Session really writes, because the claim being made is that the
 * answer is derived — a state this fold guessed would be a state the record
 * cannot be held to.
 */

const SESSION = sessionID("ses_one")

let counter = 0
const make = (payload: Payload): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: counter,
    at: { wall: "2026-08-29T00:00:00.000Z" },
    run: runID("run_a"),
    session: SESSION,
    parent: null,
    payload,
  }
}

const RESUME: Cursor = { session: SESSION, seq: 1 }

const started: Payload = { kind: "started", intent: "read the trace back" }
const asked: Payload = { kind: "needs_human", question: "which branch?", resume: RESUME }
const done: Payload = { kind: "finished", claim: { result: "done", summary: "answered" } }
const failed: Payload = {
  kind: "finished",
  claim: { result: "failed", summary: "the key was refused", errorClass: "auth_failed" },
}

describe("what a Session wants", () => {
  // The record holds no Run, so there is nothing to read and nothing to do.
  it("has nothing to say about a Session that has not run", () => {
    expect(attentionFold([])).toEqual({ kind: "idle" })
    expect(attentionFold([make({ kind: "info", title: "named" })])).toEqual({ kind: "idle" })
  })

  it("is moving while a Run is open", () => {
    expect(attentionFold([make(started)])).toEqual({ kind: "moving" })
  })

  it("is done once the Run claimed it was", () => {
    expect(attentionFold([make(started), make(done)])).toEqual({ kind: "done" })
  })

  // The reason is the record's own. The words that say what the class means
  // are `errorWords`, so nothing here is a second sentence for one failure.
  it("is blocked by a Claim that failed, and carries what the record holds", () => {
    expect(attentionFold([make(started), make(failed)])).toEqual({
      kind: "blocked",
      summary: "the key was refused",
      errorClass: "auth_failed",
    })
  })

  // Absent is not `other`. A failure nobody classified carries no class.
  it("carries no class when nothing classified the failure", () => {
    expect(
      attentionFold([make(started), make({ kind: "finished", claim: { result: "failed" } })]),
    ).toEqual({ kind: "blocked" })
  })

  it("is waiting on a person while a question stands", () => {
    expect(attentionFold([make(started), make(asked)])).toEqual({
      kind: "asking",
      question: "which branch?",
    })
  })

  // A Run that is asking is not working, whatever else the record says.
  it("waits on a person even while the Run that asked is open", () => {
    const events = [
      make(started),
      make(asked),
      make({ kind: "text", block: 0, content: { type: "text", text: "meanwhile" } }),
    ]
    expect(attentionFold(events).kind).toBe("asking")
  })

  it("stops waiting once the question is answered", () => {
    const question = make(asked)
    const events = [
      make(started),
      question,
      make({ kind: "resolved", question: question.id, resolution: "answered" }),
      make(done),
    ]
    expect(attentionFold(events)).toEqual({ kind: "done" })
  })

  // The oldest question that stands is the one that has waited longest for
  // the person it is asking to come back.
  it("names the question that has stood longest", () => {
    const first = make(asked)
    const second = make({ kind: "needs_human", question: "and which remote?", resume: RESUME })
    expect(attentionFold([make(started), first, second])).toEqual({
      kind: "asking",
      question: "which branch?",
    })
  })

  // A Workflow is many Runs and each one closes, so the answer is the last
  // Run's and never the one before it.
  it("reads the Run that closed last, and not the one before it", () => {
    expect(attentionFold([make(started), make(failed), make(started), make(done)])).toEqual({
      kind: "done",
    })
  })

  // The same fold, from the record a surface is handed. Two ways in, one
  // answer: a surface that folded its own would be a second answer.
  it("gives one answer whichever way a surface comes into it", () => {
    const events = [make(started), make(failed)]
    expect(attentionOf(foldTranscript(SESSION, events))).toEqual(attentionFold(events))
  })
})

describe("the order attention puts Sessions in", () => {
  const rungs: readonly Attention[] = [
    { kind: "asking", question: "which branch?" },
    { kind: "blocked" },
    { kind: "moving" },
    { kind: "done" },
    { kind: "idle" },
  ]

  it("puts what needs a person over what is working, and both over what wants nothing", () => {
    expect(rungs.map(attentionRank)).toEqual([0, 1, 2, 4, 5])
  })

  /**
   * A Session nothing has read sits under everything known to want a person
   * and over everything known to want nothing. An unread Session may want
   * something; a guess never outranks a fact.
   */
  it("puts a Session nothing has read between the two", () => {
    expect(attentionRank(undefined)).toBeGreaterThan(attentionRank({ kind: "moving" }))
    expect(attentionRank(undefined)).toBeLessThan(attentionRank({ kind: "done" }))
  })

  it("says which of them a person has to come to", () => {
    expect(rungs.filter(needsAPerson).map((one) => one.kind)).toEqual(["asking", "blocked"])
    expect(needsAPerson(undefined)).toBe(false)
  })

  // The tie is the caller's rule and never this one's. A listing breaks it by
  // recency; a fleet view may break it by something else.
  it("hands the tie back to the caller", () => {
    const held = ["c", "a", "b"]
    const same = () => ({ kind: "done" }) as Attention
    expect([...held].sort(byAttention(same, (one, other) => one.localeCompare(other)))).toEqual([
      "a",
      "b",
      "c",
    ])
  })

  it("orders by what is wanted before it reaches the tie", () => {
    const wants: Record<string, Attention> = {
      quiet: { kind: "done" },
      busy: { kind: "moving" },
      stuck: { kind: "asking", question: "which branch?" },
    }
    const order = byAttention(
      (one: string) => wants[one],
      (one, other) => one.localeCompare(other),
    )
    expect(["quiet", "busy", "stuck"].sort(order)).toEqual(["stuck", "busy", "quiet"])
  })
})
