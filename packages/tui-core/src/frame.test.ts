import { describe, expect, it } from "vitest"
import {
  costText,
  EMPTY,
  overlayLines,
  seconds,
  tokenLine,
  tookText,
  type Overlay,
} from "./frame.js"

describe("EMPTY", () => {
  it("is a Frame with nothing in it", () => {
    expect(EMPTY.session).toEqual([])
    expect(EMPTY.live).toBe("")
    expect(EMPTY.cursor).toBe(0)
    expect(EMPTY.work.running).toBe(false)
    expect(EMPTY.overlay).toBeUndefined()
  })
})

describe("overlayLines", () => {
  const overlay: Overlay = {
    title: "commands",
    source: "query",
    query: "mo",
    rows: [
      { id: "model", label: "/model", detail: "Show or set the session model" },
      { id: "mode", label: "/mode", detail: "" },
    ],
    selected: 1,
    hint: "enter run · esc close",
  }

  it("spells the panel in rows, marking the selected one", () => {
    expect(overlayLines(overlay)).toEqual([
      "── commands ──",
      "› mo",
      "  /model  Show or set the session model",
      "▸ /mode",
      "── enter run · esc close ──",
    ])
  })

  // Typing lands in the input line, which the renderer already draws — the
  // same text twice reads as two different texts.
  it("says no query line when the buffer is the query", () => {
    expect(overlayLines({ ...overlay, source: "buffer" })).not.toContain("› mo")
  })
})

describe("tokenLine", () => {
  it("says nothing when nothing was reported", () => {
    expect(tokenLine(null, null)).toBe("")
  })

  // A counter nothing reported is not zero, so it is left unsaid.
  it("says only the counter that was reported", () => {
    expect(tokenLine(10, null)).toBe("10 in")
    expect(tokenLine(null, 4)).toBe("4 out")
  })

  it("says both when both were reported", () => {
    expect(tokenLine(10, 4)).toBe("10 in / 4 out")
  })
})

describe("seconds", () => {
  it("says milliseconds as seconds with one decimal", () => {
    expect(seconds(0)).toBe("0.0s")
    expect(seconds(3210)).toBe("3.2s")
  })
})

describe("tookText", () => {
  it("phrases how long the last Run took", () => {
    expect(tookText(1500)).toBe("took 1.5s")
  })
})

describe("costText", () => {
  it("says nothing for a Session that has not run", () => {
    expect(costText({ kind: "none" })).toBe("")
  })

  it("says a reported cost plainly", () => {
    expect(costText({ kind: "reported", ticks: 123_000_000 })).toBe("$0.0123")
  })

  // An estimate read as a cost is the mistake the pair exists to prevent.
  it("marks an estimate", () => {
    expect(costText({ kind: "estimated", ticks: 123_000_000 })).toBe("~$0.0123")
  })

  it("says in words when a cost was not reported", () => {
    expect(costText({ kind: "unreported" })).toBe("cost unreported")
  })
})
