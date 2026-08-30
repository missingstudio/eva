import { emitKeypressEvents } from "node:readline"
import { overlayLines, type Frame, type KeyPress, type Renderer } from "@missingstudio/eva-tui-core"
import { bannerRows, promptLine, statusLine, toGroups, toLines } from "./frame.js"
import { toKeyPress, type RawKey } from "./keys.js"

export interface Terminal {
  readonly out: NodeJS.WritableStream & { columns?: number; rows?: number; isTTY?: boolean }
  readonly in: NodeJS.ReadStream
}

const CSI = "["

export const CLEAR = `${CSI}2J${CSI}H`

// A repaint goes back to the corner and writes over what is there, clearing
// each line as it passes and everything below when it ends. Erasing the
// screen first would blank it between two frames, which is the flicker a
// person sees on every streamed word.
export const HOME = `${CSI}H`
const ERASE_LINE = `${CSI}K`
const ERASE_BELOW = `${CSI}J`

export const repaint = (rows: readonly string[]): string =>
  `${HOME}${rows.map((row) => `${row}${ERASE_LINE}`).join("\n")}\n${ERASE_BELOW}`

// Bracketed paste: the terminal wraps pasted text in markers, so a paste can
// be told from typing. It is asked for on a screen and given back on stop.
export const BRACKETED_ON = `${CSI}?2004h`
export const BRACKETED_OFF = `${CSI}?2004l`

// The conversation: the record's lines, with what each Run took. A pipe
// carries this and the surface's own words — the chrome is for a screen.
const conversation = (frame: Frame): string[] =>
  toLines(frame).map((line) => (line.kind === "tool" ? `  ${line.text}` : line.text))

// How many of those lines stand after the turns themselves: the line that
// says what a Run took. A stream printed the turn it became, and it never
// printed this, so the two are counted apart.
const trailing = (frame: Frame): number =>
  toGroups(frame).filter((group) => group.note !== "").length

const lines = (frame: Frame): string[] => {
  const out = bannerRows(frame).map(({ label, value }) => `${label}${value}`)
  out.push(...conversation(frame))
  out.push(...frame.notes)
  if (frame.live !== "") out.push(frame.live)
  out.push(statusLine(frame))
  // The panel stands over the line it belongs to, in the one spelling the
  // contract ships. A screen is repainted whole, so it needs no geometry of
  // its own to put it there.
  if (frame.overlay !== undefined) out.push(...overlayLines(frame.overlay))
  out.push(promptLine(frame))
  return out
}

/**
 * The renderer of last resort: over the streams the process already has,
 * with no dependency and no FFI. It is what runs where OpenTUI cannot.
 *
 * A screen is repainted whole, because the cursor can go back. A pipe
 * cannot, so there it appends only what is new — repainting a pipe would
 * write the frame again on every keystroke.
 */
export const makeStreamRenderer = (
  terminal: Terminal = { out: process.stdout, in: process.stdin },
): Renderer => {
  const handlers = new Set<(key: KeyPress) => void>()
  const ends = new Set<() => void>()
  const pastes = new Set<(text: string) => void>()
  const deliver = (press: KeyPress) => {
    for (const handler of handlers) handler(press)
  }
  const screen = terminal.out.isTTY === true
  let stopped = false
  let shown = 0
  let told = 0
  let streamed = ""
  // What the screen already holds, so a draw that would write it again
  // writes nothing at all.
  let painted = ""
  // What a paste has collected so far, and nothing when none is open. The
  // characters between the markers are text rather than presses, so they are
  // gathered here instead of being delivered.
  let pasting: string | undefined

  /**
   * A press, or one character of a paste. readline marks a bracketed paste
   * with `paste-start` and `paste-end`, so the terminal itself is what tells
   * typing from pasting — and a newline that arrives between the two is text
   * rather than the key that would submit it.
   */
  const onKeypress = (value: string, key: RawKey | undefined) => {
    if (key?.name === "paste-start") {
      pasting = ""
      return
    }
    if (key?.name === "paste-end") {
      const text = pasting ?? ""
      pasting = undefined
      if (text !== "") for (const handler of pastes) handler(text)
      return
    }
    if (pasting !== undefined) {
      pasting += key?.sequence ?? value
      return
    }
    deliver(toKeyPress(key, value))
  }
  const onEnded = () => {
    for (const handler of ends) handler()
  }

  emitKeypressEvents(terminal.in)
  if (terminal.in.isTTY) terminal.in.setRawMode(true)
  // Asked of the screen, because that is what answers it, and given back on
  // the same condition. A terminal that does not answer keeps delivering a
  // paste one press at a time, which is what it did before: the degrade is
  // the one this renderer already is, less rather than wrong.
  if (screen) terminal.out.write(BRACKETED_ON)

  terminal.in.on("keypress", onKeypress)
  // End of input is said in the renderer's own word, never as a key press —
  // a minted key means whatever the keymap says, and a rebinding would leave
  // the surface waiting on input that has already ended.
  terminal.in.on("end", onEnded)

  // What a pipe has already been told, per list. The two counts are kept
  // apart so a fold that grows the conversation never writes a note again.
  const writeNew = (all: readonly string[], already: number): number => {
    for (const line of all.slice(already)) terminal.out.write(`${line}\n`)
    return all.length
  }

  // The stream first, then the fold that replaces it. Marking the transcript
  // as shown at that point is what stops an answer printing twice.
  const append = (frame: Frame) => {
    // A cleared list is a list that starts again, so the count goes back
    // with it rather than swallowing everything written next.
    if (frame.notes.length < told) told = 0
    told = writeNew(frame.notes, told)

    if (frame.live !== "") {
      const delta = frame.live.startsWith(streamed) ? frame.live.slice(streamed.length) : frame.live
      streamed = frame.live
      if (delta !== "") terminal.out.write(delta)
      return
    }

    const all = conversation(frame)
    // The conversation is counted the way the notes are: a fold that got
    // shorter is a list that starts again, and a count that only grows
    // would swallow every line of it.
    if (all.length < shown) shown = 0

    if (streamed !== "") {
      streamed = ""
      terminal.out.write("\n")
      // The stream printed the turn it became, so the fold does not write
      // that turn a second time. What stands after it was never written.
      shown = Math.max(shown, all.length - trailing(frame))
    }
    shown = writeNew(all, shown)
  }

  return {
    draw: (frame) => {
      // A frame drawn after stop is nobody's: the terminal has been handed
      // back, and writing to it would print over whatever has it now.
      if (stopped) return
      if (!screen) return append(frame)

      // A screen that says the same thing is a screen that needs no writing.
      // Every event is drawn, and most of them change nothing a person sees.
      const next = repaint(lines(frame))
      if (next === painted) return
      painted = next
      terminal.out.write(next)
    },
    // A screen is repainted whole, so a panel can stand over the line. A
    // pipe appends, and a panel it drew could never be taken back. Neither
    // writes a color: this is the renderer of last resort.
    draws: { panels: screen, colors: false },
    onKey: (handler) => {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
    onPaste: (handler) => {
      pastes.add(handler)
      return () => void pastes.delete(handler)
    },
    onEnd: (handler) => {
      ends.add(handler)
      return () => void ends.delete(handler)
    },
    // Safe to repeat, and it releases everything this renderer took: the
    // listeners it put on the input, the raw mode it asked for, and the
    // bracketed paste it turned on. A surface is started and stopped and
    // started again.
    stop: () => {
      if (stopped) return
      stopped = true
      terminal.in.removeListener("keypress", onKeypress)
      terminal.in.removeListener("end", onEnded)
      handlers.clear()
      ends.clear()
      pastes.clear()
      pasting = undefined
      if (terminal.in.isTTY) terminal.in.setRawMode(false)
      if (screen) terminal.out.write(BRACKETED_OFF)
    },
  }
}
