import type { KeyPress } from "@missingstudio/eva-tui-core"

// The raw key shape readline and OpenTUI both report.
export interface RawKey {
  readonly name?: string
  readonly ctrl?: boolean
  readonly shift?: boolean
  readonly meta?: boolean
  readonly sequence?: string
}

/**
 * One character a person typed, counted in code points so an astral
 * character is one and not the two units that spell it. A control byte, a
 * word like "space", and an empty string are all not one.
 */
const printable = (text: string): boolean => {
  if (Array.from(text).length !== 1) return false
  const code = text.codePointAt(0) ?? 0
  return code > 32 && code !== 127
}

/**
 * A letter arrives twice: `name` says which key it is, always lowercase, and
 * `sequence` says what was typed — "A" for shift+a, and under caps lock. The
 * buffer wants what was typed and a chord wants which key, so the typed
 * glyph wins only when it is one printable character with no chord modifier
 * held; everything else keeps its name.
 *
 * This is the one place that decides which of the two a press is. The
 * `glyph` half of a KeyPress carries the answer, so nothing downstream has
 * to work it out again from a string's length.
 */
export const toKeyPress = (key: RawKey | undefined, value = ""): KeyPress => {
  const chord = key?.ctrl === true || key?.meta === true
  const sequence = key?.sequence
  const typed = !chord && sequence !== undefined && printable(sequence) ? sequence : undefined
  const resolved = typed ?? key?.name ?? sequence ?? value
  return {
    key: resolved,
    // Nothing named the key and one printable character arrived, so it is
    // what somebody typed.
    glyph: typed !== undefined || (!chord && key?.name === undefined && printable(resolved)),
    ctrl: key?.ctrl === true,
    shift: key?.shift === true,
    meta: key?.meta === true,
  }
}
