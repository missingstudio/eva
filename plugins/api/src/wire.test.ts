import {
  ResumeTooFarBehind,
  type FrontendAnswer,
  type SessionHeader,
  type SubmitInput,
} from "@missingstudio/eva-core"
import { sessionID, type Cursor } from "@missingstudio/eva-schema"
import type { FrontendRequest, Ran } from "@missingstudio/eva-sdk"
import { describe, expect, it } from "vitest"
import { askingIn, CALLS, nothing, refusalIn, refusalOut, type PickRow } from "./wire.js"

/**
 * Each call's shapes, held to themselves: what the writer spells is what the
 * reader reads back, through the JSON the wire really carries. The suites in
 * `routes.test.ts` and `client/transport.test.ts` prove the pair over a real
 * socket; this one proves the agreement, one call at a time, so a shape that
 * moves fails here first and by name.
 *
 * Every pair is reached through its own row, because the row is the
 * agreement: a writer proved against a reader it does not travel with is a
 * pair that passes and a wire that does not.
 */
const travelled = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown

const SESSION = sessionID("sess_wire")

describe("a listing of Sessions", () => {
  it("reads back what it wrote, field for field", () => {
    const rows: readonly SessionHeader[] = [
      { id: SESSION, title: "a title", updatedAt: "2026-08-29T00:00:00Z", retired: false },
      { id: sessionID("sess_bare") },
    ]

    expect(CALLS.list.answer.reads(travelled(CALLS.list.answer.writes(rows)))).toEqual(rows)
  })

  // One row this cannot read makes the whole listing unreadable. A Session
  // dropped in silence is worse than a call that waits and asks again.
  it("refuses the whole listing over one row it cannot read", () => {
    expect(CALLS.list.answer.reads([{ id: SESSION }, { title: "no id" }])).toBeUndefined()
  })
})

describe("a model reference", () => {
  it("reads back what it wrote", () => {
    const model = { provider: "anthropic", model: "claude" }
    expect(CALLS.readModel.answer.reads(travelled(CALLS.readModel.answer.writes(model)))).toEqual(
      model,
    )
  })

  it("refuses half a reference", () => {
    expect(CALLS.readModel.answer.reads({ provider: "anthropic" })).toBeUndefined()
  })
})

describe("the rows a picker draws", () => {
  it("reads back what it wrote, the rate and the colors included", () => {
    const rows: readonly PickRow[] = [
      {
        id: "anthropic/claude",
        label: "claude",
        detail: "the default",
        price: { inputTicks: 30, outputTicks: 150, cacheReadTicks: 3 },
      },
      { id: "dusk", label: "dusk", colors: { background: "#101010", foreground: "#e0e0e0" } },
      { id: "bare", label: "bare" },
    ]

    expect(CALLS.models.answer.reads(travelled(CALLS.models.answer.writes(rows)))).toEqual(rows)
  })

  // Half a rate produces an estimate that is wrong rather than absent, and a
  // screen painted from half a theme is wrong rather than plain. Both are
  // dropped whole; the row itself still stands.
  it("drops a rate or a colors it can only half-read, and keeps the row", () => {
    expect(CALLS.models.answer.reads([{ id: "a", label: "a", price: { inputTicks: 1 } }])).toEqual([
      { id: "a", label: "a" },
    ])
    expect(CALLS.models.answer.reads([{ id: "a", label: "a", colors: { background: 3 } }])).toEqual(
      [{ id: "a", label: "a" }],
    )
  })

  it("refuses the whole listing over one row it cannot read", () => {
    expect(CALLS.models.answer.reads([{ id: "a", label: "a" }, { id: "no label" }])).toBeUndefined()
  })
})

describe("the Session a create opened", () => {
  it("travels as the string it is", () => {
    expect(CALLS.create.answer.reads(travelled(CALLS.create.answer.writes(SESSION)))).toBe(SESSION)
  })
})

describe("where a new Session goes", () => {
  it("reads back the location it wrote", () => {
    expect(
      CALLS.create.body.reads(travelled(CALLS.create.body.writes({ location: "~/work" }))),
    ).toEqual({ location: "~/work" })
  })

  // A caller that names nowhere sends nothing, and nothing reads as the
  // serving process's own directory — the same answer an absent body gives.
  it("writes nothing for a caller that named nowhere", () => {
    expect(CALLS.create.body.reads(travelled(CALLS.create.body.writes({})))).toEqual({})
  })

  it("refuses a location that is there and is not a string", () => {
    expect(CALLS.create.body.reads({ location: 3 })).toBeUndefined()
  })
})

describe("a line and what running it came to", () => {
  it("carries the line whole", () => {
    expect(CALLS.command.body.reads(travelled(CALLS.command.body.writes("/mode read-only")))).toBe(
      "/mode read-only",
    )
  })

  it("reads back what a command came to, with and without a Session", () => {
    const moved: Ran = { wrote: "cleared", selected: SESSION }
    const wrote: Ran = { wrote: "mode: read-only" }

    expect(CALLS.command.answer.reads(travelled(CALLS.command.answer.writes(moved)))).toEqual(moved)
    expect(CALLS.command.answer.reads(travelled(CALLS.command.answer.writes(wrote)))).toEqual(wrote)
  })
})

describe("what a submit carries", () => {
  it.each<SubmitInput>([
    { kind: "prompt", text: "say something" },
    { kind: "prompt", text: "say something", harness: "eva.harness.loop" },
    { kind: "steer", text: "go left", target: "next-step" },
    { kind: "steer", text: "later", target: "next-run" },
  ])("reads back a $kind as it was written", (input) => {
    expect(CALLS.submit.body.reads(travelled(CALLS.submit.body.writes(input)))).toEqual(input)
  })

  it("refuses a steer whose target names no boundary", () => {
    expect(CALLS.submit.body.reads({ kind: "steer", text: "go", target: "now" })).toBeUndefined()
  })
})

describe("a cancel's cause", () => {
  it.each(["user", "budget", "shutdown"] as const)("carries %s as the word it is", (cause) => {
    expect(CALLS.cancel.body.reads(travelled(CALLS.cancel.body.writes(cause)))).toBe(cause)
  })

  it("refuses a word that is not a cause", () => {
    expect(CALLS.cancel.body.reads("later")).toBeUndefined()
  })
})

describe("a person's answer", () => {
  it.each<FrontendAnswer>([
    { kind: "permission", optionId: "allow_once" },
    { kind: "text", text: "the second one" },
    { kind: "cancelled" },
  ])("reads back a $kind as it was written", (answer) => {
    expect(CALLS.answer.body.reads(travelled(CALLS.answer.body.writes(answer)))).toEqual(answer)
  })

  it("refuses a kind it does not know", () => {
    expect(CALLS.answer.body.reads({ kind: "shrug" })).toBeUndefined()
  })
})

describe("the refusal a cursor watch answers with", () => {
  it("comes back as the tagged error it was, about the Cursor this side asked with", () => {
    const from: Cursor = { session: SESSION, seq: 3 }
    const refused = refusalIn(
      from,
      travelled(refusalOut(new ResumeTooFarBehind({ from, head: 1200 }))),
    )

    expect(refused?._tag).toBe("ResumeTooFarBehind")
    expect(refused?.head).toBe(1200)
    expect(refused?.from).toEqual(from)
  })
})

describe("the questions that stand", () => {
  // The whole set every time, so a reader holds no bookkeeping and a reader
  // that joined late reads the same frame as one that was there. The kind
  // travels with each question: a wire that dropped it would make every
  // relayed question a permission request, whatever it was.
  it("reads back every question a frame carries", () => {
    const asking: readonly FrontendRequest[] = [
      { kind: "permission", id: "call_1", question: "run git push?" },
      { kind: "question", id: "call_2", question: "which of the two?" },
    ]

    expect(askingIn(JSON.stringify({ asking }))).toEqual(asking)
  })

  // A frame nothing can read is not an empty set. The caller keeps what it
  // had, so a reader looking at a question does not watch it vanish because
  // a byte was wrong.
  it.each([
    '{"asking":1}',
    '{"asking":[{"id":1}]}',
    // A row with no kind is a question this side cannot ask as it was asked.
    '{"asking":[{"id":"call_1","question":"run git push?"}]}',
    "not json",
    "[]",
  ])("reads no set out of %s", (text) => {
    expect(askingIn(text)).toBeUndefined()
  })
})

/**
 * Every call, held to its own row.
 *
 * A row states the path it is asked on and the shape it is matched by, and
 * the two used to be written in two files with nothing between them. Walking
 * the table is what a row buys: a call added here is proved here, and a path
 * that stops matching its own shape is a failure by name rather than a route
 * that quietly answers nothing.
 */
describe("every call this wire carries", () => {
  const rows = Object.entries(CALLS)

  it.each(rows)("%s is asked on a path its own shape matches", (_name, row) => {
    expect(row.shape.test(row.at("sess_one"))).toBe(true)
  })

  /**
   * A name is a name, and a name that is not valid percent-encoding names
   * nothing. The writer encodes the segment and the half that answers decodes
   * it, so a Session named with a slash in it survives the trip whole.
   */
  it.each(rows.filter(([, row]) => row.at("a/b") !== row.at("a")))(
    "%s carries a name a path could not hold, whole",
    (_name, row) => {
      const held = row.shape.exec(row.at("a/b"))?.[1]

      expect(held).toBeDefined()
      expect(decodeURIComponent(held as string)).toBe("a/b")
    },
  )

  // A call that carries nothing is not one that carries a shape it cannot
  // read. The status is the whole of the answer, so any body at all is one
  // this reads.
  it.each(rows)("%s reads a body it says it does not carry", (_name, row) => {
    if (row.body !== nothing) return
    expect(row.body.reads(undefined)).not.toBeUndefined()
    expect(row.body.reads({ anything: true })).not.toBeUndefined()
  })

  it.each(rows)("%s states a method this wire answers", (_name, row) => {
    expect(["GET", "POST", "PUT", "DELETE"]).toContain(row.method)
  })
})
