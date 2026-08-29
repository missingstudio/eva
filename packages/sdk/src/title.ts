/**
 * What to call a Session, in one line.
 *
 * A Session's title is the intent the first Run opened on, until an `info`
 * gives a better one. An intent is a prompt, and a prompt is often a page of
 * text: `headerFold` is right to keep the whole of it, and a heading is the
 * wrong place to draw the whole of it. So the heading is the first line the
 * prompt has, cut at a word if that line is still long, and the record's own
 * text goes on the element for a reader who wants it.
 *
 * The ellipsis is the promise being kept: a title a reader sees in full has
 * none, and one that is short here says so.
 */
export const NO_TITLE = "no title yet"

const LIMIT = 64
const ELLIPSIS = "…"

// The first line that says something. A prompt pasted in often opens on a
// blank line, and a heading of nothing names nothing.
const firstLine = (title: string): readonly [string, boolean] => {
  const lines = title.split("\n").map((line) => line.trim())
  const at = lines.findIndex((line) => line !== "")
  if (at === -1) return ["", false]
  return [lines[at] ?? "", lines.slice(at + 1).some((line) => line !== "")]
}

// Cut at the last word that fits, so a heading never ends mid-word. A first
// word longer than the whole allowance has no word to cut at, and is cut
// where it runs out.
const cut = (line: string): string => {
  if (line.length <= LIMIT) return line
  const at = line.lastIndexOf(" ", LIMIT)
  return `${line.slice(0, at === -1 ? LIMIT : at).trimEnd()}${ELLIPSIS}`
}

export const titleLine = (title: string | undefined): string => {
  if (title === undefined) return NO_TITLE
  const [line, more] = firstLine(title)
  if (line === "") return NO_TITLE
  const shown = cut(line)
  return more && !shown.endsWith(ELLIPSIS) ? `${shown}${ELLIPSIS}` : shown
}
