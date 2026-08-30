import type { CommandInfo } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import type { ConsoleEvent, ConsoleState } from "./console.js"
import {
  commandRows,
  completed,
  completionQuery,
  opened,
  selectedRow,
  COMMANDS_HINT,
  COMMANDS_TITLE,
} from "./overlay.js"

/**
 * The panel over every command there is, and the completion that follows the
 * line.
 *
 * What the choices and the questions already are: a tenant of the surface
 * with its own state, reached through three doors. Nothing here knows what a
 * line means — a row taken becomes a line and the line goes back out through
 * `run`, which is the fold at every door — so this decides only which rows are
 * offered and what a key on one of them does.
 */

/**
 * What the panel needs of the surface around it: a way to draw, the rows at
 * the moment of use, the screen as it stands, and where a line goes.
 */
export interface PaletteDeps {
  readonly on: (event: ConsoleEvent) => void
  // Read at the point of use, so a plugin loaded a moment ago is in the panel.
  readonly commands: Effect.Effect<readonly CommandInfo[]>
  readonly state: () => ConsoleState
  /**
   * Where a row that was run goes. It is the same door a typed line takes, so
   * a row taken while a Run is open waits its turn rather than opening a
   * second one over it.
   */
  readonly run: (line: string) => Effect.Effect<void>
}

// The three doors to the panel: one opens it over every command, one keeps it
// in step with the line, and one answers a row.
export interface Palette {
  readonly open: () => Effect.Effect<void>
  readonly completing: () => Effect.Effect<void>
  readonly take: (how: "run" | "complete") => Effect.Effect<void>
}

export const makePalette = ({ on, commands, state, run }: PaletteDeps): Palette => {
  /**
   * The panel over every command there is. It reads the command Domain at the
   * point of use, so a plugin loaded a moment ago is in it.
   */
  const open = Effect.fn("eva.tui.palette")(function* () {
    const rows = commandRows(yield* commands)
    on({
      kind: "opened-overlay",
      overlay: opened(COMMANDS_TITLE, rows, "", { kind: "command" }, "query", COMMANDS_HINT),
    })
  })

  /**
   * Completion, kept in step with the line. A line that is still naming a
   * command has a panel; one that has stopped naming one does not, and a
   * panel dismissed for this line stays dismissed until the line moves on.
   */
  const completing = Effect.fn("eva.tui.completing")(function* () {
    const now = state()
    const showing = now.overlay?.source === "buffer"
    const query = completionQuery(now.buffer)
    if (query === undefined || now.hushed) {
      if (showing) on({ kind: "closed-overlay" })
      return
    }
    // An open panel is already following the line: the Console refiltered it
    // when the line changed.
    if (showing) return
    const rows = commandRows(yield* commands)
    on({
      kind: "opened-overlay",
      overlay: opened(
        COMMANDS_TITLE,
        rows,
        now.buffer,
        { kind: "command" },
        "buffer",
        COMMANDS_HINT,
      ),
    })
  })

  /**
   * A row was taken. Enter runs it and tab leaves it on the line to finish,
   * which is what the panel says the two keys do.
   *
   * A command that names an argument is still run: `argumentHint` says what an
   * argument would look like, never that one is needed, and running with none
   * is not inventing one — it is the line the person would have typed.
   * `/theme` and `/model` both answer a bare line with a choice of their own,
   * and reading the hint as a demand is what made the palette type them out
   * instead of opening either.
   */
  const take = Effect.fn("eva.tui.take")(function* (how: "run" | "complete") {
    const overlay = state().overlay
    if (overlay === undefined) return
    const row = selectedRow(overlay)
    if (row === undefined) return

    const command = (yield* commands).find((one) => one.id === row.id)
    if (command === undefined) return
    on({ kind: "closed-overlay" })

    const line = completed(command)
    if (how === "complete") {
      on({ kind: "typed", buffer: line, cursor: Array.from(line).length })
      return
    }
    // The space tab leaves for an argument is not part of the line a Run is
    // opened on.
    const running = line.trimEnd()
    on({ kind: "submitted", line: running })
    on({ kind: "typed", buffer: "", cursor: 0 })
    yield* run(running)
  })

  return { open, completing, take }
}
