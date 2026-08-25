import {
  spendOf,
  type CostSummary,
  type Payload,
  type SessionID,
  type TranscriptMessage,
} from "@missingstudio/eva-schema"
import {
  costText,
  seconds,
  tokenLine,
  tookText,
  type Frame,
  type Overlay,
  type ThemeColors,
  type Work,
} from "@missingstudio/eva-tui-core"
import { refiltered, stepped as moved, type OpenOverlay } from "./overlay.js"

/**
 * The Console's state and the rules it changes by. Everything the screen
 * shows is a fold over these events, so every rule of the screen is a case
 * here — pure, and tested without a renderer, a Session API, or a clock.
 * The surface carries events in and frames out, and holds nothing of its
 * own.
 */
export interface ConsoleState {
  readonly session: SessionID
  // What the person has typed so far. The line editor changes it; a redraw
  // never loses it.
  readonly buffer: string
  // Where the caret sits in the buffer, counted in code points.
  readonly cursor: number
  /**
   * Every line submitted, oldest first, consecutive duplicates stored once.
   * `recall` is where a history walk stands — an index into `history`, and
   * absent when the person is not walking it. An edit to the buffer ends
   * the walk; moving the caret through a recalled line does not.
   */
  readonly history: readonly string[]
  readonly recall?: number
  // A question is open, and the next line answers it rather than opening a
  // Run.
  readonly asking: boolean
  /**
   * Esc has been pressed once against an open Run, so the next one
   * interrupts it. It decays on any other key: an interrupt is never
   * something a person arrives at by forgetting they armed it.
   */
  readonly armed: boolean
  // The one panel, when one is open. At most one, because a panel over a
  // panel is a screen to get lost in.
  readonly overlay?: OpenOverlay
  /**
   * Completion was dismissed for the line as it stands. The next edit
   * lifts it: dismissing is about this line, not about completion.
   */
  readonly hushed: boolean
  /**
   * The colors the screen is painted in. Absent keeps the renderer's own,
   * so a build with no theme Domain still draws. They are state rather than
   * something settled when a renderer started: a theme picker that cannot
   * repaint is a theme picker nobody can see.
   */
  readonly theme?: ThemeColors
  readonly live: string
  readonly model: string
  readonly cost: string
  readonly tokens: string
  readonly took: string
  readonly mode: string
  // When the open Run opened. Read only while `work.running`.
  readonly opened: number
  readonly work: Work
  // The record's fold, and nothing else. A fold replaces it, so nothing
  // here is the source of truth for long.
  readonly shown: readonly TranscriptMessage[]
  /**
   * What this Console said of its own — command output, a notice, a
   * question. They never enter `shown`, because a line the record cannot
   * rebuild is not the record. They last until the conversation moves on: a
   * Run opens, or the Console follows another Session.
   */
  readonly notes: readonly string[]
}

/** Where this Console runs, which no Run changes. */
export interface Place {
  readonly version: string
  readonly branch: string
  readonly directory: string
}

export type ConsoleEvent =
  // The line editor changed the buffer, or moved the caret through it.
  | { readonly kind: "typed"; readonly buffer: string; readonly cursor: number }
  // The person walked the prompt history.
  | { readonly kind: "recalled"; readonly direction: "back" | "forward" }
  // A line left the editor for the loop, whatever it turns out to mean.
  | { readonly kind: "submitted"; readonly line: string }
  // The surface says something of its own: command output, a notice.
  | { readonly kind: "said"; readonly text: string }
  // Eva asked a question; the next line answers it.
  | { readonly kind: "asked"; readonly question: string }
  | { readonly kind: "answered" }
  // A Run opened on this prompt.
  | { readonly kind: "opened"; readonly line: string; readonly at: number }
  // The open Run streamed a payload into the Live area.
  | { readonly kind: "streamed"; readonly payload: Payload }
  // The clock turned while the Run was open.
  | { readonly kind: "ticked"; readonly at: number }
  // The open Run closed; the fold that replaces its stream follows.
  | { readonly kind: "closed"; readonly at: number }
  // A panel opened over the fold, and what taking a row from it means.
  | { readonly kind: "opened-overlay"; readonly overlay: OpenOverlay }
  // The panel's own query changed. A `buffer` panel is refiltered by the
  // line instead, on `typed`.
  | { readonly kind: "filtered"; readonly query: string }
  // The selection moved through the panel's rows.
  | { readonly kind: "stepped"; readonly by: number }
  // The panel closed, whether a row was taken or not.
  | { readonly kind: "closed-overlay" }
  // The person pressed the key that steps back. What that means is the
  // stack's to decide, and `backStep` decides it.
  | { readonly kind: "backed" }
  // A key that was not the step-back key arrived, so the interrupt that was
  // armed is not armed any more.
  | { readonly kind: "disarmed" }
  // The screen's colors changed: a theme was chosen, or one is being looked
  // at. No colors is the renderer's own default, which is what restoring
  // says when nothing was set before.
  | { readonly kind: "themed"; readonly colors?: ThemeColors }
  // The person cancelled whatever was open.
  | { readonly kind: "cancelled" }
  // The record's fold replaces what was shown.
  | {
      readonly kind: "folded"
      readonly messages: readonly TranscriptMessage[]
      readonly model: string
      readonly summary: CostSummary
      readonly holding: boolean
    }
  // A command opened another Session; the Console follows it there.
  | { readonly kind: "selected"; readonly session: SessionID }

const IDLE: Work = { running: false, elapsed: "", tick: 0, hint: "" }

export const initial = (session: SessionID): ConsoleState => ({
  session,
  buffer: "",
  cursor: 0,
  history: [],
  asking: false,
  armed: false,
  hushed: false,
  live: "",
  model: "",
  cost: "",
  tokens: "",
  took: "",
  mode: "ready",
  opened: 0,
  work: IDLE,
  shown: [],
  notes: [],
})

const said = (author: TranscriptMessage["author"], text: string): TranscriptMessage => ({
  author,
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

/**
 * What the Console says of its own, one note per line. A blank line inside
 * one saying says nothing, so it is left out rather than drawn empty — but
 * one saying stands clear of the one before it, because two answers with
 * nothing between them read as one longer answer.
 */
const say = (state: ConsoleState, text: string): ConsoleState => {
  const lines = text.split("\n").filter((line) => line !== "")
  if (lines.length === 0) return state
  const apart = state.notes.length === 0 ? [] : [""]
  return { ...state, notes: [...state.notes, ...apart, ...lines] }
}

/**
 * What one press of the step-back key does, from what is open. One key, one
 * meaning: step back. The reducer applies it and the surface reads it to
 * know whether to interrupt — one rule, in one place, read twice, because a
 * screen that says one thing and a Run that does another is the whole
 * failure this stack exists to avoid.
 */
export type BackStep = "close-overlay" | "clear-line" | "arm" | "interrupt" | "nothing"

export const backStep = (state: ConsoleState): BackStep => {
  if (state.overlay !== undefined) return "close-overlay"
  if (state.buffer !== "") return "clear-line"
  if (!state.work.running) return "nothing"
  return state.armed ? "interrupt" : "arm"
}

// What the status line says an armed interrupt is waiting for. The surface
// chooses the words, so every renderer says the same ones.
export const ARMED = "esc again to interrupt"

// What the status line says while Eva is waiting on an answer. The left half
// holds one state at a time, and this is the one that outranks `ready`: the
// line is open, but not for a prompt.
export const ASKING = "answer the question above"

// A walk that has ended leaves no index behind.
const settled = (state: ConsoleState): ConsoleState => {
  const { recall: _recall, ...rest } = state
  return rest
}

const disarm = (state: ConsoleState): ConsoleState =>
  state.armed ? { ...state, armed: false, work: { ...state.work, hint: "" } } : state

// A panel that has closed leaves nothing behind.
const shut = (state: ConsoleState): ConsoleState => {
  const { overlay: _overlay, ...rest } = state
  return rest
}

// One step back. The interrupt itself is the surface's to perform — what it
// leaves on the screen is the cancel that follows it.
const back = (state: ConsoleState): ConsoleState => {
  switch (backStep(state)) {
    case "close-overlay":
      // Dismissing completion is about this line: the next edit asks for
      // it again, and until then the line is the person's alone.
      return { ...shut(state), hushed: state.overlay?.source === "buffer" }
    case "clear-line":
      return { ...settled(state), buffer: "", cursor: 0, hushed: false }
    case "arm":
      return { ...state, armed: true, work: { ...state.work, hint: ARMED } }
    case "interrupt":
    case "nothing":
      return state
  }
}

const walked = (state: ConsoleState, direction: "back" | "forward"): ConsoleState => {
  if (direction === "back") {
    // A walk starts behind the newest line and stops at the oldest — going
    // past it would wrap, and a wrap reads as the history changing.
    const index = (state.recall ?? state.history.length) - 1
    const line = state.history[index]
    if (line === undefined) return state
    return { ...state, buffer: line, cursor: Array.from(line).length, recall: index }
  }
  if (state.recall === undefined) return state
  const line = state.history[state.recall + 1]
  // Forward past the newest line is the empty line the walk started from.
  if (line === undefined) return { ...settled(state), buffer: "", cursor: 0 }
  return { ...state, buffer: line, cursor: Array.from(line).length, recall: state.recall + 1 }
}

export const apply = (state: ConsoleState, event: ConsoleEvent): ConsoleState => {
  switch (event.kind) {
    case "typed": {
      // Moving the caret is not editing: it ends no history walk, asks for
      // no completion, and leaves a dismissal in place.
      if (event.buffer === state.buffer) {
        return { ...state, cursor: event.cursor }
      }
      // A panel that follows the line follows it here. The surface decides
      // whether the line still asks for one; this only keeps the open one
      // in step with what it is completing.
      const typed = { ...settled(state), buffer: event.buffer, cursor: event.cursor, hushed: false }
      return typed.overlay === undefined || typed.overlay.source !== "buffer"
        ? typed
        : { ...typed, overlay: refiltered(typed.overlay, event.buffer) }
    }
    case "recalled":
      return walked(state, event.direction)
    case "opened-overlay":
      return { ...state, overlay: event.overlay }
    case "filtered":
      return state.overlay === undefined
        ? state
        : { ...state, overlay: refiltered(state.overlay, event.query) }
    case "stepped":
      return state.overlay === undefined
        ? state
        : { ...state, overlay: moved(state.overlay, event.by) }
    case "closed-overlay":
      return shut(state)
    case "backed":
      return back(state)
    case "disarmed":
      return disarm(state)
    case "themed": {
      const { theme: _theme, ...rest } = state
      return event.colors === undefined ? rest : { ...rest, theme: event.colors }
    }
    case "submitted": {
      const history =
        state.history[state.history.length - 1] === event.line
          ? state.history
          : [...state.history, event.line]
      return { ...settled(state), history }
    }
    case "said":
      return say(state, event.text)
    case "asked":
      return { ...say(state, event.question), asking: true }
    case "answered":
      return { ...state, asking: false }
    case "opened":
      return {
        // A panel over a moving fold is a panel over the wrong thing, so
        // the Run that starts takes it with it.
        ...shut(state),
        shown: [...state.shown, said("human", event.line)],
        // The conversation moves on, so what the Console said before it
        // goes with it.
        notes: [],
        mode: "running",
        live: "",
        took: "",
        opened: event.at,
        hushed: false,
        work: { running: true, elapsed: seconds(0), tick: 0, hint: "" },
      }
    case "streamed":
      // The stream lands in the Live area, never in the fold. Anything in
      // the session pane came from the record.
      return event.payload.kind === "text" && event.payload.content.type === "text"
        ? { ...state, live: state.live + event.payload.content.text }
        : state
    case "ticked":
      // A tick after the Run closed says nothing. The spinner and the
      // caption both read off the count, so both renderers animate in step.
      return state.work.running
        ? {
            ...state,
            work: {
              running: true,
              elapsed: seconds(event.at - state.opened),
              tick: state.work.tick + 1,
              hint: state.work.hint,
            },
          }
        : state
    case "closed":
      return { ...state, work: IDLE, took: tookText(event.at - state.opened) }
    case "cancelled":
      // The Run the interrupt was armed against is gone, so the arming
      // goes with it rather than waiting for the next one.
      return { ...state, mode: "ready", live: "", work: IDLE, armed: false }
    case "folded": {
      /**
       * The fold, drawn over what the Console was showing. A Run that just
       * closed is in the record, so a fold that comes back with nothing has
       * lost the record rather than the conversation: `holding` keeps the
       * screen instead of blanking it. Choosing another Session passes it
       * over, because an empty Session really is empty.
       */
      const shown = event.messages.length > 0 || !event.holding ? event.messages : state.shown
      return {
        ...state,
        shown,
        model: event.model,
        cost: costText(spendOf(event.summary, shown.length > 0)),
        tokens: tokenLine(event.summary.inputTokens, event.summary.outputTokens),
        live: "",
        // A fold while a Run is open is a repaint, not an ending: the pipe
        // dropped and the record took the stream's place. The Run says when
        // it is over, and it has not.
        mode: state.work.running ? state.mode : "ready",
      }
    }
    case "selected":
      // Another Session is another conversation, so the words this one said
      // do not follow it there.
      return { ...state, session: event.session, notes: [] }
  }
}

// What a renderer is given of the panel: what is drawn, and nothing that
// is decided. Where a chosen row goes is the surface's business.
const drawable = ({ intent: _intent, all: _all, ...overlay }: OpenOverlay): Overlay => overlay

export const frameOf = (state: ConsoleState, place: Place): Frame => ({
  banner: { ...place, model: state.model },
  session: state.shown,
  notes: state.notes,
  live: state.live,
  input: state.buffer,
  cursor: state.cursor,
  took: state.took,
  work: state.work,
  status: {
    model: state.model,
    tokens: state.tokens,
    cost: state.cost,
    // One state at a time on the left half, and a question outranks the
    // rest: what the line is for right now is what it says.
    mode: state.asking ? ASKING : state.mode,
  },
  ...(state.overlay === undefined ? {} : { overlay: drawable(state.overlay) }),
  ...(state.theme === undefined ? {} : { theme: state.theme }),
})
