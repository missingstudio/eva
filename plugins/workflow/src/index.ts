import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { readWorkflow } from "./document.js"
import { makeWorkflowHarness } from "./harness.js"
import { REPAIR_TEMPLATE, REPAIR_TEMPLATE_ID } from "./repair.js"

export * from "./document.js"
export * from "./harness.js"
export * from "./reference.js"
export * from "./repair.js"

// The entries also arrive from `.eva/workflows/*.yaml` through the kernel's
// resource discovery, keyed by the file's base name exactly as themes are,
// so trust gating, `originOf` and the layer chain all come for free and this
// plugin opens no file.
const KEYS = declare({ workflows: "mapping" })

// The ceiling on Repairs per Step. Zero means judge and never repair, and a
// Step may override it per Step.
const OPTIONS = declare({ repairs: "number" })

export const workflow = define({
  id: "eva.workflow",
  reads: KEYS.shapes,
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.workflow")(function* (ctx) {
    const repairs = OPTIONS.read(ctx.options, "repairs", 1)
    const documents = Object.entries(KEYS.read(yield* ctx.config, "workflows", {})).map(
      ([id, raw]) => readWorkflow(id, raw),
    )

    // The built-in repair Template, as a prompt row so a person replaces it
    // by config. This plugin loads after `eva.prompt`, so the person's row
    // is already there on replay and an absent one is what the built-in fills.
    yield* ctx.prompt.transform((draft) => {
      if (draft.get(REPAIR_TEMPLATE_ID) === undefined) {
        draft.set({ id: REPAIR_TEMPLATE_ID, text: REPAIR_TEMPLATE })
      }
    })

    if (documents.length === 0) return

    // One row per Workflow found, each carrying `open`. A document that
    // failed the load pass still registers: the Run it opens refuses with
    // every problem named, which puts the refusal in the Trace.
    yield* ctx.harness.transform((draft) => {
      for (const document of documents) {
        draft.set({
          id: document.id,
          name: document.name,
          open: (host) =>
            Effect.sync(() =>
              makeWorkflowHarness(host, {
                document,
                prompts: ctx.prompt.get,
                catalog: ctx.catalog.get,
                validator: ctx.slot.validator.peek,
                budget: ctx.slot.budget.peek,
                repairs,
              }),
            ),
        })
      }
    })
  }),
})
