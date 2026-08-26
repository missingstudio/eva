import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { makeNoSandbox } from "./sandbox.js"

export * from "./sandbox.js"

/**
 * Fills the `Sandbox` slot and contains nothing. The seam exists so a tool
 * asks for containment through one contract from its first day; the plugin
 * that answers with real limits is stage 4's, and it replaces this one whole.
 */
export const sandboxNone = define({
  id: "eva.sandbox.none",
  effect: Effect.fn("eva.sandbox.none")(function* (ctx) {
    yield* ctx.slot.sandbox.provide(ctx.id, makeNoSandbox(ctx.slot.shell.peek))
  }),
})
