import { foldTranscript } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  sessionID,
  type ActorKind,
  type ContentBlock,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { askingOf, blockFold, blocksOf, type Block } from "@missingstudio/eva-session-view"
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
 * The source a person pastes into a prompt. It is code and not prose: the
 * comment lines open with `*`, which is a list marker, and the template
 * literal is in backticks, which are a code chip. Read as markdown it comes
 * out as a bulleted paragraph with the backticks eaten and the line breaks
 * closed up, so it is here to hold a renderer to the words as written.
 */
const PASTED = [
  "/**",
  " * every leaf path in a mapping, dotted",
  " */",
  "const path = prefix === null ? key : `${prefix}.${key}`",
].join("\n")

// A Run's answer, which is where a fenced block usually is.
const ANSWERED = ["```json", "[", '  { "file": "merge.ts", "severity": "low" }', "]", "```"].join(
  "\n",
)

/**
 * One Run that did the things a Run does: it was asked in words and then in
 * pasted source, it thought on the way to an answer, it answered in prose and
 * in a fenced block, it called a tool and the call was refused, it left
 * another call open, it changed a file, it changed the mode it runs under, it
 * produced an image, and it produced two things neither renderer names: a
 * content type the schema does not define, and a payload kind it does not
 * define either.
 */
const TRACE: readonly Event[] = [
  event({ kind: "started", intent: "read the trace back" }),
  event({ kind: "message", target: "next-run", content: { type: "text", text: PASTED } }),
  event({ kind: "thought", block: 0, content: { type: "text", text: "the sink holds it" } }),
  event(said(1, { type: "text", text: "here is what it holds" })),
  event(said(4, { type: "text", text: ANSWERED })),
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
  event({ kind: "mode", mode: "read-only", reason: "a person named it" }),
  event(said(2, { type: "image", data: "aGk=", mimeType: "image/png" })),
  event(said(3, { type: "audio", data: "aGk=", mimeType: "audio/wav" })),
  event({ kind: "unknown", originalKind: "acp/party_mode", raw: { confetti: true } }),
]

/**
 * The words a Block holds, line by line. A line is the unit because that is
 * what a reader loses one of: a renderer that closes up the line breaks, or
 * eats a line's leading characters, has rewritten what was said even though
 * every word is still somewhere on the page.
 *
 * A fence marker is punctuation and not words. The page draws a code block
 * where the marker was and the terminal draws the marker itself, and both are
 * right; what neither may drop is the code between them.
 */
const FENCE = /^\s*```/
const linesOf = (text: string): readonly string[] =>
  text.split("\n").filter((line) => line.trim() !== "" && !FENCE.test(line))

/**
 * What the record says about one Block, as the strings a renderer that draws
 * it would show. Neither renderer may name one that is not here, and the page
 * may not leave one out.
 */
const factsOf = (block: Block): readonly string[] => {
  switch (block.kind) {
    case "words":
    case "reasoning":
      return linesOf(block.text)
    case "tool":
      return [block.name, block.status]
    case "result":
      return [block.name, block.status, block.disposition]
    case "diff":
      return [block.path, String(block.hunks)]
    case "mode":
      return block.reason === undefined ? [block.mode] : [block.mode, block.reason]
    // The id an answer names, and the question. The id is the tool call's, so
    // a reader ties the question to the card the record drew for that call.
    case "permission":
      return [block.request, block.question]
    case "image":
      return [block.mimeType]
    case "unknown":
      return [block.originalKind]
  }
}

/**
 * A drawing as a reader reads it. The terminal's rows are already that; the
 * page's are markup, and a quotation mark a reader sees is `&quot;` in it. So
 * the entities are read back before the two are compared, and neither
 * renderer is credited with words it only escaped.
 */
const readable = (drawing: string): string =>
  drawing
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")

const namedIn = (drawing: string, block: Block): readonly string[] =>
  factsOf(block).filter((fact) => readable(drawing).includes(fact))

const record = foldTranscript(SESSION, TRACE)
const turns = blocksOf(record)

/**
 * The one question that stands, folded the way a surface folds one. It is not
 * on the record and it cannot be — nobody has answered it — so it is a second
 * source, and both renderers still take it as a Block.
 *
 * The request names the call the record left open, which is the whole reason
 * the id is the tool call's: the card the record drew for `t2` is the card
 * this question stands under.
 */
const asking = askingOf([{ request: "t2", question: "search wants to read outside the root" }])
const drawn = [...turns, ...asking]
const blocks = drawn.flatMap((turn) => turn.blocks)

/**
 * Who wrote a Block. Both renderers take it from the Turn — the page draws a
 * person's words as the characters they were pasted in and an agent's as
 * markdown — so a Block drawn on its own has to be given it back.
 */
const authorOf = (block: Block): ActorKind => {
  const turn = drawn.find((one) => one.blocks.includes(block))
  if (turn === undefined) throw new Error(`no Turn holds ${block.key}`)
  return turn.author
}

// The terminal reads the Messages it already holds and the page reads the
// Transcript it was handed. One fold, two ways into it.
const rows = toLines({ ...EMPTY, session: record.messages() })
const page = renderToStaticMarkup(<Turns turns={drawn} />)

// One Block as each renderer draws it: the terminal's rows for it, and the
// page's own element for it.
const rowsFor = (block: Block): string =>
  rows
    .filter((row) => row.key === block.key)
    .map((row) => row.text)
    .join(" ")

const cardFor = (block: Block): string =>
  renderToStaticMarkup(<BlockView author={authorOf(block)} block={block} />)

describe("one fold, two renderers", () => {
  // Two folds would disagree, and a person comparing the screen with the page
  // would find the disagreement. The two entries are the same fold.
  it("is one fold, whichever way a surface comes into it", () => {
    expect(turns).toEqual(blockFold(record.messages()))
  })

  it("folds this Trace to every member of the union, so both mappings run whole", () => {
    expect(blocks.map((block) => block.kind)).toEqual([
      "words",
      "words",
      "reasoning",
      "words",
      "words",
      "result",
      "tool",
      "diff",
      "mode",
      "image",
      "unknown",
      "unknown",
      "permission",
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
   * A drawing that is on the page and not on the screen is not on the page. A
   * browser leaves markup under `content-visibility` unlaid out and unread
   * until a reader happens to scroll onto it, so a Block drawn that way is a
   * blank box where the record was — and a Run's fenced answer went missing
   * exactly that way while every other clause here passed.
   */
  it.each(blocks)("and draws the $kind Block outright, holding none of it back", (block) => {
    expect(cardFor(block)).not.toContain("content-visibility")
  })

  /**
   * The terminal says less. What it says is the same, and that is the whole
   * of the claim being made here.
   */
  it.each(blocks)("the terminal says nothing about the $kind Block the page does not", (block) => {
    const named = [...namedIn(rowsFor(block), block)]
    expect(factsOf(block)).toEqual(expect.arrayContaining(named))
    expect(namedIn(cardFor(block), block)).toEqual(expect.arrayContaining(named))
  })

  /**
   * A row is a line of text and an image is not one, so the screen draws
   * fewer Blocks than the page. That is a renderer that renders less, and the
   * page is where the record stays whole.
   *
   * The permission Block is a different case. The terminal draws no row for it
   * and has no Overlay for it either — the Overlay's Intents are `command` and
   * `pick`, and the roadmap puts the permission one at C1. What it does today
   * is show the question as a Note and say `ASKING` on its status line, which
   * is not a Block and not held against the page's card. So this clause records
   * a shape one surface ignores, and not a second way of drawing it.
   */
  it("draws no row for the Blocks the terminal has none for, and the page draws them", () => {
    const undrawn = blocks.filter((block) => rowsFor(block) === "")

    expect(undrawn.map((block) => block.kind)).toEqual([
      "image",
      "unknown",
      "unknown",
      "permission",
    ])
    for (const block of undrawn) expect(namedIn(cardFor(block), block)).toEqual(factsOf(block))
  })

  /**
   * The degradation rule, at the one place the two renderers can be held
   * against it. Neither has a primitive for these Blocks; the terminal draws
   * nothing and the page says what it could not draw, so the record is on
   * one screen and missing from the other rather than lost from both.
   *
   * Both origins are here: a content type the schema does not define, and a
   * payload kind it does not define. The second only reaches a renderer
   * because the transcript fold keeps it, so this is where a fold that
   * dropped it would show.
   */
  it("says on the page what neither renderer can draw, rather than dropping it", () => {
    const found = blocks.filter((block) => block.kind === "unknown")
    expect(found.map((block) => block.originalKind)).toEqual(["audio", "acp/party_mode"])

    for (const block of found) {
      expect(rowsFor(block)).toBe("")
      expect(cardFor(block)).toContain("cannot draw")
      expect(cardFor(block)).toContain(block.originalKind)
    }
  })

  // A reader moving between the two screens reads one transcript, so the
  // Blocks the terminal draws come in the order the fold gave them.
  it("draws the Blocks it does draw in the order the fold gave them", () => {
    const keys = new Set(rows.map((row) => row.key))
    expect(rows.map((row) => row.key)).toEqual(
      blocks.map((block) => block.key).filter((key) => keys.has(key)),
    )
  })
})
