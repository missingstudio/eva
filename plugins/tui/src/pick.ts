import type { PickRow } from "@missingstudio/eva-sdk"
import { themeColors, type ThemeColors } from "@missingstudio/eva-tui-core"
import { Deferred, Effect } from "effect"
import type { ConsoleEvent } from "./console.js"
import { opened, pickRows, PICK_HINT } from "./overlay.js"

/**
 * A choice a command is waiting on: the rows as the command offered them,
 * and what the screen was painted in before the panel opened. Esc means keep
 * what you had, and what you had includes the colors.
 */
interface Waiting {
  readonly rows: readonly PickRow[]
  readonly deferred: Deferred.Deferred<PickRow | undefined>
  readonly theme?: ThemeColors
}

/**
 * What the choices need of the surface around them: a way to draw, and the
 * colors the screen holds now. Nothing else — `overlay.ts` says what a panel
 * looks like, and the command that opened one says what a taken row means.
 */
export interface PickDeps {
  readonly on: (event: ConsoleEvent) => void
  readonly theme: () => ThemeColors | undefined
}

// The three doors to the choices that are open: one opens a panel, one
// paints the row under the selection, and one answers.
export interface Picks {
  /**
   * The `pick` a command is given. It is a Deferred the panel answers:
   * enter carries the row back, esc carries nothing — and nothing means the
   * person kept what they had, which no command may read as a choice.
   */
  readonly pick: (title: string, rows: readonly PickRow[]) => Effect.Effect<PickRow | undefined>
  /**
   * The screen while a row is only being looked at. A row that names colors
   * paints them; one that names none paints nothing, which is why moving
   * through the model picker never switches a model — that is a fact of the
   * Session, and it happens when a row is taken.
   */
  readonly preview: (request: number, id: string | undefined) => void
  /**
   * A choice, answered. The panel leaves the screen as it found it — what it
   * painted while a row was under the selection was a look, not a decision —
   * and what the command does with the row it took is the command's to say.
   */
  readonly resolved: (request: number, id?: string) => void
}

/**
 * The choices open, by the number that names each request. A panel that
 * closes late cannot answer a question nobody asked.
 */
export const makePicks = ({ on, theme }: PickDeps): Picks => {
  const waiting = new Map<number, Waiting>()
  let picks = 0

  const preview = (request: number, id: string | undefined): void => {
    const colors = waiting.get(request)?.rows.find((row) => row.id === id)?.colors
    const gated = colors === undefined ? undefined : themeColors(colors)
    if (gated !== undefined) on({ kind: "themed", colors: gated })
  }

  const resolved = (request: number, id?: string): void => {
    const one = waiting.get(request)
    if (one === undefined) return

    waiting.delete(request)
    on({ kind: "themed", ...(one.theme === undefined ? {} : { colors: one.theme }) })
    Deferred.doneUnsafe(one.deferred, Effect.succeed(one.rows.find((row) => row.id === id)))
  }

  const pick = Effect.fn("eva.tui.pick")(function* (title: string, rows: readonly PickRow[]) {
    picks += 1
    const request = picks
    const deferred = yield* Deferred.make<PickRow | undefined>()
    const held = theme()
    waiting.set(request, { rows, deferred, ...(held === undefined ? {} : { theme: held }) })
    on({
      kind: "opened-overlay",
      overlay: opened(title, pickRows(rows), "", { kind: "pick", request }, "query", PICK_HINT),
    })
    return yield* Deferred.await(deferred)
  })

  return { pick, preview, resolved }
}
