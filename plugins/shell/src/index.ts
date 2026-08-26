import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { makeShell } from "./shell.js"

export * from "./shell.js"

/**
 * Fills the `Shell` slot: starts a process, streams its output while it
 * runs, and reports the exit. It contains nothing — containment is the
 * `Sandbox` slot's job, and a tool that wants it asks for it there.
 */
export const shell = define({
  id: "eva.shell",
  effect: Effect.fn("eva.shell")(function* (ctx) {
    yield* ctx.slot.shell.provide(ctx.id, makeShell())
  }),
})
