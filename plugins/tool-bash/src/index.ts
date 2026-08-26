import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { commandTool } from "./row.js"

export * from "./command.js"
export * from "./row.js"

const OPTIONS = declare({ timeout: "number", maxOutput: "number" })

/**
 * Two minutes, and sixty-four thousand characters. A command that has said
 * nothing for two minutes is normally waiting for something that will not
 * come, and a result longer than this is a log rather than an answer.
 */
const DEFAULTS = { timeout: 120, maxOutput: 64_000 }

/**
 * The command tool. It runs a command through the `Sandbox` slot, streams the
 * output as it arrives, and reports the exit — how long a command may run is
 * this plugin's policy, because the process holds no limit of its own.
 */
export const toolBash = define({
  id: "eva.tool.bash",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.tool.bash")(function* (ctx) {
    const row = commandTool({
      sandbox: ctx.slot.sandbox.peek,
      timeout: OPTIONS.read(ctx.options, "timeout", DEFAULTS.timeout),
      maxOutput: OPTIONS.read(ctx.options, "maxOutput", DEFAULTS.maxOutput),
    })
    yield* ctx.tool.transform((draft) => {
      draft.set(row)
    })
  }),
})
