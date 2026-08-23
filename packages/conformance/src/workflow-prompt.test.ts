import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { openRow, scripted, withKernel } from "@missingstudio/eva-testkit"
import { prompt } from "@missingstudio/eva-prompt"
import { REPAIR_TEMPLATE_ID, workflow } from "@missingstudio/eva-workflow"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

const SESSION = sessionID("sess_workflow_prompt")

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

// The Catalog must hold the model a Step names, or the Workflow refuses
// before any model call — which is exactly what these suites prove.
const fakeCatalog = define({
  id: "test.catalog.fake",
  effect: Effect.fn("test.catalog.fake")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      draft.model.update("fake", "model", () => {})
    })
  }),
})

const WORKFLOWS = {
  notes: {
    name: "Notes",
    model: "fake/model",
    steps: [{ id: "summarize", template: "summarize", with: { changelog: "input" } }],
  },
}

/**
 * `eva.prompt` and `eva.workflow` only meet in a build: the Workflow names a
 * Template and the prompt plugin is what makes it a row. A Step refuses when
 * the row is absent and fills when it is there, so the load-order dependence
 * — the build must carry `eva.prompt` for a Workflow to run — is proved here
 * rather than assumed.
 */
describe("a Workflow over the prompt domain", () => {
  it("fills a Step's Instruction from the row eva.prompt projected", async () => {
    const fake = scripted([{ payloads: [text("answered")] }])
    const found = await withKernel(
      [fakeCatalog, fake.plugin, prompt, workflow],
      (kernel, scope) =>
        Effect.gen(function* () {
          const { harness, said } = yield* openRow(kernel, scope, "notes", SESSION)
          const reason = yield* harness.prompt(SESSION, { kind: "prompt", text: "THE CHANGES" })
          return { reason, said: said() }
        }),
      {
        config: {
          prompts: { summarize: { text: "Summarize: {{changelog}}" } },
          workflows: WORKFLOWS,
        },
      },
    )

    expect(found.reason).toBe("end_turn")
    expect(fake.seen()).toHaveLength(1)
    const sent = fake.seen()[0]?.messages.at(-1)?.blocks[0]
    expect(sent?.type === "content" && sent.content.type === "text" && sent.content.text).toBe(
      "Summarize: THE CHANGES",
    )
    expect(found.said.some((one) => one.kind === "started")).toBe(true)
    const finished = found.said.find((one) => one.kind === "finished")
    expect(finished?.kind === "finished" && finished.claim.result).toBe("done")
  })

  // The same config without eva.prompt loaded: the row never exists, so the
  // Step refuses before any model call and names what is missing.
  it("refuses the Step when nothing projected the Template row", async () => {
    const fake = scripted([{ payloads: [text("never")] }])
    const found = await withKernel(
      [fakeCatalog, fake.plugin, workflow],
      (kernel, scope) =>
        Effect.gen(function* () {
          const { harness, said } = yield* openRow(kernel, scope, "notes", SESSION)
          const reason = yield* harness.prompt(SESSION, { kind: "prompt", text: "THE CHANGES" })
          return { reason, said: said() }
        }),
      {
        config: {
          prompts: { summarize: { text: "Summarize: {{changelog}}" } },
          workflows: WORKFLOWS,
        },
      },
    )

    expect(found.reason).toBe("end_turn")
    expect(fake.seen()).toHaveLength(0)
    const finished = found.said.find((one) => one.kind === "finished")
    expect(finished?.kind === "finished" && finished.claim.result).toBe("failed")
    expect(finished?.kind === "finished" && finished.claim.summary).toContain(
      "no Template is summarize",
    )
  })

  // The built-in repair Template is a prompt row, and a `prompts` entry with
  // the same id replaces its text — through eva.prompt, which is the whole
  // point of the domain being shared. eva.workflow loads after eva.prompt,
  // so it fills only a row the person left empty.
  it("keeps a prompts entry with the built-in repair Template's id", async () => {
    const row = await withKernel(
      [fakeCatalog, scripted([{ payloads: [text("x")] }]).plugin, prompt, workflow],
      (kernel) =>
        Effect.map(kernel.domains.prompt.get, (rows) =>
          rows.find((one) => one.id === REPAIR_TEMPLATE_ID),
        ),
      {
        config: {
          prompts: { [REPAIR_TEMPLATE_ID]: { text: "My own repair: {{faults}}" } },
          workflows: WORKFLOWS,
        },
      },
    )

    expect(row?.text).toBe("My own repair: {{faults}}")
  })
})
