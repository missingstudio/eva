import { blockFold, type Block, type Turn } from "@missingstudio/eva-session-view"
import type { TranscriptMessage } from "@missingstudio/eva-schema"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BlockView, hunkText, Turns } from "./blocks.js"

/**
 * Rendered to a string rather than into a document, because a browser is what
 * the served page is proven against — `plugins/web` opens a socket for that,
 * and `packages/conformance` holds this mapping against the terminal's.
 */
const drawn = (block: Block): string => renderToStaticMarkup(<BlockView block={block} />)

const words = (text: string): string => drawn({ kind: "words", key: "0.0", text })

// Every kind of block one Message can hold, folded by the one fold. The
// fixture is the record rather than the Blocks, so what is drawn here is
// what a Session really produces.
const RECORD: TranscriptMessage["blocks"] = [
  { type: "content", block: 0, content: { type: "text", text: "the answer" } },
  { type: "thought", block: 1, content: { type: "text", text: "on the way to it" } },
  { type: "tool", id: "t1", name: "read", tool: "read", status: "in_progress" },
  {
    type: "tool",
    id: "t2",
    name: "write",
    tool: "edit",
    status: "failed",
    disposition: "denied",
  },
  { type: "edit", path: "docs/summary.md", hunks: 3 },
  { type: "content", block: 2, content: { type: "image", data: "aGk=", mimeType: "image/png" } },
  { type: "content", block: 3, content: { type: "audio", data: "aGk=", mimeType: "audio/wav" } },
]

const folded = (blocks: TranscriptMessage["blocks"]): readonly Turn[] =>
  blockFold([{ author: "agent", blocks }])

const blocks = (): readonly Block[] => folded(RECORD).flatMap((turn) => turn.blocks)

const at = (kind: Block["kind"]): Block => {
  const found = blocks().find((one) => one.kind === kind)
  if (found === undefined) throw new Error(`the fold gave back no ${kind}`)
  return found
}

describe("one Block, in page primitives", () => {
  it("draws what was said, and what was thought apart from it", () => {
    expect(drawn(at("words"))).toContain("the answer")
    expect(drawn(at("reasoning"))).toContain("on the way to it")
  })

  // A call that is open says where it is in its life and nothing about how it
  // ended, because it has not.
  /**
   * A Run says markdown. It writes tables and links and fenced code, and a
   * page that drew the source would be showing a reader the pipe rather than
   * the answer.
   */
  it("renders what was said as markdown, rather than as its source", () => {
    const markup = words(
      "| file | why |\n| --- | --- |\n| one.ts | it changed |\n\nand **so** it did",
    )

    expect(markup).toContain("<table")
    expect(markup).toContain("<td")
    expect(markup).not.toContain("| --- |")
    expect(markup).not.toContain("**so**")
  })

  /**
   * A fenced block is where the answer usually is — a JSON answer, a patch, a
   * command to run — and it is the one construct that can be drawn by a
   * renderer that is not there. So the code is on the page as its own
   * characters, in a `pre`, with the lines it was written in.
   */
  it("draws a fenced code block as code, with its lines kept", () => {
    const markup = words('```json\n[\n  { "file": "merge.ts" }\n]\n```')

    expect(markup).toContain("<pre")
    expect(markup).toContain("&quot;file&quot;: &quot;merge.ts&quot;")
    expect(markup).toContain("[\n  { &quot;file&quot;: &quot;merge.ts&quot; }\n]")
    expect(markup).toContain("json")
  })

  it("draws a fence that names no language, which is a fence all the same", () => {
    expect(words("```\nbun run verify\n```")).toContain("bun run verify")
  })

  it("draws a language it has no renderer for as the code it is", () => {
    expect(words("```mermaid\ngraph TD;\n```")).toContain("graph TD;")
  })

  it("draws an open call with its Tool Status", () => {
    const markup = drawn(at("tool"))
    expect(markup).toContain("read")
    expect(markup).toContain("in_progress")
  })

  /**
   * A Tool Status and a Disposition are both drawn, because neither replaces
   * the other. A status alone reads as a call that worked, and `denied` is
   * not that.
   */
  it("draws an answered call with its Tool Status and its Disposition", () => {
    const markup = drawn(at("result"))
    expect(markup).toContain("write")
    expect(markup).toContain("failed")
    expect(markup).toContain("denied")
  })

  // The path and the count of hunks, which is the whole of what the record
  // holds. No rendering of a diff reaches this page from the server.
  it("draws a diff from the record's own fields", () => {
    const markup = drawn(at("diff"))
    expect(markup).toContain("docs/summary.md")
    expect(markup).toContain("3 hunks")
  })

  it("draws an image as an image, from the bytes the record holds", () => {
    expect(drawn(at("image"))).toContain('src="data:image/png;base64,aGk="')
  })

  /**
   * The degradation rule, pointed at this renderer. A Surface may render less
   * than another; it may never know more. So a Block with no primitive here
   * says what it was and that it could not be drawn, rather than leaving a
   * hole a reader would take for nothing having happened.
   */
  it("draws a Block it cannot draw as one it could not draw", () => {
    const markup = drawn(at("unknown"))
    expect(markup).toContain("cannot draw")
    expect(markup).toContain("audio")
  })
})

/**
 * The whole rule, over every construct a Run can write. A renderer that has
 * no primitive for one of them draws less; a renderer that draws nothing at
 * all for one of them has dropped the answer, and a reader has no way to know
 * an answer was there. So each construct is asked for the words inside it.
 */
describe("what a Run writes, and what a reader gets", () => {
  it.each([
    ["a heading", "## a heading", "a heading"],
    ["a bullet list", "- alpha\n- beta", "alpha"],
    ["an ordered list", "1. alpha\n2. beta", "beta"],
    ["a table", "| a | b |\n| - | - |\n| one | two |", "one"],
    ["a block quote", "> quoted words", "quoted words"],
    ["a horizontal rule", "before\n\n---\n\nafter", "<hr"],
    ["an image", "![alt words](https://example.com/one.png)", "alt words"],
    ["a link", "[label](https://example.com)", "label"],
    ["inline code", "a `chip` here", "chip"],
    ["a fenced block", '```json\n{ "file": "x" }\n```', "file"],
    ["an indented block", "    indented code", "indented code"],
    ["inline html", "<em>emphasis</em>", "emphasis"],
    ["a strikethrough", "~~gone~~", "gone"],
    ["a task list", "- [x] done thing", "done thing"],
    ["a footnote", "text[^1]\n\n[^1]: the note", "the note"],
  ])("draws %s, rather than nothing", (_construct, source, said) => {
    expect(words(source)).toContain(said)
  })
})

describe("one Session's Turns", () => {
  it("drops no Block: every one the fold gives back is on the page", () => {
    const markup = renderToStaticMarkup(<Turns turns={folded(RECORD)} />)
    for (const block of blocks()) expect(markup).toContain(drawn(block))
  })

  it("says who spoke, once per Turn", () => {
    const markup = renderToStaticMarkup(
      <Turns
        turns={blockFold([
          { author: "human", blocks: RECORD.slice(0, 1) },
          { author: "agent", blocks: RECORD.slice(0, 1) },
        ])}
      />,
    )

    expect(markup).toContain("human")
    expect(markup).toContain("agent")
  })

  // A Session that folds to nothing and one whose fold has not arrived are
  // two different things.
  it("says the Session has said nothing, rather than looking like it is reading", () => {
    const markup = renderToStaticMarkup(<Turns turns={[]} />)
    expect(markup).toContain("said nothing yet")
    expect(markup).not.toContain("Reading")
  })
})

describe("the count of hunks", () => {
  it("counts one hunk as one, and the rest as hunks", () => {
    expect(hunkText(1)).toBe("1 hunk")
    expect(hunkText(3)).toBe("3 hunks")
    expect(hunkText(0)).toBe("0 hunks")
  })
})
