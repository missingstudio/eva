import { define } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { REPAIR_TEMPLATE, REPAIR_TEMPLATE_ID, workflow } from "./index.js"

// A person's own row, registered the way `eva.prompt` projects one. The real
// join with that plugin is a conformance suite, because a plugin test may
// not import another plugin.
const person = define({
  id: "test.person",
  effect: Effect.fn("test.person")(function* (ctx) {
    yield* ctx.prompt.transform((draft) => {
      draft.set({ id: REPAIR_TEMPLATE_ID, text: "My own repair: {{faults}}" })
    })
  }),
})

const WORKFLOWS = {
  "release-notes": {
    name: "Release notes",
    steps: [{ id: "summarize", template: "release/summarize", with: { changelog: "input" } }],
  },
  "commit-msg": {
    steps: [{ id: "subject", template: "commit/subject" }],
  },
}

describe("the workflow plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(workflow.id).toBe("eva.workflow")
  })

  it("writes one harness row per workflows key, each with open", async () => {
    const rows = await withPlugin(workflow, (kernel) => kernel.domains.harness.get, {
      config: { workflows: WORKFLOWS },
    })

    expect(rows.map((row) => row.id)).toEqual(["release-notes", "commit-msg"])
    expect(rows.map((row) => row.name)).toEqual(["Release notes", "commit-msg"])
    for (const row of rows) expect(row.open).toBeTypeOf("function")
  })

  // The refusal belongs in the Trace, so a broken file is a row that opens
  // and refuses rather than a row that never appears.
  it("still registers a row for a malformed Workflow", async () => {
    const rows = await withPlugin(workflow, (kernel) => kernel.domains.harness.get, {
      config: { workflows: { broken: { steps: [] } } },
    })

    expect(rows.map((row) => row.id)).toEqual(["broken"])
    expect(rows[0]?.open).toBeTypeOf("function")
  })

  it("registers no harness row when config holds no workflows", async () => {
    const rows = await withPlugin(workflow, (kernel) => kernel.domains.harness.get)

    expect(rows).toEqual([])
  })

  // A transform replays on every rebuild, so one that appended rather than
  // updating would double the rows the second time round.
  it("replays without doubling its rows", async () => {
    const counted = await withPlugin(
      workflow,
      (kernel) =>
        Effect.gen(function* () {
          yield* kernel.domains.harness.reload
          return {
            harnesses: (yield* kernel.domains.harness.get).length,
            prompts: (yield* kernel.domains.prompt.get).length,
          }
        }),
      { config: { workflows: WORKFLOWS } },
    )

    expect(counted.harnesses).toBe(2)
    expect(counted.prompts).toBe(1)
  })

  it("registers the built-in repair Template as a prompt row", async () => {
    const row = await withPlugin(workflow, (kernel) =>
      Effect.map(kernel.domains.prompt.get, (rows) =>
        rows.find((one) => one.id === REPAIR_TEMPLATE_ID),
      ),
    )

    expect(row?.text).toBe(REPAIR_TEMPLATE)
  })

  // The whole point of the domain being shared: the person's row wins.
  it("keeps a row with the same id over the built-in text", async () => {
    const row = await withPlugin(
      workflow,
      (kernel) =>
        Effect.map(kernel.domains.prompt.get, (rows) =>
          rows.find((one) => one.id === REPAIR_TEMPLATE_ID),
        ),
      { before: [person] },
    )

    expect(row?.text).toBe("My own repair: {{faults}}")
  })
})
