import type { Domain, Row } from "@missingstudio/eva-core"
import type { Effect } from "effect"
import { makeDomain } from "./domain.js"

/**
 * A domain of plain rows: every domain but the catalog has this shape.
 *
 * The Draft rules live here rather than in the composition root, because they
 * are what a Domain of rows *is* — a row is copied in, a replaced row keeps
 * its position, and an id nothing registered is left alone. Assembling the
 * domains is a separate job, and the composition root still owns it.
 *
 * `publish` is what the assembler wires the commit to. A domain that says
 * nothing when it changes is the gap this parameter exists to close.
 */
export const makeRowDomain = <Info extends { id: string }>(
  name: string,
  publish: (count: number) => Effect.Effect<void>,
): Effect.Effect<Domain<readonly Info[], Row<Info>>> =>
  makeDomain<readonly Info[], Row<Info>>({
    name,
    initial: () => [] as Info[],
    draft: (state) => {
      const rows = state as Info[]
      const at = (id: string) => rows.findIndex((row) => row.id === id)
      return {
        list: () => [...rows],
        get: (id) => rows.find((row) => row.id === id),
        // Copied in, because a plugin registers a constant it holds and a
        // later transform edits the row in place. A replace keeps the
        // position, for the reason a plugin replace does.
        set: (info) => {
          const found = at(info.id)
          const made = { ...info }
          if (found >= 0) rows[found] = made
          else rows.push(made)
        },
        update: (id, update) => {
          const found = rows.find((row) => row.id === id)
          if (found !== undefined) update(found)
        },
        remove: (id) => {
          const found = at(id)
          if (found >= 0) rows.splice(found, 1)
        },
      }
    },
    onCommit: (state) => publish(state.length),
  })
