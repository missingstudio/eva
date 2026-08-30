import {
  blockFold,
  errorText,
  hunkText,
  resultText,
  type Block,
} from "@missingstudio/eva-session-view"
import type { Frame, Overlay, OverlayRow } from "@missingstudio/eva-tui-core"

export interface Line {
  readonly key: string
  readonly text: string
  readonly kind: "human" | "agent" | "thought" | "tool" | "system"
}

/**
 * One author speaking, drawn behind one gutter bar. A message is a turn, so
 * a turn is what the screen groups by.
 */
export interface Group {
  readonly key: string
  readonly kind: "human" | "agent" | "system"
  readonly lines: readonly Line[]
  // How long the Run that produced this turn took. Only the last agent turn
  // carries one, because only the last Run was timed.
  readonly note: string
}

export const TITLE = "EVA"
export const TAGLINE = "Evidence, not claims"

// The prompt and the space that follows it, as one string: what stands in
// front of the typed line is one thing, so the caret and the line it sits
// on cannot count it differently.
export const PROMPT = "›"
export const PROMPT_PREFIX = `${PROMPT} `
export const PLACEHOLDER = "ask something"

// What joins two things on one line. One spelling, so a renderer that draws
// the parts and a renderer that draws the line agree.
export const SEPARATOR = " · "

// The doors this surface has, said once where a person first looks. A door
// nobody names is a door nobody finds.
export const HINT = ["type /help", "ctrl+k commands"].join(SEPARATOR)

// One turn of the spinner per tick.
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

/**
 * What the surface says it is doing while a Run is open. Nothing here is
 * read from the Run: a caption says work is happening, not what happened.
 * The record is where a reader looks for that.
 */
export const CAPTIONS = [
  "Thinking",
  "Working",
  "Pondering",
  "Considering",
  "Reasoning",
  "Puzzling",
  "Deliberating",
  "Mulling",
] as const

// The spinner turns every tick. A caption is read rather than watched, so it
// holds for far longer than the spinner does.
export const CAPTION_TICKS = 30

export interface WorkLine {
  readonly spinner: string
  readonly caption: string
  // The elapsed time with the separator that puts it after the caption, or
  // nothing at all. A renderer colours the parts; it never rejoins them.
  readonly since: string
  // What the next press of the step-back key would do, when that needs
  // saying, with the separator that puts it last. The surface chose the
  // words; this only places them.
  readonly hint: string
  // The whole line in one string, for a renderer that draws lines.
  readonly text: string
}

export const workLine = (frame: Frame): WorkLine | undefined => {
  const { running, tick, elapsed } = frame.work
  if (!running) return undefined
  const spinner = SPINNER[tick % SPINNER.length] as string
  const caption = `${CAPTIONS[Math.floor(tick / CAPTION_TICKS) % CAPTIONS.length] as string}…`
  const since = elapsed === "" ? "" : `${SEPARATOR}${elapsed}`
  const hint = frame.work.hint === "" ? "" : `${SEPARATOR}${frame.work.hint}`
  return { spinner, caption, since, hint, text: `${spinner} ${caption}${since}${hint}` }
}

// One spelling for each chrome line, so the two renderers cannot disagree.
const joined = (parts: readonly string[]): string =>
  parts.filter((part) => part !== "").join(SEPARATOR)

/**
 * One row of the banner, drawn. The label arrives padded to the column the
 * widest of them sets, so nothing that draws a row has to work the width
 * out again — the pairing of a row with its width was an invariant two
 * callers held by hand.
 */
export interface BannerRow {
  readonly label: string
  readonly value: string
}

// What this build is and where it runs. A row with nothing to say is left
// out rather than drawn empty.
export const bannerRows = (frame: Frame): readonly BannerRow[] => {
  const rows = (
    [
      ["version", frame.banner.version],
      ["model", frame.banner.model],
      ["branch", frame.banner.branch],
      ["cwd", frame.banner.directory],
    ] as const
  ).filter(([, value]) => value !== "")
  // The labels line their values up, so the widest label sets the column.
  const width = rows.reduce((widest, [label]) => Math.max(widest, label.length), 0) + 3
  return rows.map(([label, value]) => ({ label: label.padEnd(width), value }))
}

// While a Run is open the spinner has the left of the status line, because
// it is the only thing there that changes.
export const statusLeft = (frame: Frame): string => workLine(frame)?.text ?? frame.status.mode
export const statusRight = (frame: Frame): string =>
  joined([frame.status.tokens, frame.status.cost, frame.status.model])

export const statusLine = (frame: Frame): string => joined([statusLeft(frame), statusRight(frame)])
export const promptLine = (frame: Frame): string =>
  `${PROMPT_PREFIX}${frame.input === "" ? PLACEHOLDER : frame.input}`

const typedRows = (frame: Frame): readonly string[] => frame.input.split("\n")

// The line grows downward as it is typed into, so the box that holds it has
// to grow with it. The two rules are the box, so they are counted in.
export const inputHeight = (frame: Frame): number => typedRows(frame).length + 2

/**
 * Where the caret sits: where the surface put it, on the row it put it on.
 * Both are counted from the corner of the input line, so whoever draws that
 * line is the one that knows where it is on the screen — and both renderers
 * read the one number the surface moved, rather than each deciding for
 * itself that typing happens at the end.
 */
export const caret = (frame: Frame): { readonly row: number; readonly column: number } => {
  // Code points rather than units, so one astral character moves the caret
  // one column and not two. The prompt is measured the same way, and it is
  // measured from the one string the line itself is drawn with.
  const typed = Array.from(frame.input)
  const before = typed.slice(0, Math.max(0, Math.min(typed.length, frame.cursor)))
  const row = before.filter((character) => character === "\n").length
  return {
    row,
    column: Array.from(PROMPT_PREFIX).length + before.length - (before.lastIndexOf("\n") + 1),
  }
}

// At most this many rows of a panel are drawn at once. A panel is a list to
// choose from, not a page to read.
export const PANEL_ROWS = 8

/**
 * What a renderer with a viewport draws of a panel: the rows that fit, and
 * where they start. The selection is always among them — a marker scrolled
 * off the panel is a panel that takes something nobody was looking at — and
 * `from` is what turns a drawn row back into the row the panel selected.
 */
export interface PanelWindow {
  readonly rows: readonly OverlayRow[]
  readonly from: number
}

export const panelWindow = (overlay: Overlay, limit = PANEL_ROWS): PanelWindow => {
  const from = overlay.selected < limit ? 0 : overlay.selected - limit + 1
  return { rows: overlay.rows.slice(from, from + limit), from }
}

/**
 * One Block as terminal rows. What the Run did is settled before this is
 * called — the fold in `session-view` settled it — so all this decides is
 * what a row looks like.
 *
 * A row is a line of text, and an image is not one. So the screen draws
 * fewer of the Blocks than a page draws, which is a renderer that renders
 * less rather than one that knows less: the Block is still on the fold for
 * a renderer that can draw it.
 */
const rowsOf = (block: Block, author: Group["kind"]): readonly Line[] => {
  const key = block.key
  switch (block.kind) {
    case "words":
      return [{ key, text: block.text, kind: author }]
    case "reasoning":
      return [{ key, text: block.text, kind: "thought" }]
    case "tool":
      return [{ key, text: `${block.name} ${block.status}`, kind: "tool" }]
    // A call that has been answered says how it ended. A status alone reads
    // as a call that worked, and `denied` is not that.
    case "result":
      return [{ key, text: `${block.name} ${block.status} ${block.disposition}`, kind: "tool" }]
    // The path and the count of hunks, because a reader counting the work
    // wants the size of it: one file changed in one place is not one file
    // rewritten.
    case "diff":
      return [{ key, text: `edit ${block.path} ${hunkText(block.hunks)}`, kind: "tool" }]
    case "mode":
      return [
        {
          key,
          text:
            block.reason === undefined
              ? `mode ${block.mode}`
              : `mode ${block.mode} · ${block.reason}`,
          kind: "system",
        },
      ]
    /**
     * How the Run ended, and what to do when it stopped. The mark and the
     * class are the first row, because that is what a person reads first;
     * the words the Run gave and the words the class means are under it,
     * indented, in the order a person needs them.
     *
     * Nothing is invented here. A Claim with no summary draws no summary row,
     * and a failure nobody classified draws no advice row.
     */
    case "outcome": {
      const mark = block.result === "failed" ? "✗" : "✓"
      const named = block.errorClass === undefined ? "" : `${SEPARATOR}${block.errorClass}`
      const said = (at: string, text: string): Line => ({
        key: `${key}.${at}`,
        text,
        kind: "system",
      })
      return [
        { key, text: `${mark} ${resultText(block.result)}${named}`, kind: "system" },
        ...(block.summary === undefined ? [] : [said("said", `  ${block.summary}`)]),
        ...(block.errorClass === undefined
          ? []
          : [said("why", `  ${errorText(block.errorClass)}`)]),
      ]
    }
    /**
     * A question that stands is answered in the Overlay, not on the line the
     * scroll-back holds: the four options are a choice a person moves through
     * and a row is a line of text. So the row is drawn nowhere and the panel
     * is what asks — a renderer that renders less, in the way an image is.
     */
    case "permission":
    case "image":
    case "unknown":
      return []
  }
}

/**
 * The transcript as drawable turns. A message is one author speaking, so the
 * author is carried down rather than recovered from the text.
 */
export const toGroups = (frame: Frame): readonly Group[] => {
  const out: Group[] = []
  for (const turn of blockFold(frame.session)) {
    const kind = turn.author
    const lines = turn.blocks.flatMap((block) => rowsOf(block, kind))
    if (lines.length > 0) out.push({ key: turn.key, kind, lines, note: "" })
  }

  // The timing belongs to the turn the Run produced, which is the last one.
  const last = out[out.length - 1]
  if (frame.took === "" || last === undefined || last.kind !== "agent") return out

  return [...out.slice(0, -1), { ...last, note: frame.took }]
}

// The note rides along as a line of its own, so a renderer that draws lines
// rather than groups still says what the Run took.
export const toLines = (frame: Frame): readonly Line[] =>
  toGroups(frame).flatMap((group) => [
    ...group.lines,
    ...(group.note === ""
      ? []
      : [{ key: `${group.key}.note`, text: group.note, kind: "system" as const }]),
  ])
