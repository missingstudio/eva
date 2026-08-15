import { toUsd, type Spend, type TranscriptMessage } from "@missingstudio/eva-schema"
import type { KeyPress } from "./keys.js"
import type { ThemeColors } from "./theme.js"

/**
 * What the terminal shows, and where each part comes from. The session pane
 * is the fold; the live area is the stream; the two are never the same
 * source, and the fold replaces the stream when a Run closes.
 *
 * `session`, `live` and `notes` are the conversation; the rest — banner,
 * input, took, work, status — is chrome. A renderer that cannot show chrome
 * (a pipe) shows the conversation and is still honouring the Frame.
 */
export interface Frame {
  readonly banner: Banner
  /**
   * The fold of the record, and nothing else. Nothing a surface says of its
   * own reaches here — a line the record cannot rebuild is not the record,
   * and a pipe that writes this writes what a Run actually said.
   */
  readonly session: readonly TranscriptMessage[]
  /**
   * What this surface said of its own: command output, a notice, a question
   * Eva asked. They are the surface's words rather than the record's, so
   * they stand after the conversation and last until it moves on — a Run
   * opens, or the surface follows another Session.
   */
  readonly notes: readonly string[]
  /**
   * The Live area: what the open Run has streamed so far. Within one Run it
   * only ever grows by append, and it returns to "" exactly when the stream
   * is over — the fold has replaced it in `session`, or the Run was
   * cancelled. A renderer that appends (a pipe cannot go back) leans on both
   * halves of that.
   */
  readonly live: string
  // What the person has typed so far. The surface holds it; the renderer
  // only draws it, so a redraw never loses a half-written line.
  readonly input: string
  // Where the caret sits in `input`, counted in code points. The surface
  // moves it; a renderer only draws it where it is told, so two renderers
  // cannot disagree about where typing lands.
  readonly cursor: number
  // How long the last closed Run took. Empty until one closes.
  readonly took: string
  readonly work: Work
  readonly status: StatusLine
  /**
   * The one overlay, when one is open. Chrome: a renderer that cannot draw
   * a panel (a pipe) ignores it and is still honouring the Frame, because
   * the surface never puts an answer only here — what a panel decides is
   * echoed as a note.
   */
  readonly overlay?: Overlay
  // The colors the surface chose. Absent keeps the renderer's default, so a
  // renderer built where no theme Domain exists still draws.
  readonly theme?: ThemeColors
}

/**
 * One selection panel with one physics, whatever fills it: type to filter,
 * up and down to move, enter to take, esc to keep what you had. `source`
 * says where typing lands — a palette owns its `query`; slash completion
 * follows the input line, so its query is the buffer and typing stays
 * there.
 */
export interface Overlay {
  readonly title: string
  readonly source: "query" | "buffer"
  readonly query: string
  readonly rows: readonly OverlayRow[]
  readonly selected: number
  readonly hint: string
}

export interface OverlayRow {
  readonly id: string
  readonly label: string
  readonly detail: string
}

/**
 * What an open Run looks like while it is open. The surface owns the clock,
 * so it says how long and how often; the renderer owns the characters, so it
 * says what a turn of the spinner and a caption look like.
 */
export interface Work {
  readonly running: boolean
  readonly elapsed: string
  // Turns of the clock since the Run opened. The spinner and the caption are
  // both read off it, so both renderers animate in step.
  readonly tick: number
  // What pressing esc would do next, when that needs saying — "esc again to
  // interrupt" while an interrupt is armed. Empty otherwise, and every
  // renderer says the same words because the surface chose them.
  readonly hint: string
}

// What the screen says about this build and where it runs. None of it is in
// the record, because none of it is something a Run said.
export interface Banner {
  readonly version: string
  readonly model: string
  readonly branch: string
  readonly directory: string
}

export interface StatusLine {
  readonly model: string
  readonly tokens: string
  readonly cost: string
  readonly mode: string
}

/**
 * What the surface draws through. A renderer owns the terminal, so it owns
 * the keyboard too: splitting output and input across two objects would
 * give a rich renderer no way to claim the keys it already handles.
 *
 * The input line is the renderer's to draw but the surface's to hold, so
 * the surface passes it down and gets key presses back.
 *
 * Every adapter holds to the same three rules, whatever it draws on:
 * `stop` is safe to repeat, it releases every subscription the renderer
 * took — keys, pastes and the end of input alike — and a `draw` after it
 * does nothing. A surface is started and stopped and started again, so a
 * renderer that keeps a listener past its own `stop` delivers keys to a
 * surface that has gone.
 */
export interface Renderer {
  readonly draw: (frame: Frame) => void
  /**
   * What this renderer draws beyond the conversation. A surface asks before
   * it offers a capability that rests on one: a pipe that was offered a
   * panel would open a choice nobody can answer and wait on it forever, and
   * a renderer with no colors would report a theme it never painted.
   */
  readonly draws: Draws
  readonly onKey: (handler: (key: KeyPress) => void) => () => void
  /**
   * A block of text arrived at once: a paste. It is the Renderer's own word
   * beside `onEnd`, because the terminal is what knows a paste from typing —
   * it never reaches the keymap, so a newline inside one is text and never a
   * submit, and no rebinding can change what a pasted character means.
   */
  readonly onPaste: (handler: (text: string) => void) => () => void
  /**
   * The input has ended: a pipe closed, and no key can ever arrive. It is
   * the Renderer's own word, never a key press — a screen's input does not
   * end, and what a press means belongs to the keymap. The surface reads it
   * as a request to stop.
   */
  readonly onEnd: (handler: () => void) => () => void
  readonly stop: () => void
}

/**
 * What a renderer can draw of the chrome. Both are facts about the terminal
 * this renderer holds rather than about the Frame, so the Frame carries
 * neither: a Frame is the same Frame whoever draws it.
 */
export interface Draws {
  // A panel over the fold. A pipe cannot go back, so it draws none.
  readonly panels: boolean
  // Colors at all. The renderer of last resort writes plain lines.
  readonly colors: boolean
}

/**
 * What a renderer factory hands back: the Renderer, and what was decided
 * quietly on the way to it — a rich renderer that failed to start, a theme
 * with nothing to paint it. A surface shows the notices where the person is
 * looking, because a renderer dropped in silence reads as a renderer chosen.
 */
export interface ChosenRenderer {
  readonly renderer: Renderer
  readonly notices: readonly string[]
}

// The Frame with nothing in it. The type ships with its one empty spelling,
// so a store, a test, and a surface all start from the same fields.
export const EMPTY: Frame = {
  banner: { version: "", model: "", branch: "", directory: "" },
  session: [],
  notes: [],
  live: "",
  input: "",
  cursor: 0,
  took: "",
  work: { running: false, elapsed: "", tick: 0, hint: "" },
  status: { model: "", tokens: "", cost: "", mode: "" },
}

/**
 * The overlay as lines, one spelling for every renderer that draws in rows.
 * A `buffer` panel says no query line — typing lands in the input line,
 * which the renderer already draws, and the same text twice reads as two
 * different texts.
 */
export const overlayLines = (overlay: Overlay): readonly string[] => [
  `── ${overlay.title} ──`,
  ...(overlay.source === "query" ? [`› ${overlay.query}`] : []),
  ...overlay.rows.map((row, at) => {
    const marker = at === overlay.selected ? "▸" : " "
    return `${marker} ${row.label}${row.detail === "" ? "" : `  ${row.detail}`}`
  }),
  `── ${overlay.hint} ──`,
]

// A counter nothing reported is not zero, so it is left unsaid.
export const tokenLine = (input: number | null, output: number | null): string =>
  [input === null ? "" : `${input} in`, output === null ? "" : `${output} out`]
    .filter((part) => part !== "")
    .join(" / ")

export const seconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`

// How long the last closed Run took, phrased once for every renderer.
export const tookText = (milliseconds: number): string => `took ${seconds(milliseconds)}`

// The status bar is narrow, so it marks an estimate with `~` and spends no
// words on it. A Session that has not run says nothing, and the row is left
// out rather than drawn empty.
export const costText = (spend: Spend): string => {
  switch (spend.kind) {
    case "none":
      return ""
    case "reported":
      return `$${toUsd(spend.ticks).toFixed(4)}`
    case "estimated":
      return `~$${toUsd(spend.ticks).toFixed(4)}`
    case "unreported":
      return "cost unreported"
  }
}
