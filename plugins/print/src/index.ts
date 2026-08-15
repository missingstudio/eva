import { define, type CommandContext } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { costLine } from "./cost-line.js"

export * from "./cost-line.js"

export const PRINT_SURFACE = "eva.print"

// The record answers this, so what is reported is what was committed.
export const showCost = Effect.fn("eva.print.cost")(function* (ctx: CommandContext) {
  const transcript = yield* Effect.scoped(ctx.api.attach(ctx.session))
  ctx.write(`${costLine(transcript.cost(), transcript.messages().length > 0)}\n`)
})

export const print = define({
  id: PRINT_SURFACE,
  effect: Effect.fn("eva.print")(function* (ctx) {
    // A surface that cannot ask a person declares it, and the tool gate
    // turns every ask into a rejection rather than hanging.
    yield* ctx.surface.transform((draft) => {
      draft.set({ id: PRINT_SURFACE, interactive: false, streaming: true, images: false })
    })

    // `eva.commands` names this command; the formatter it needs lives here,
    // so this plugin supplies what it does. A build without `eva.commands`
    // has no row to supply, and `/cost` is absent rather than described by
    // nothing.
    yield* ctx.command.transform((draft) => {
      draft.update("cost", (row) => {
        row.run = showCost
      })
    })
  }),
})
