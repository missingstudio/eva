import { define } from "@missingstudio/eva-sdk"
import { withKernel, withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { harnessLoop } from "./index.js"
import { LOOP_HARNESS_ID } from "./harness.js"
import { LOOP_TEMPLATE, LOOP_TEMPLATE_ID } from "./prompt.js"

const rows = () =>
  withPlugin(harnessLoop, (kernel) =>
    Effect.gen(function* () {
      return {
        harnesses: yield* kernel.domains.harness.get,
        prompts: yield* kernel.domains.prompt.get,
      }
    }),
  )

describe("the plugin", () => {
  it("registers one runnable harness row", async () => {
    const found = await rows()
    const row = found.harnesses.find((one) => one.id === LOOP_HARNESS_ID)

    expect(row?.name).toBe("eva")
    // A row is a factory, so what makes it runnable is `open`.
    expect(row?.open).toBeDefined()
  })

  it("seeds its own system Template", async () => {
    const found = await rows()
    expect(found.prompts.find((one) => one.id === LOOP_TEMPLATE_ID)?.text).toBe(LOOP_TEMPLATE)
  })

  // A row already holding the id wins the replay, so a build that carries a
  // system prompt of its own keeps it.
  it("leaves a Template another plugin already registered alone", async () => {
    const mine = define({
      id: "test.prompt.mine",
      effect: Effect.fn("test.prompt.mine")(function* (ctx) {
        yield* ctx.prompt.transform((draft) => {
          draft.set({ id: LOOP_TEMPLATE_ID, text: "mine" })
        })
      }),
    })
    const kept = await withKernel([mine, harnessLoop], (kernel) => kernel.domains.prompt.get)

    expect(kept.find((one) => one.id === LOOP_TEMPLATE_ID)?.text).toBe("mine")
  })
})
