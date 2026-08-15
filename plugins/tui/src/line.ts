import type { Keymap, KeyPress } from "@missingstudio/eva-tui-core"

/**
 * The line as the editor holds it: what was typed, and where the caret
 * sits. The caret counts code points, the same unit every edit below moves
 * in, so an astral character is one step to cross and one to remove.
 */
export interface LineState {
  readonly buffer: string
  readonly cursor: number
}

export const BLANK: LineState = { buffer: "", cursor: 0 }

export type LineAction =
  | { readonly kind: "editing"; readonly line: LineState }
  // The caret left the line for the prompt history. The Console owns the
  // history, so the editor only says which way to walk.
  | { readonly kind: "history"; readonly direction: "back" | "forward" }
  // Step back: what that means depends on what is open, and the Console
  // decides it. The editor only reports the press.
  | { readonly kind: "back" }
  // Open the panel over every command there is.
  | { readonly kind: "palette" }
  | { readonly kind: "submit"; readonly line: string }
  | { readonly kind: "cancel" }
  | { readonly kind: "quit" }

const held = (line: LineState): LineAction => ({ kind: "editing", line })

const at = (line: LineState, buffer: readonly string[], cursor: number): LineAction =>
  held({ buffer: line.buffer, cursor: Math.max(0, Math.min(buffer.length, cursor)) })

const spliced = (buffer: readonly string[], from: number, to: number, text = ""): string =>
  buffer.slice(0, from).join("") + text + buffer.slice(to).join("")

/**
 * A pasted block, put where the caret is. It is text and nothing else: a
 * newline inside it is a newline rather than the key that would submit the
 * line, because the terminal said this arrived as a paste.
 *
 * Every line ending becomes the one this buffer counts in, so a paste from
 * another machine does not leave carriage returns in the prompt.
 */
export const pasted = (line: LineState, text: string): LineState => {
  const buffer = Array.from(line.buffer)
  const cursor = Math.max(0, Math.min(buffer.length, line.cursor))
  const put = Array.from(text.replace(/\r\n?/g, "\n"))
  return {
    buffer: spliced(buffer, cursor, cursor, put.join("")),
    cursor: cursor + put.length,
  }
}

/**
 * Where the caret stands in the line's rows: which row, how far in, and
 * where that row starts and ends in the whole buffer. Rows are what up and
 * down move across and what home and end bound, so all four read this.
 */
const rowOf = (buffer: readonly string[], cursor: number) => {
  let start = 0
  let row = 0
  for (let index = 0; index < cursor; index += 1) {
    if (buffer[index] === "\n") {
      start = index + 1
      row += 1
    }
  }
  let end = start
  while (end < buffer.length && buffer[end] !== "\n") end += 1
  return { row, start, end, column: cursor - start }
}

// The same row arithmetic, asked for the row above or below: where it
// starts, and where a caret this far into it lands.
const rowStep = (buffer: readonly string[], cursor: number, by: 1 | -1): number | undefined => {
  const here = rowOf(buffer, cursor)
  if (by === -1 && here.row === 0) return undefined
  const start = by === -1 ? rowOf(buffer, here.start - 1).start : here.end + 1
  if (start > buffer.length) return undefined
  const target = rowOf(buffer, start)
  return target.start + Math.min(here.column, target.end - target.start)
}

/**
 * One key against the line. The keymap alone decides what a chord means —
 * rebind `session.submit` and plain enter is released with it. What stays
 * outside the keymap is what a line is made of: a typed character, the keys
 * that add or remove one, and the keys that move the caret through what is
 * already there. Enter on an empty line does nothing, so a stray return
 * never opens a Run with no prompt.
 *
 * `recalling` says the line under the caret came from the history, so up
 * and down keep walking it instead of moving through the line's rows.
 */
export const edit = (
  line: LineState,
  key: KeyPress,
  keymap: Keymap,
  recalling = false,
): LineAction => {
  const buffer = Array.from(line.buffer)
  const cursor = Math.max(0, Math.min(buffer.length, line.cursor))
  const put = (text: string): LineAction =>
    held({
      buffer: spliced(buffer, cursor, cursor, text),
      cursor: cursor + Array.from(text).length,
    })

  const submit = (): LineAction => {
    const trimmed = line.buffer.trim()
    return trimmed === "" ? held(line) : { kind: "submit", line: trimmed }
  }

  switch (keymap.lookup(key)) {
    case "session.cancel":
      return { kind: "cancel" }
    case "app.quit":
      return { kind: "quit" }
    case "session.submit":
      return submit()
    case "input.newline":
      return put("\n")
    case "surface.back":
      return { kind: "back" }
    case "surface.palette":
      return { kind: "palette" }
    default:
      break
  }

  // The press says whether it carries a character; this never asks a string
  // for its length, which would break every astral character in two.
  if (key.glyph) return put(key.key)
  if (key.key === "space" && !key.ctrl && !key.meta) return put(" ")

  // Removal takes one character rather than one unit, so an astral
  // character leaves whole rather than leaving half of itself behind.
  if (key.key === "backspace") {
    return cursor === 0
      ? held(line)
      : held({ buffer: spliced(buffer, cursor - 1, cursor), cursor: cursor - 1 })
  }
  if (key.key === "delete") {
    return cursor === buffer.length
      ? held(line)
      : held({ buffer: spliced(buffer, cursor, cursor + 1), cursor })
  }

  if (key.key === "left") return at(line, buffer, cursor - 1)
  if (key.key === "right") return at(line, buffer, cursor + 1)

  // Home and end bound the row the caret is on, and the two emacs chords
  // mean the same when nothing in the keymap claimed them first.
  const bounds = () => rowOf(buffer, cursor)
  if (key.key === "home" || (key.ctrl && key.key === "a")) return at(line, buffer, bounds().start)
  if (key.key === "end" || (key.ctrl && key.key === "e")) return at(line, buffer, bounds().end)

  if (key.key === "up" || key.key === "down") {
    const direction = key.key === "up" ? "back" : "forward"
    // A history walk keeps walking; an empty line starts one. A line with
    // rows is moved through instead, because the text under the caret is
    // the person's and the history must not overwrite it.
    if (recalling) return { kind: "history", direction }
    if (line.buffer === "")
      return direction === "back" ? { kind: "history", direction } : held(line)
    const stepped = rowStep(buffer, cursor, key.key === "up" ? -1 : 1)
    return stepped === undefined ? held(line) : at(line, buffer, stepped)
  }

  // Every other named key is one this editor has no use for — function
  // keys, page moves, chords nothing bound.
  return held(line)
}

/**
 * What the loop acts on. `editing`, `history` and `back` never leave the
 * key handler: the first two change the line, and the third is answered
 * from what is open — which only the surface holding the Console knows.
 */
export type LineCommand = Exclude<
  LineAction,
  | { readonly kind: "editing" }
  | { readonly kind: "history" }
  | { readonly kind: "back" }
  | { readonly kind: "palette" }
>
