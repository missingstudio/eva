import { EMPTY, type Frame, type Overlay } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import {
  bannerRows,
  caret,
  CAPTION_TICKS,
  CAPTIONS,
  HINT,
  inputHeight,
  panelWindow,
  PANEL_ROWS,
  promptLine,
  PROMPT_PREFIX,
  SEPARATOR,
  SPINNER,
  statusLeft,
  toLines,
  workLine,
} from "./frame.js"

// The app knows the transcript only through Frame, so the test does too.
type Message = Frame["session"][number]

const frameOf = (session: readonly Message[]): Frame => ({ ...EMPTY, session })

const message = (author: Message["author"], blocks: Message["blocks"]): Message => ({
  author,
  blocks,
})

const text = (value: string) => ({
  type: "content" as const,
  block: 0,
  content: { type: "text" as const, text: value },
})

describe("toLines", () => {
  it("carries the author down, so a line knows who said it", () => {
    const lines = toLines(
      frameOf([message("human", [text("ask")]), message("agent", [text("answer")])]),
    )
    expect(lines.map((one) => [one.kind, one.text])).toEqual([
      ["human", "ask"],
      ["agent", "answer"],
    ])
  })

  it("names a thought a thought, whoever the author is", () => {
    const lines = toLines(
      frameOf([
        message("agent", [
          { type: "thought", block: 0, content: { type: "text", text: "hmm" } },
          text("out loud"),
        ]),
      ]),
    )
    expect(lines.map((one) => one.kind)).toEqual(["thought", "agent"])
  })

  it("draws a tool call as its name and status", () => {
    const lines = toLines(
      frameOf([
        message("agent", [
          { type: "tool", id: "t1", name: "read", tool: "read", status: "completed" },
        ]),
      ]),
    )
    expect(lines[0]).toMatchObject({ kind: "tool", text: "read completed" })
  })

  // A call that has been answered says how it ended. A Tool Status alone
  // reads as a call that worked, and `denied` is not that.
  it("draws an answered call with its disposition", () => {
    const lines = toLines(
      frameOf([
        message("agent", [
          {
            type: "tool",
            id: "t1",
            name: "write",
            tool: "edit",
            status: "failed",
            disposition: "denied",
          },
        ]),
      ]),
    )
    expect(lines[0]).toMatchObject({ kind: "tool", text: "write failed denied" })
  })

  /**
   * A file the Run changed is something the Run did. It used to fall out of
   * the record fold before the terminal could ever draw it.
   *
   * The count of hunks is named beside the path, because the record holds it
   * and it is the size of the work: one file changed in one place is not one
   * file rewritten.
   */
  it("draws an edit as the file it changed and how much of it", () => {
    const lines = toLines(
      frameOf([message("agent", [{ type: "edit", path: "docs/one.md", hunks: 2 }])]),
    )
    expect(lines[0]).toMatchObject({ kind: "tool", text: "edit docs/one.md 2 hunks" })
  })

  // One is not "1 hunks", and a reader counting the work does not want to
  // read a number twice to find out.
  it("says one hunk in the singular", () => {
    const lines = toLines(
      frameOf([message("agent", [{ type: "edit", path: "docs/one.md", hunks: 1 }])]),
    )
    expect(lines[0]).toMatchObject({ kind: "tool", text: "edit docs/one.md 1 hunk" })
  })

  /**
   * A mode is a fact on the record, so the scroll-back says which mode each
   * Run was made under. It is a system line: nobody said it, and drawing it
   * as the agent's words would put it in the Run's voice.
   */
  it("draws a mode change as the mode and why it changed", () => {
    const lines = toLines(
      frameOf([
        message("agent", [{ type: "mode", mode: "read-only", reason: "a person named it" }]),
      ]),
    )
    expect(lines[0]).toMatchObject({
      kind: "system",
      text: "mode read-only · a person named it",
    })
  })

  // A record that names no reason is drawn with none. An invented one would
  // be a renderer that knows more than the record.
  it("draws a mode change with no reason as the mode alone", () => {
    const lines = toLines(frameOf([message("agent", [{ type: "mode", mode: "autonomous" }])]))
    expect(lines[0]).toMatchObject({ kind: "system", text: "mode autonomous" })
  })

  it("passes over content that is not text", () => {
    const lines = toLines(
      frameOf([
        message("agent", [
          {
            type: "content",
            block: 0,
            content: { type: "image", data: "x", mimeType: "image/png" },
          },
        ]),
      ]),
    )
    expect(lines).toEqual([])
  })

  // React needs a stable key per line, and two blocks must never share one.
  it("gives every line its own key", () => {
    const lines = toLines(
      frameOf([message("agent", [text("one"), text("two")]), message("human", [text("three")])]),
    )
    expect(new Set(lines.map((one) => one.key)).size).toBe(lines.length)
  })

  it("draws nothing for an empty frame", () => {
    expect(toLines(EMPTY)).toEqual([])
  })

  // The note rides along as a line, so a renderer that draws lines rather
  // than groups still says what the Run took.
  it("carries the took note as a line of its own", () => {
    const lines = toLines({
      ...frameOf([message("agent", [text("answer")])]),
      took: "took 1.2s",
    })
    expect(lines.map((one) => [one.kind, one.text])).toEqual([
      ["agent", "answer"],
      ["system", "took 1.2s"],
    ])
  })
})

const working = (tick: number, elapsed = "1.0s"): Frame => ({
  ...EMPTY,
  status: { ...EMPTY.status, mode: "ready" },
  work: { running: true, elapsed, tick, hint: "" },
})

describe("the work line", () => {
  it("says nothing while no Run is open", () => {
    expect(workLine(EMPTY)).toBeUndefined()
  })

  // The status line keeps its word when there is no Run to describe.
  it("leaves the status line to the mode while nothing runs", () => {
    expect(statusLeft({ ...EMPTY, status: { ...EMPTY.status, mode: "ready" } })).toBe("ready")
  })

  it("turns the spinner on every tick", () => {
    const turned = SPINNER.map((_, tick) => workLine(working(tick))?.spinner)
    expect(turned).toEqual([...SPINNER])
  })

  it("comes back round, however long a Run goes on", () => {
    expect(workLine(working(SPINNER.length))?.spinner).toBe(SPINNER[0])
  })

  // A caption is read rather than watched, so it holds while the spinner
  // turns under it.
  it("holds a caption for many turns of the spinner", () => {
    expect(workLine(working(0))?.caption).toBe(`${CAPTIONS[0]}…`)
    expect(workLine(working(CAPTION_TICKS - 1))?.caption).toBe(`${CAPTIONS[0]}…`)
    expect(workLine(working(CAPTION_TICKS))?.caption).toBe(`${CAPTIONS[1]}…`)
  })

  it("takes the left of the status line while a Run is open", () => {
    expect(statusLeft(working(0, "2.5s"))).toBe(`${SPINNER[0]} ${CAPTIONS[0]}…${SEPARATOR}2.5s`)
  })

  /**
   * One spelling, two renderers. A renderer that draws the whole line takes
   * `text`; one that colours the parts takes them and never rejoins them,
   * which is how the two drifted apart — the rich one spelled the gap
   * before the elapsed time as a space and the plain one as the separator.
   */
  it("says the line and its parts, and they are the same line", () => {
    const work = workLine(working(0, "2.5s"))
    expect(work?.text).toBe(`${work?.spinner} ${work?.caption}${work?.since}`)
    expect(statusLeft(working(0, "2.5s"))).toBe(work?.text)
  })

  // A Run that has not been timed yet has nothing to say about how long.
  it("leaves the elapsed time out until there is one", () => {
    expect(workLine(working(0, ""))?.since).toBe("")
    expect(workLine(working(0, ""))?.text).toBe(`${SPINNER[0]} ${CAPTIONS[0]}…`)
  })
})

describe("the banner rows", () => {
  const placed = (over: Partial<Frame["banner"]>): Frame => ({
    ...EMPTY,
    banner: { ...EMPTY.banner, ...over },
  })

  // A row with nothing to say is left out rather than drawn empty.
  it("leaves out a row with nothing to say", () => {
    expect(bannerRows(placed({ version: "0.0.0" })).map((row) => row.value)).toEqual(["0.0.0"])
  })

  /**
   * The label arrives padded to the column the widest label sets. It used to
   * come back beside a width, and the pairing of the two was an invariant
   * both renderers held by hand — and both re-performed.
   */
  it("pads every label to one column, set by the widest", () => {
    const rows = bannerRows(placed({ version: "0.0.0", branch: "main" }))
    const widths = new Set(rows.map((row) => row.label.length))
    expect(widths.size).toBe(1)
    expect(rows[0]?.label).toBe("version   ")
  })
})

describe("the caret", () => {
  // Where a person who just typed the line would be: at the end of it.
  const typed = (input: string, cursor = Array.from(input).length): Frame => ({
    ...EMPTY,
    input,
    cursor,
  })

  // An empty line still has a caret: it sits over the placeholder, which is
  // how a reader tells the line is theirs to type into.
  it("sits after the prompt when nothing is typed", () => {
    expect(caret(EMPTY)).toEqual({ row: 0, column: Array.from(PROMPT_PREFIX).length })
  })

  it("sits after what has been typed", () => {
    expect(caret(typed("abc")).column).toBe(Array.from(PROMPT_PREFIX).length + 3)
  })

  // The surface moved it, so this draws it there. A renderer that assumed
  // the end drew the caret in one place and put the next character in
  // another.
  it("sits where the surface put it, not at the end", () => {
    expect(caret(typed("abc", 1)).column).toBe(Array.from(PROMPT_PREFIX).length + 1)
  })

  // One astral character is one cell, so it moves the caret once.
  it("counts a character rather than the units that spell it", () => {
    expect(caret(typed("👋")).column).toBe(Array.from(PROMPT_PREFIX).length + 1)
  })

  it("follows the typing onto a later row", () => {
    expect(caret(typed("one\ntwo"))).toEqual({
      row: 1,
      column: Array.from(PROMPT_PREFIX).length + 3,
    })
  })

  // A caret on an earlier row is on that row, counted from its start rather
  // than from the start of the whole line.
  it("counts the column from the start of the row it is on", () => {
    expect(caret(typed("one\ntwo", 5))).toEqual({
      row: 1,
      column: Array.from(PROMPT_PREFIX).length + 1,
    })
  })

  // A cursor outside the line is nowhere, so it is held to the line rather
  // than drawn off the end of it.
  it("holds a cursor past either end to the line", () => {
    expect(caret(typed("abc", 9)).column).toBe(Array.from(PROMPT_PREFIX).length + 3)
    expect(caret(typed("abc", -2)).column).toBe(Array.from(PROMPT_PREFIX).length)
  })

  // The caret is counted from the same string the line is drawn with, so
  // what stands in front of the typing is measured once.
  it("stands where the drawn line puts it", () => {
    expect(promptLine(typed("abc")).startsWith(PROMPT_PREFIX)).toBe(true)
    expect(caret(typed("abc")).column).toBe(Array.from(`${PROMPT_PREFIX}abc`).length)
  })

  // The two rules are the box, so they are counted in.
  it("grows the box with the line", () => {
    expect(inputHeight(EMPTY)).toBe(3)
    expect(inputHeight(typed("one\ntwo"))).toBe(4)
  })
})

describe("the banner hint", () => {
  // A door nobody names is a door nobody finds, and every door this surface
  // has is one a keymap row opens.
  it("names the doors the surface has", () => {
    expect(HINT).toContain("/help")
    expect(HINT).toContain("ctrl+k")
  })
})

describe("the panel window", () => {
  const panel = (count: number, selected: number): Overlay => ({
    title: "commands",
    source: "query",
    query: "",
    rows: Array.from({ length: count }, (_, at) => ({
      id: `${at}`,
      label: `/row${at}`,
      detail: "",
    })),
    selected,
    hint: "↑↓ move",
  })

  it("draws every row of a panel that fits", () => {
    const drawn = panelWindow(panel(3, 0))
    expect(drawn.from).toBe(0)
    expect(drawn.rows).toHaveLength(3)
  })

  it("draws no more rows than fit", () => {
    expect(panelWindow(panel(40, 0)).rows).toHaveLength(PANEL_ROWS)
  })

  // A marker scrolled off the panel is a panel that takes something nobody
  // was looking at.
  it("keeps the selected row among the rows it draws", () => {
    for (const selected of [0, 7, 8, 21, 39]) {
      const drawn = panelWindow(panel(40, selected))
      expect(selected - drawn.from).toBeGreaterThanOrEqual(0)
      expect(selected - drawn.from).toBeLessThan(drawn.rows.length)
      expect(drawn.rows[selected - drawn.from]?.id).toBe(`${selected}`)
    }
  })
})
