import { describe, expect, it } from "vitest"
import { NO_TITLE, titleLine } from "./title.js"

/**
 * A Session's title is the intent a Run opened on, and an intent is a whole
 * prompt. `headerFold` is right to keep all of it — the record is the record —
 * so the shaping happens here, where a heading is drawn.
 */
describe("what to call a Session", () => {
  it("says a short title as it was written", () => {
    expect(titleLine("read the trace back over HTTP")).toBe("read the trace back over HTTP")
  })

  // A prompt is many lines and a heading is one, so the rest is behind the
  // ellipsis rather than down the page.
  it("takes the first line of a prompt, and says there is more", () => {
    expect(titleLine("rebuild the Session page\n\non Tailwind, with AI Elements")).toBe(
      "rebuild the Session page…",
    )
  })

  // A prompt pasted in often opens on a blank line, and a heading of nothing
  // names nothing.
  it("skips the blank lines a pasted prompt opens on", () => {
    expect(titleLine("\n\n  the first thing it says")).toBe("the first thing it says")
  })

  it("cuts a long line at a word, rather than through one", () => {
    const long = "the quick brown fox jumps over the lazy dog and keeps going well past the line"
    const shaped = titleLine(`${long} until it stops`)

    expect(shaped.endsWith("…")).toBe(true)
    expect(shaped.length).toBeLessThanOrEqual(65)
    expect(long.startsWith(shaped.slice(0, -1))).toBe(true)
    expect(shaped).not.toContain("jum…")
  })

  // One word longer than the whole allowance has no word to cut at. It is cut
  // where it runs out, because a heading that ran on would be the wall of text
  // this exists to stop.
  it("cuts a single long word where it runs out", () => {
    expect(titleLine("x".repeat(200))).toBe(`${"x".repeat(64)}…`)
  })

  /**
   * A Session that has heard nothing has no title, and one whose title is
   * whitespace has nothing to say either. Both are named rather than left
   * blank: a Session a person cannot see is one they cannot open.
   */
  it.each([undefined, "", "   \n \n"])("names a Session with no title to give: %o", (title) => {
    expect(titleLine(title)).toBe(NO_TITLE)
  })
})
