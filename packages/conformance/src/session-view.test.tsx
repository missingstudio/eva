import { foldTranscript } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type ContentBlock,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { blockFold, blocksOf, type Block } from "@missingstudio/eva-session-view"
import { toLines } from "@missingstudio/eva-tui"
import { EMPTY } from "@missingstudio/eva-tui-core"
import { BlockView, Turns } from "@missingstudio/eva-web-app"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

/**
 * The two renderers of one fold, over one Trace. A plugin may not import a
 * plugin and the page is an app, so the place the terminal's mapping and the
 * page's mapping meet is here.
 *
 * What "both agree" means, since the two legitimately draw different amounts:
 * a renderer may say less about a Block than another says, and it may never
 * say something else. So the comparison is over the **record facts** each
 * drawing names — a tool's name, its Tool Status, its Disposition, a diff's
 * path and its count of hunks — and the rules are these.
 *
 * 1. The page names every fact of every Block, and draws each Block itself.
 *    It is the renderer that drops nothing, including the Blocks it has no
 *    primitive for.
 * 2. Whatever the terminal names is a fact the same Block holds, and one the
 *    page names too. A row naming a fact the record does not hold, or one the
 *    page leaves out, is the two screens disagreeing.
 * 3. The Blocks the terminal does draw come in the order the fold gave them,
 *    so a reader moving between the two screens reads one transcript.
 */

const SESSION = sessionID("sess_one")

let counter = 0
const event = (payload: Payload): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: counter,
    at: { wall: "2026-08-26T00:00:00.000Z" },
    run: runID("run_a"),
    session: SESSION,
    parent: null,
    payload,
  }
}

const said = (block: number, content: ContentBlock): Payload => ({ kind: "text", block, content })

/**
 * One Run that did the things a Run does: it said something, it thought on
 * the way to it, it called a tool and the call was refused, it left another
 * call open, it changed a file, it produced an image, and it produced
 * something neither renderer names.
 */
const TRACE: readonly Event[] = [
  event({ kind: "started", intent: "read the trace back" }),
  event({ kind: "thought", block: 0, content: { type: "text", text: "the sink holds it" } }),
  event(said(1, { type: "text", text: "here is what it holds" })),
  event({
    kind: "tool_call",
    id: "t1",
    name: "write",
    tool: "edit",
    args: {},
    status: "pending",
    redacted: false,
  }),
  event({ kind: "tool_update", id: "t1", status: "failed" }),
  event({ kind: "tool_result", id: "t1", name: "write", disposition: "denied", bytes: 0 }),
  event({
    kind: "tool_call",
    id: "t2",
    name: "search",
    tool: "search",
    args: {},
    status: "in_progress",
    redacted: false,
  }),
  event({ kind: "edit", path: "docs/summary.md", hunks: 3 }),
  event(said(2, { type: "image", data: "aGk=", mimeType: "image/png" })),
  event(said(3, { type: "audio", data: "aGk=", mimeType: "audio/wav" })),
]

/**
 * What the record says about one Block, as the strings a renderer that draws
 * it would show. Neither renderer may name one that is not here, and the page
 * may not leave one out.
 */
const factsOf = (block: Block): readonly string[] => {
  switch (block.kind) {
    case "words":
    case "reasoning":
      return [block.text]
    case "tool":
      return [block.name, block.status]
    case "result":
      return [block.name, block.status, block.disposition]
    case "diff":
      return [block.path, String(block.hunks)]
    case "image":
      return [block.mimeType]
    case "unknown":
      return [block.originalKind]
  }
}

const namedIn = (drawing: string, block: Block): readonly string[] =>
  factsOf(block).filter((fact) => drawing.includes(fact))

const record = foldTranscript(SESSION, TRACE)
const turns = blocksOf(record)
const blocks = turns.flatMap((turn) => turn.blocks)

// The terminal reads the Messages it already holds and the page reads the
// Transcript it was handed. One fold, two ways into it.
const rows = toLines({ ...EMPTY, session: record.messages() })
const page = renderToStaticMarkup(<Turns turns={turns} />)

// One Block as each renderer draws it: the terminal's rows for it, and the
// page's own element for it.
const rowsFor = (block: Block): string =>
  rows
    .filter((row) => row.key === block.key)
    .map((row) => row.text)
    .join(" ")

const cardFor = (block: Block): string => renderToStaticMarkup(<BlockView block={block} />)

describe("one fold, two renderers", () => {
  // Two folds would disagree, and a person comparing the screen with the page
  // would find the disagreement. The two entries are the same fold.
  it("is one fold, whichever way a surface comes into it", () => {
    expect(turns).toEqual(blockFold(record.messages()))
  })

  it("folds this Trace to every member of the union, so both mappings run whole", () => {
    expect(blocks.map((block) => block.kind)).toEqual([
      "words",
      "reasoning",
      "words",
      "result",
      "tool",
      "diff",
      "image",
      "unknown",
    ])
  })
})

describe("what the two renderings agree the Run did", () => {
  // The page is the renderer that drops nothing.
  it.each(blocks)("the page names every fact of the $kind Block", (block) => {
    expect(namedIn(cardFor(block), block)).toEqual(factsOf(block))
  })

  it.each(blocks)("and draws the $kind Block itself, rather than mentioning it", (block) => {
    expect(page).toContain(cardFor(block))
  })

  /**
   * The terminal says less. What it says is the same, and that is the whole
   * of the claim being made here.
   */
  it.each(blocks)("the terminal says nothing about the $kind Block the page does not", (block) => {
    const drawn = [...namedIn(rowsFor(block), block)]
    expect(factsOf(block)).toEqual(expect.arrayContaining(drawn))
    expect(namedIn(cardFor(block), block)).toEqual(expect.arrayContaining(drawn))
  })

  /**
   * A row is a line of text and an image is not one, so the screen draws
   * fewer Blocks than the page. That is a renderer that renders less, and the
   * page is where the record stays whole.
   */
  it("draws no row for the Blocks the terminal has none for, and the page draws them", () => {
    const undrawn = blocks.filter((block) => rowsFor(block) === "")

    expect(undrawn.map((block) => block.kind)).toEqual(["image", "unknown"])
    for (const block of undrawn) expect(namedIn(cardFor(block), block)).toEqual(factsOf(block))
  })

  /**
   * The degradation rule, at the one place the two renderers can be held
   * against it. Neither has a primitive for this Block; the terminal draws
   * nothing and the page says what it could not draw, so the record is on
   * one screen and missing from the other rather than lost from both.
   */
  it("says on the page what neither renderer can draw, rather than dropping it", () => {
    const found = blocks.find((block) => block.kind === "unknown")
    expect(found).toBeDefined()
    if (found === undefined) return

    expect(rowsFor(found)).toBe("")
    expect(cardFor(found)).toContain("cannot draw")
    expect(cardFor(found)).toContain("audio")
  })

  // A reader moving between the two screens reads one transcript, so the
  // Blocks the terminal draws come in the order the fold gave them.
  it("draws the Blocks it does draw in the order the fold gave them", () => {
    const drawn = new Set(rows.map((row) => row.key))
    expect(rows.map((row) => row.key)).toEqual(
      blocks.map((block) => block.key).filter((key) => drawn.has(key)),
    )
  })
})
