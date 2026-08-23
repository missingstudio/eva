import { define } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { prompt } from "./index.js"

/**
 * Through a live kernel, because the half that matters is the transform: a
 * plugin whose id is right and whose effect writes nothing looks identical
 * from outside until something reads the domain.
 */
describe("the prompt plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(prompt.id).toBe("eva.prompt")
  })

  it("holds exactly the rows config named", async () => {
    const rows = await withPlugin(prompt, (kernel) => kernel.domains.prompt.get, {
      config: { prompts: { "commit-msg": { text: "Write one line." }, x: { text: 5 } } },
    })

    expect(rows).toEqual([{ id: "commit-msg", text: "Write one line." }])
  })

  // A transform replays on every rebuild, so one that appended rather than
  // updating would double the rows the second time round.
  it("replays without doubling its rows", async () => {
    const rows = await withPlugin(
      prompt,
      (kernel) =>
        Effect.gen(function* () {
          yield* kernel.domains.prompt.reload
          return (yield* kernel.domains.prompt.get).length
        }),
      { config: { prompts: { "commit-msg": { text: "Write one line." } } } },
    )

    expect(rows).toBe(1)
  })

  // Same-id replace keeping the position is the tree's rule, and it is what
  // loading after every plugin that seeds a built-in Template buys: the
  // person's config wins without reordering what a surface lists.
  it("replaces a seeded Template's text and keeps the row's position", async () => {
    const seeder = define({
      id: "test.seeder",
      effect: Effect.fn("test.seeder")(function* (ctx) {
        yield* ctx.prompt.transform((draft) => {
          draft.set({ id: "commit-msg", text: "seeded" })
          draft.set({ id: "release", text: "cut a release" })
        })
      }),
    })

    const rows = await withPlugin(prompt, (kernel) => kernel.domains.prompt.get, {
      before: [seeder],
      config: { prompts: { "commit-msg": { text: "from config" } } },
    })

    expect(rows).toEqual([
      { id: "commit-msg", text: "from config" },
      { id: "release", text: "cut a release" },
    ])
  })
})
