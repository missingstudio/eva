import { sessionID, type CostSummary, type TranscriptMessage } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import {
  apply,
  ARMED,
  ASKING,
  backStep,
  frameOf,
  initial,
  type ConsoleEvent,
  type ConsoleState,
} from "./console.js"
import { opened } from "./overlay.js"

const session = sessionID("sess_console")

const start = initial(session)

// Where this Console runs, which no Run changes.
const PLACE = { version: "0.0.0", branch: "main", directory: "~/eva" }

const fold = (over: Partial<Extract<ConsoleEvent, { kind: "folded" }>> = {}) =>
  ({
    kind: "folded",
    messages: [],
    model: "claude",
    summary: NOTHING,
    holding: false,
    ...over,
  }) satisfies ConsoleEvent

const NOTHING: CostSummary = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
  serverToolTokens: null,
  costTicks: null,
  estimatedCostTicks: null,
}

const message = (text: string): TranscriptMessage => ({
  author: "agent",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

const events = (state: ConsoleState, ...applied: ConsoleEvent[]): ConsoleState =>
  applied.reduce(apply, state)

describe("an open Run", () => {
  it("opens with the prompt shown and the clock at zero", () => {
    const opened = apply(start, { kind: "opened", line: "go", at: 1000 })

    expect(opened.shown).toContainEqual(expect.objectContaining({ author: "human" }))
    expect(opened.mode).toBe("running")
    expect(opened.work).toEqual({ running: true, elapsed: "0.0s", tick: 0, hint: "" })
    expect(opened.took).toBe("")
    expect(opened.live).toBe("")
  })

  it("grows the Live area by append, and only from text", () => {
    const streamed = events(
      apply(start, { kind: "opened", line: "go", at: 0 }),
      {
        kind: "streamed",
        payload: { kind: "text", block: 0, content: { type: "text", text: "an " } },
      },
      { kind: "streamed", payload: { kind: "finished", claim: { result: "done", summary: "x" } } },
      {
        kind: "streamed",
        payload: { kind: "text", block: 0, content: { type: "text", text: "answer" } },
      },
    )

    expect(streamed.live).toBe("an answer")
  })

  it("reads the clock off the tick, and a tick after the Run says nothing", () => {
    const ticked = events(
      apply(start, { kind: "opened", line: "go", at: 1000 }),
      { kind: "ticked", at: 1250 },
      { kind: "ticked", at: 1500 },
    )
    expect(ticked.work).toEqual({ running: true, elapsed: "0.5s", tick: 2, hint: "" })

    const after = apply(apply(ticked, { kind: "closed", at: 2200 }), { kind: "ticked", at: 9000 })
    expect(after.work).toEqual({ running: false, elapsed: "", tick: 0, hint: "" })
  })

  it("closes with what it took, and the spinner stops", () => {
    const closed = events(apply(start, { kind: "opened", line: "go", at: 1000 }), {
      kind: "closed",
      at: 2200,
    })

    expect(closed.took).toBe("took 1.2s")
    expect(closed.work).toEqual({ running: false, elapsed: "", tick: 0, hint: "" })
  })

  it("drops the Live area and the spinner when it is cancelled", () => {
    const cancelled = events(
      apply(start, { kind: "opened", line: "go", at: 0 }),
      {
        kind: "streamed",
        payload: { kind: "text", block: 0, content: { type: "text", text: "half" } },
      },
      { kind: "cancelled" },
    )

    expect(cancelled.live).toBe("")
    expect(cancelled.mode).toBe("ready")
    expect(cancelled.work.running).toBe(false)
  })
})

describe("the fold", () => {
  it("replaces what was shown, and the stream with it", () => {
    const folded = events(
      apply(start, { kind: "opened", line: "go", at: 0 }),
      {
        kind: "streamed",
        payload: { kind: "text", block: 0, content: { type: "text", text: "streaming" } },
      },
      fold({ messages: [message("an answer")] }),
    )

    expect(folded.shown).toEqual([message("an answer")])
    expect(folded.live).toBe("")
    expect(folded.mode).toBe("ready")
    expect(folded.model).toBe("claude")
  })

  // A fold that comes back with nothing has lost the record rather than the
  // conversation, so holding keeps the screen instead of blanking it.
  it("keeps the screen when a held fold comes back empty", () => {
    const opened = apply(start, { kind: "opened", line: "a question", at: 0 })
    expect(apply(opened, fold({ holding: true })).shown).toEqual(opened.shown)
    // Choosing another Session passes holding over: empty really is empty.
    expect(apply(opened, fold({ holding: false })).shown).toEqual([])
  })

  it("spells the tokens and the cost the way the contract does", () => {
    const folded = apply(
      start,
      fold({
        messages: [message("an answer")],
        summary: { ...NOTHING, inputTokens: 10, outputTokens: 4, costTicks: 123_000_000 },
      }),
    )

    expect(folded.tokens).toBe("10 in / 4 out")
    expect(folded.cost).toBe("$0.0123")
  })

  it("says nothing about cost when the Session has not run", () => {
    expect(apply(start, fold()).cost).toBe("")
  })
})

describe("what the surface says", () => {
  it("lands one note per line, and an empty line lands nowhere", () => {
    expect(apply(start, { kind: "said", text: "one\n\ntwo\n" }).notes).toEqual(["one", "two"])
  })

  // Two answers with nothing between them read as one longer answer, which
  // is how `/help` twice looked like one help nobody could tell the end of.
  it("stands one saying clear of the one before it", () => {
    const twice = events(apply(start, { kind: "said", text: "/help\nthe rows" }), {
      kind: "said",
      text: "/help\nthe rows",
    })

    expect(twice.notes).toEqual(["/help", "the rows", "", "/help", "the rows"])
  })

  it("says nothing for a saying with nothing in it", () => {
    expect(apply(start, { kind: "said", text: "\n" }).notes).toEqual([])
  })

  /**
   * A note is the surface speaking, and the record cannot rebuild it — so
   * it never enters the fold. It used to be pushed in as a system message,
   * which put lines no Run said into the field a pipe writes as the record.
   */
  it("never reaches the record's fold", () => {
    const said = apply(start, { kind: "said", text: "/help output" })
    expect(said.shown).toEqual([])
  })

  it("shows a question and holds the line for its answer", () => {
    const asked = apply(start, { kind: "asked", question: "deploy?" })
    expect(asked.asking).toBe(true)
    expect(asked.notes).toEqual(["deploy?"])

    expect(apply(asked, { kind: "answered" }).asking).toBe(false)
  })

  // One state at a time on the left of the status line, and a question
  // outranks the rest: what the line is for right now is what it says.
  it("says the line is for the answer while a question is open", () => {
    const asked = apply(start, { kind: "asked", question: "deploy?" })

    expect(frameOf(asked, PLACE).status.mode).toBe(ASKING)
    expect(frameOf(apply(asked, { kind: "answered" }), PLACE).status.mode).toBe("ready")
  })

  // The surface's own words last until the conversation moves on. A notice
  // is for the person who just started the surface.
  it("clears its notes when a Run opens", () => {
    const noticed = apply(start, { kind: "said", text: "theme dusk is not a theme here" })
    expect(apply(noticed, { kind: "opened", line: "go", at: 0 }).notes).toEqual([])
  })

  it("clears its notes when it follows another Session", () => {
    const noticed = apply(start, { kind: "said", text: "/help output" })
    expect(apply(noticed, { kind: "selected", session: sessionID("sess_other") }).notes).toEqual([])
  })

  // A fold is the record arriving, which says nothing about what the
  // surface said — so a fold leaves the notes where they are.
  it("keeps its notes across a fold", () => {
    const noticed = apply(start, { kind: "said", text: "a notice" })
    expect(apply(noticed, fold({ messages: [message("an answer")] })).notes).toEqual(["a notice"])
  })
})

describe("the panel", () => {
  const ROWS = [
    { id: "model", label: "/model", detail: "the model" },
    { id: "clear", label: "/clear", detail: "a new Session" },
  ]

  const panel = (source: "query" | "buffer" = "query") =>
    opened("commands", ROWS, "", { kind: "command" }, source, "hint")

  const showing = (state: ConsoleState) =>
    apply(state, { kind: "opened-overlay", overlay: panel() })

  it("narrows on its own query, and keeps the selection inside what is left", () => {
    const filtered = events(
      showing(start),
      { kind: "stepped", by: 1 },
      { kind: "filtered", query: "mod" },
    )

    expect(filtered.overlay?.rows.map((row) => row.id)).toEqual(["model"])
    expect(filtered.overlay?.selected).toBe(0)
  })

  // A panel that follows the line follows it: its query is the buffer, so
  // the two can never say different things.
  it("follows the line when the line is its query", () => {
    const typed = apply(apply(start, { kind: "opened-overlay", overlay: panel("buffer") }), {
      kind: "typed",
      buffer: "/mod",
      cursor: 4,
    })

    expect(typed.overlay?.query).toBe("/mod")
    expect(typed.overlay?.rows.map((row) => row.id)).toEqual(["model"])
  })

  // A panel over a moving fold is a panel over the wrong thing.
  it("goes with the Run that opens", () => {
    expect(apply(showing(start), { kind: "opened", line: "go", at: 0 }).overlay).toBeUndefined()
  })

  it("leaves nothing behind when it closes", () => {
    expect(apply(showing(start), { kind: "closed-overlay" }).overlay).toBeUndefined()
  })

  // What is decided stays with the surface; what is drawn goes to the
  // renderer, and the Frame carries no intent for a renderer to act on.
  it("reaches the Frame as what is drawn, and nothing that is decided", () => {
    const frame = frameOf(showing(start), PLACE)

    expect(frame.overlay?.rows).toEqual(ROWS)
    expect(frame.overlay).not.toHaveProperty("intent")
    expect(frame.overlay).not.toHaveProperty("all")
  })
})

describe("the screen's colors", () => {
  const DUSK = { foreground: "#eee", muted: "#888", accent: "#7aa2f7", warning: "#e0af68" }

  it("are a fact of the Frame, so a renderer draws what was chosen", () => {
    const themed = apply(start, { kind: "themed", colors: DUSK })

    expect(themed.theme).toEqual(DUSK)
    expect(frameOf(themed, PLACE).theme).toEqual(DUSK)
  })

  // No colors is the renderer's own default, which is what restoring says
  // when nothing was set before.
  it("go back to the renderer's own when nothing is said", () => {
    const cleared = apply(apply(start, { kind: "themed", colors: DUSK }), { kind: "themed" })

    expect(cleared.theme).toBeUndefined()
    expect(frameOf(cleared, PLACE)).not.toHaveProperty("theme")
  })
})

describe("stepping back", () => {
  const running = apply(start, { kind: "opened", line: "go", at: 0 })

  it("clears the line before it touches the Run", () => {
    const typed = apply(running, { kind: "typed", buffer: "half typed", cursor: 4 })
    expect(backStep(typed)).toBe("clear-line")

    const cleared = apply(typed, { kind: "backed" })
    expect(cleared.buffer).toBe("")
    expect(cleared.cursor).toBe(0)
    // The Run is untouched: one press, one step.
    expect(cleared.armed).toBe(false)
    expect(cleared.work.running).toBe(true)
  })

  // Interrupting is two presses on purpose, and the screen says so between
  // them. Nobody arrives at a stopped Run by pressing one key once.
  it("arms on the first press against an open Run, and says so", () => {
    const armed = apply(running, { kind: "backed" })
    expect(armed.armed).toBe(true)
    expect(armed.work.hint).toBe(ARMED)
    expect(backStep(armed)).toBe("interrupt")
  })

  it("decays on any other key", () => {
    const armed = apply(running, { kind: "backed" })
    const disarmed = apply(armed, { kind: "disarmed" })
    expect(disarmed.armed).toBe(false)
    expect(disarmed.work.hint).toBe("")
    expect(backStep(disarmed)).toBe("arm")
  })

  it("does nothing with nothing open", () => {
    expect(backStep(start)).toBe("nothing")
    expect(apply(start, { kind: "backed" })).toEqual(start)
  })

  // The cancel that follows an interrupt takes the arming with it, so the
  // next Run does not start half armed.
  it("is not armed after the Run it was armed against was cancelled", () => {
    const armed = apply(running, { kind: "backed" })
    expect(apply(armed, { kind: "cancelled" }).armed).toBe(false)
  })
})

describe("the prompt history", () => {
  const asked = events(
    start,
    { kind: "submitted", line: "first" },
    { kind: "submitted", line: "second" },
  )

  it("walks back from the newest line to the oldest, and stops there", () => {
    const once = apply(asked, { kind: "recalled", direction: "back" })
    expect(once.buffer).toBe("second")
    // The caret lands after what was recalled, ready to be edited.
    expect(once.cursor).toBe(6)

    const twice = apply(once, { kind: "recalled", direction: "back" })
    expect(twice.buffer).toBe("first")
    // Past the oldest is the oldest. A wrap reads as the history changing.
    expect(apply(twice, { kind: "recalled", direction: "back" }).buffer).toBe("first")
  })

  it("walks forward to the empty line it started from", () => {
    const back = events(
      asked,
      { kind: "recalled", direction: "back" },
      { kind: "recalled", direction: "back" },
    )
    expect(apply(back, { kind: "recalled", direction: "forward" }).buffer).toBe("second")

    const home = events(
      back,
      { kind: "recalled", direction: "forward" },
      { kind: "recalled", direction: "forward" },
    )
    expect(home.buffer).toBe("")
    expect(home.recall).toBeUndefined()
  })

  it("says nothing when there is no history to walk", () => {
    expect(apply(start, { kind: "recalled", direction: "back" }).buffer).toBe("")
    expect(apply(start, { kind: "recalled", direction: "forward" }).buffer).toBe("")
  })

  // An edit makes the line the person's, so the walk ends and the next up
  // starts a new one from the newest line.
  it("ends the walk on an edit, and not on a caret move", () => {
    const recalled = apply(asked, { kind: "recalled", direction: "back" })
    expect(apply(recalled, { kind: "typed", buffer: "second!", cursor: 7 }).recall).toBeUndefined()
    expect(apply(recalled, { kind: "typed", buffer: "second", cursor: 2 }).recall).toBe(1)
  })

  // Two of the same line is one line to walk back through.
  it("stores consecutive duplicates once", () => {
    const twice = events(
      start,
      { kind: "submitted", line: "again" },
      { kind: "submitted", line: "again" },
    )
    expect(twice.history).toEqual(["again"])
  })
})

describe("the Frame", () => {
  const place = PLACE

  it("is a projection: the banner, the conversation, and the status", () => {
    const state = events(
      { ...start, model: "claude", cost: "$0.0123", tokens: "10 in / 4 out" },
      { kind: "typed", buffer: "half typed", cursor: 4 },
      { kind: "said", text: "a notice" },
    )
    const frame = frameOf(state, place)

    expect(frame.banner).toEqual({ ...place, model: "claude" })
    expect(frame.input).toBe("half typed")
    // Where the caret sits is the surface's to say, so both renderers put
    // it in the same place.
    expect(frame.cursor).toBe(4)
    // The record and the surface's own words reach the Frame apart.
    expect(frame.session).toEqual([])
    expect(frame.notes).toEqual(["a notice"])
    expect(frame.status).toEqual({
      model: "claude",
      tokens: "10 in / 4 out",
      cost: "$0.0123",
      mode: "ready",
    })
  })

  it("follows a selected Session", () => {
    const other = sessionID("sess_other")
    expect(apply(start, { kind: "selected", session: other }).session).toBe(other)
  })
})
