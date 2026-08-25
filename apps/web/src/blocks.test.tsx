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
