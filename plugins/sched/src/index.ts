import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

const OPTIONS = declare({ barrier: "list" })

/**
 * The tool names this build refuses to run in parallel. A list is written by
 * a person, so an entry that is not a name is dropped rather than read as
 * one.
 */
export const barrierNames = (options: Record<string, unknown>): readonly string[] =>
  OPTIONS.read(options, "barrier", []).filter(
    (one): one is string => typeof one === "string" && one !== "",
  )

/**
 * The parallel-safety policy, as one plugin.
 *
 * A tool claims that a call may run beside another through `parallelSafe` on
 * its own row, and the group runner in
 * [`@missingstudio/eva-core`](../../packages/core/README.md) reads the claim
 * per call. This plugin is where a build says what it does with a claim:
 *
 * - a row that claims nothing runs alone, and no option here changes that;
 * - a row named in `barrier` loses its claim, so it runs alone as well.
 *
 * It narrows and never widens, which is why there is no `parallel` option: a
 * tool that shares state with its own next call is the only thing that knows
 * so, and a person who could mark one safe from a config file would be
 * overruling the author of the code that runs.
 */
export const sched = define({
  id: "eva.sched",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.sched")(function* (ctx) {
    const barriers = barrierNames(ctx.options)
    if (barriers.length === 0) return
    /**
     * The claim is taken off the row rather than answered `false`, because
     * the row then reads as what it now is: a tool this build has not
     * classified. A name no row holds is reported as a missed edit through
     * `tool.updated`, so a rule against a tool that is not loaded is visible
     * rather than quiet.
     */
    yield* ctx.tool.transform((draft) => {
      for (const name of barriers)
        draft.update(name, (row) => {
          delete row.parallelSafe
        })
    })
  }),
})
