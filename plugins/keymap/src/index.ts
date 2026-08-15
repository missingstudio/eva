import type { KeymapInfo } from "@missingstudio/eva-sdk"
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// Every binding here is one the surface acts on. A row whose command nothing
// answers is not shipped: registered-but-inert reads as working until a
// person presses it.
export const BINDINGS: readonly KeymapInfo[] = [
  { id: "submit", binding: "enter", command: "session.submit", surface: "eva.tui" },
  { id: "newline", binding: "shift+enter", command: "input.newline", surface: "eva.tui" },
  { id: "cancel", binding: "ctrl+c", command: "session.cancel", surface: "eva.tui" },
  { id: "quit", binding: "ctrl+d", command: "app.quit", surface: "eva.tui" },
  // One key, one meaning: step back. What it steps back from is the
  // surface's to decide, which is why one row covers all of them.
  { id: "back", binding: "escape", command: "surface.back", surface: "eva.tui" },
  { id: "palette", binding: "ctrl+k", command: "surface.palette", surface: "eva.tui" },
]

export const keymap = define({
  id: "eva.keymap",
  effect: Effect.fn("eva.keymap")(function* (ctx) {
    yield* ctx.keymap.transform((draft) => {
      for (const binding of BINDINGS) draft.set(binding)
    })
  }),
})
