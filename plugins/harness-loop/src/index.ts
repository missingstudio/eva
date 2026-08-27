import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { LOOP_HARNESS_ID, makeLoopHarness } from "./harness.js"
import { LOOP_TEMPLATE, LOOP_TEMPLATE_ID } from "./prompt.js"

export * from "./harness.js"
export * from "./prompt.js"
export * from "./step.js"

/**
 * `steps` is the max-steps fuse: the ceiling on Steps in one Prompt. `repairs`
 * is the ceiling on consecutive Steps in which no proposed call could run.
 *
 * Neither is the Budget's. A Budget is one accumulator for the process and its
 * counters never reset, so a `steps` limit there bounds the whole run of Eva
 * and not one Prompt. Both stop a Prompt the same way, and they measure
 * different spans.
 */
const OPTIONS = declare({ steps: "number", repairs: "number" })

// Thirty-two Steps is a ceiling and not a target. A three-file refactor reads,
// greps, edits three times and re-reads, which is well inside it.
const DEFAULT_STEPS = 32

// Two malformed Steps in a row is enough to see the model is not recovering.
const DEFAULT_REPAIRS = 2

/**
 * Eva's own propose → act → observe loop: the harness domain's second row, and
 * the first with agency. One Step is one Run, so the tool calls a response
 * proposed run inside the Run that proposed them, through the same execution,
 * the same gate and the same permission mode every other caller uses.
 *
 * It holds no privileged position. It reads four things a foreign adapter can
 * also read — the tool rows, the prompt rows, the Catalog, the Budget — and it
 * is handed the same two-member `HarnessHost` the Workflow is handed.
 *
 * `architecture.md` §12.3a describes this plugin as a host of six extension
 * points of its own. It hosts none yet: what a host slot is for is a swap this
 * stage has no second implementation of, and five empty slots nobody fills is
 * scaffolding. Each of the six is a seam in `LoopDeps` today, so cutting one
 * later is a change here and not a rewrite.
 */
export const harnessLoop = define({
  id: LOOP_HARNESS_ID,
  takes: OPTIONS.shapes,
  effect: Effect.fn(LOOP_HARNESS_ID)(function* (ctx) {
    const steps = Math.max(1, OPTIONS.read(ctx.options, "steps", DEFAULT_STEPS))
    const repairs = Math.max(0, OPTIONS.read(ctx.options, "repairs", DEFAULT_REPAIRS))

    // The built-in system prompt, as a prompt row so a person replaces it by
    // config. An id a row already holds is left alone, so the person's row
    // wins on replay — the repair Template's rule.
    yield* ctx.prompt.transform((draft) => {
      if (draft.get(LOOP_TEMPLATE_ID) === undefined) {
        draft.set({ id: LOOP_TEMPLATE_ID, text: LOOP_TEMPLATE })
      }
    })

    // One row, and it is a factory: five Sessions of this kind are five
    // instances. Every dependency is handed over as the Effect that resolves
    // the current implementation, never a value read here.
    yield* ctx.harness.transform((draft) => {
      draft.set({
        id: LOOP_HARNESS_ID,
        name: "eva",
        open: (host) =>
          Effect.sync(() =>
            makeLoopHarness(host, {
              tools: ctx.tool.get,
              prompts: ctx.prompt.get,
              catalog: ctx.catalog.get,
              budget: ctx.slot.budget.peek,
              steps,
              repairs,
            }),
          ),
      })
    })
  }),
})
