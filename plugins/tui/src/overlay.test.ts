import type { CommandInfo } from "@missingstudio/eva-sdk"
import type { OverlayRow } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import {
  commandRows,
  completed,
  completionQuery,
  matching,
  opened,
  refiltered,
  score,
  selectedRow,
  stepped,
  COMMANDS_HINT,
  COMMANDS_TITLE,
} from "./overlay.js"

const row = (id: string, detail = ""): OverlayRow => ({ id, label: `/${id}`, detail })

const ROWS: readonly OverlayRow[] = [
  row("trace show", "replay this Run"),
  row("retry", "run it again"),
  row("model", "show or set the model"),
  row("clear", "open a new Session"),
]

const panel = (query: string) =>
  opened(COMMANDS_TITLE, ROWS, query, { kind: "command" }, "query", COMMANDS_HINT)

describe("score", () => {
  it("ranks a prefix above a word start, and a word start above a scatter", () => {
    expect(score("/trace show", "tra")).toBe(0)
    expect(score("/trace show", "show")).toBe(1)
    expect(score("/retry", "etry")).toBe(2)
    expect(score("/trace show", "re")).toBe(3)
  })

  it("says nothing when the letters are not there in order", () => {
    expect(score("/model", "xyz")).toBeUndefined()
    expect(score("/model", "ledom")).toBeUndefined()
  })

  it("matches whatever the case", () => {
    expect(score("/Model", "mod")).toBe(0)
  })

  // The `/` is punctuation on both sides: a line that carries it and a
  // palette query that does not are the same request.
  it("reads a command with or without the slash", () => {
    expect(score("/model", "/mod")).toBe(0)
    expect(score("/model", "mod")).toBe(0)
  })

  // An empty query is every row, in the order the domain holds them.
  it("takes every row on an empty query", () => {
    expect(score("/anything", "")).toBe(0)
  })
})

describe("matching", () => {
  it("keeps the best answers first and drops the rest", () => {
    // `/retry` starts with it; `/trace show` only scatters it; `/model`
    // and `/clear` do not hold it at all.
    expect(matching(ROWS, "re").map((one) => one.id)).toEqual(["retry", "trace show"])
  })

  // A domain's own ordering is information: a broad query must not shuffle
  // it into something arbitrary.
  it("keeps the rows in their own order when they rank the same", () => {
    expect(matching(ROWS, "").map((one) => one.id)).toEqual([
      "trace show",
      "retry",
      "model",
      "clear",
    ])
  })
})

describe("a panel", () => {
  it("opens on the first row that answers the query", () => {
    const open = panel("re")
    expect(open.rows.map((one) => one.id)).toEqual(["retry", "trace show"])
    expect(selectedRow(open)?.id).toBe("retry")
  })

  it("moves through the rows and stops at both ends", () => {
    const open = panel("re")
    expect(selectedRow(stepped(open, 1))?.id).toBe("trace show")
    // Past the end is the end; past the start is the start.
    expect(selectedRow(stepped(stepped(open, 1), 1))?.id).toBe("trace show")
    expect(selectedRow(stepped(open, -1))?.id).toBe("retry")
  })

  // A marker on a row that is no longer there is a panel that takes
  // something nobody was looking at.
  it("keeps the selection inside the rows the query left", () => {
    const moved = stepped(panel(""), 3)
    expect(selectedRow(moved)?.id).toBe("clear")
    expect(selectedRow(refiltered(moved, "tra"))?.id).toBe("trace show")
  })

  it("takes nothing when the query answers nothing", () => {
    const empty = refiltered(panel(""), "zzz")
    expect(empty.rows).toEqual([])
    expect(selectedRow(empty)).toBeUndefined()
  })

  // Every row is kept, so widening a query finds what narrowing it hid.
  it("finds a row again when the query widens", () => {
    const narrowed = refiltered(panel(""), "trace")
    expect(refiltered(narrowed, "").rows).toHaveLength(4)
  })
})

describe("slash completion", () => {
  it("asks for completion while the line is still naming a command", () => {
    expect(completionQuery("/")).toBe("")
    expect(completionQuery("/mo")).toBe("mo")
  })

  // The argument after the space belongs to the person, not to a list.
  it("says nothing once an argument has started", () => {
    expect(completionQuery("/model ")).toBeUndefined()
    expect(completionQuery("/model anthropic/claude")).toBeUndefined()
  })

  it("says nothing for a line that is not a command", () => {
    expect(completionQuery("")).toBeUndefined()
    expect(completionQuery("what is this")).toBeUndefined()
  })
})

describe("what tab leaves on the line", () => {
  const model: CommandInfo = {
    id: "model",
    description: "x",
    argumentHint: "provider/model",
  }
  const clear: CommandInfo = { id: "clear", description: "x" }

  // A command that takes an argument gets the space that starts one; one
  // that takes none does not, so enter is all that is left to press.
  it("starts the argument only for a command that takes one", () => {
    expect(completed(model)).toBe("/model ")
    expect(completed(clear)).toBe("/clear")
  })
})

describe("commands as rows", () => {
  it("names a command the way a person types it", () => {
    expect(commandRows([{ id: "model", description: "Show or set the session model" }])).toEqual([
      { id: "model", label: "/model", detail: "Show or set the session model" },
    ])
  })
})
