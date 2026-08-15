import type { CommandInfo, PickRow } from "@missingstudio/eva-sdk"
import type { Overlay, OverlayRow } from "@missingstudio/eva-tui-core"

/**
 * One physics for selection, and the rows that fill it. A panel is opened
 * by a command, filtered by typing, moved through with up and down, and
 * left with the step-back key — learned once, and the same wherever it is
 * met.
 *
 * Nothing here knows about a renderer or a Session: what a panel decides is
 * decided by whoever opened it.
 */

// What the panel does with the row that was taken. The Console carries it
// so the surface knows which answer a chosen row is.
export type Intent =
  // The rows are commands: taking one runs it, or leaves it on the line
  // when it wants an argument.
  | { readonly kind: "command" }
  // Somebody asked for a choice and is waiting on it. The number names the
  // request, so a late panel cannot answer a question nobody asked.
  | { readonly kind: "pick"; readonly request: number }

/**
 * The Frame's Overlay, and what the surface needs beside it: every row
 * before the query narrowed them, and what taking one means. The Frame
 * carries what is drawn; this carries what is decided.
 */
export interface OpenOverlay extends Overlay {
  readonly intent: Intent
  readonly all: readonly OverlayRow[]
}

export const COMMANDS_TITLE = "commands"
export const COMMANDS_HINT = "↑↓ move · enter run · tab complete · esc close"
export const PICK_HINT = "↑↓ move · enter select · esc keep what you had"

// What a row is matched as, and what a person types to reach it. The `/`
// that marks a command is punctuation on both sides: typing `mod` and
// typing `/mod` are the same request for `/model`.
const bare = (text: string): string => text.toLowerCase().replace(/^\/+/, "")

/**
 * How well a row answers a query, or nothing when it does not. A query
 * matches as a subsequence — the letters in order, gaps allowed — because
 * that is what people type when they half remember a name.
 *
 * The score is a rank rather than a distance: a prefix beats a word start,
 * a word start beats anything further in, which beats a scatter. Lower is
 * better, and ties keep the order the rows arrived in, so a domain's own
 * ordering survives a broad query.
 */
export const score = (label: string, query: string): number | undefined => {
  const needle = bare(query)
  if (needle === "") return 0
  const haystack = bare(label)
  if (haystack.startsWith(needle)) return 0

  // A word start is the letter after a separator, which is where a person
  // looking for `/trace show` types `sh`.
  const at = haystack.indexOf(needle)
  if (at > 0) return /[\s/._-]/.test(haystack[at - 1] ?? "") ? 1 : 2

  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) index += 1
    if (index === needle.length) return 3
  }
  return undefined
}

// The rows a query leaves, best first. A row that does not answer the
// query is left out rather than shown greyed: a panel is a list of what
// can be taken.
export const matching = (rows: readonly OverlayRow[], query: string): readonly OverlayRow[] =>
  rows
    .map((row, order) => ({ row, order, rank: score(row.label, query) }))
    .filter(
      (one): one is { row: OverlayRow; order: number; rank: number } => one.rank !== undefined,
    )
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((one) => one.row)

/**
 * A panel over these rows. The selection is kept inside what is left after
 * the query narrowed them — a marker on a row that is no longer there is a
 * panel that takes something nobody was looking at.
 */
export const opened = (
  title: string,
  all: readonly OverlayRow[],
  query: string,
  intent: Intent,
  source: "query" | "buffer",
  hint: string,
): OpenOverlay => {
  const rows = matching(all, query)
  return { title, source, query, rows, selected: 0, hint, intent, all }
}

export const refiltered = (overlay: OpenOverlay, query: string): OpenOverlay => {
  const rows = matching(overlay.all, query)
  return {
    ...overlay,
    query,
    rows,
    selected: Math.min(overlay.selected, Math.max(0, rows.length - 1)),
  }
}

// One step through the rows. It stops at both ends rather than wrapping,
// the same rule the caret keeps in the line.
export const stepped = (overlay: OpenOverlay, by: number): OpenOverlay => ({
  ...overlay,
  selected: Math.max(0, Math.min(overlay.rows.length - 1, overlay.selected + by)),
})

export const selectedRow = (overlay: Overlay): OverlayRow | undefined =>
  overlay.rows[overlay.selected]

// A command as a row: the name people type, and what the domain says it
// does. An alias is not a row of its own — one command is one row.
export const commandRow = (command: CommandInfo): OverlayRow => ({
  id: command.id,
  label: `/${command.id}`,
  detail: command.description,
})

export const commandRows = (commands: readonly CommandInfo[]): readonly OverlayRow[] =>
  commands.map(commandRow)

/**
 * A command's choice as rows of the panel. A row that says nothing about
 * itself says nothing rather than an empty column, and what the row would
 * paint stays with the command that offered it — a panel draws rows, and
 * only the surface knows whether this screen has colors at all.
 */
export const pickRows = (rows: readonly PickRow[]): readonly OverlayRow[] =>
  rows.map((row) => ({ id: row.id, label: row.label, detail: row.detail ?? "" }))

/**
 * What slash completion shows for a line, or nothing when the line is not
 * asking for it. Completion belongs to a line that is still naming a
 * command: one token, no argument yet. A typed space closes it, because
 * the argument after it belongs to the person and not to a list.
 */
export const completionQuery = (buffer: string): string | undefined =>
  /^\/\S*$/.test(buffer) ? buffer.slice(1) : undefined

/**
 * What tab leaves on the line. A command that takes an argument gets the
 * space that starts one; a command that takes none does not, so enter is
 * the only thing left to press.
 */
export const completed = (command: CommandInfo): string =>
  command.argumentHint === undefined ? `/${command.id}` : `/${command.id} `
