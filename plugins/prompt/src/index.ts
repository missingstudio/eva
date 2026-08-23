import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { project } from "./project.js"

export * from "./project.js"

// Declared beside this plugin's own id, the way `eva.tui` declares `theme`.
// The entries also arrive from `.eva/prompts/*.md` through the kernel's
// resource discovery, so trust gating and the layer chain come for free and
// this plugin opens no file.
const KEYS = declare({ prompts: "mapping" })

export const prompt = define({
  id: "eva.prompt",
  reads: KEYS.shapes,
  effect: Effect.fn("eva.prompt")(function* (ctx) {
    const rows = project(KEYS.read(yield* ctx.config, "prompts", {}))
    if (rows.length === 0) return

    yield* ctx.prompt.transform((draft) => {
      for (const row of rows) draft.set(row)
    })
  }),
})
