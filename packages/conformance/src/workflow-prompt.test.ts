import {
  providerTurn,
  type Harness,
  type Provider,
  type ProviderRequest,
} from "@missingstudio/eva-core"
import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { providing } from "@missingstudio/eva-testkit"
import { prompt } from "@missingstudio/eva-prompt"
import { REPAIR_TEMPLATE_ID, workflow } from "@missingstudio/eva-workflow"
import { Effect, Exit, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, harnessHost, type Kernel } from "@missingstudio/eva-boot"

const SESSION = sessionID("sess_workflow_prompt")

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const scripted = (script: readonly (readonly Payload[])[], seen: ProviderRequest[]): Provider => {
  let served = 0
  return {
    id: "eva.provider.fake",
    available: () => true,
    turn: (request) => {
      seen.push(request)
      const payloads = script[Math.min(served, script.length - 1)] ?? []
      served += 1
      return providerTurn(Stream.fromIterable(payloads), "end_turn")
    },
  }
}

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

interface Opened {
  readonly harness: Harness
  readonly said: () => readonly Payload[]
}

// The row, opened over a live kernel with boot's own HarnessHost — the same
// host `SessionAPI.submit` hands one.
const opened = (kernel: Kernel, scope: Scope.Scope, id: string): Effect.Effect<Opened> =>
  Effect.gen(function* () {
    const rows = yield* kernel.domains.harness.get
    const row = rows.find((one) => one.id === id)
    if (row?.open === undefined) throw new Error(`no runnable harness row ${id}`)
    const said: Payload[] = []
    const emit = (payload: Payload) => Effect.sync(() => void said.push(payload))
    const harness = yield* Effect.provideService(
      row.open(harnessHost(kernel, SESSION, emit)),
      Scope.Scope,
      scope,
    )
    return { harness, said: () => said }
  })

const withKernel = <A>(
  plugins: readonly Plugin[],
  config: Record<string, unknown>,
  body: (kernel: Kernel, scope: Scope.Scope) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: plugins.map((one) => ({ id: one.id })),
        build: buildOf([...plugins]),
        config,
      })
      const result = yield* body(kernel, scope)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

/**
 * `eva.prompt` and `eva.workflow` only meet in a build: the Workflow names a
 * Template and the prompt plugin is what makes it a row. A Step refuses when
 * the row is absent and fills when it is there, so the load-order dependence
 * — the build must carry `eva.prompt` for a Workflow to run — is proved here
 * rather than assumed.
 */
describe("a Workflow over the prompt domain", () => {
  it("fills a Step's Instruction from the row eva.prompt projected", async () => {
    const seen: ProviderRequest[] = []
    const found = await withKernel(
      [fakeCatalog, providing(scripted([[text("answered")]], seen)), prompt, workflow],
      {
        prompts: { summarize: { text: "Summarize: {{changelog}}" } },
        workflows: WORKFLOWS,
      },
      (kernel, scope) =>
        Effect.gen(function* () {
          const { harness, said } = yield* opened(kernel, scope, "notes")
          const reason = yield* harness.prompt(SESSION, { kind: "prompt", text: "THE CHANGES" })
          return { reason, said: said() }
        }),
    )

    expect(found.reason).toBe("end_turn")
    expect(seen).toHaveLength(1)
    const sent = seen[0]?.messages.at(-1)?.blocks[0]
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
    const seen: ProviderRequest[] = []
    const found = await withKernel(
      [fakeCatalog, providing(scripted([[text("never")]], seen)), workflow],
      {
        prompts: { summarize: { text: "Summarize: {{changelog}}" } },
        workflows: WORKFLOWS,
      },
      (kernel, scope) =>
        Effect.gen(function* () {
          const { harness, said } = yield* opened(kernel, scope, "notes")
          const reason = yield* harness.prompt(SESSION, { kind: "prompt", text: "THE CHANGES" })
          return { reason, said: said() }
        }),
    )

    expect(found.reason).toBe("end_turn")
    expect(seen).toHaveLength(0)
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
      [fakeCatalog, providing(scripted([[text("x")]], [])), prompt, workflow],
      {
        prompts: { [REPAIR_TEMPLATE_ID]: { text: "My own repair: {{faults}}" } },
        workflows: WORKFLOWS,
      },
      (kernel) =>
        Effect.map(kernel.domains.prompt.get, (rows) =>
          rows.find((one) => one.id === REPAIR_TEMPLATE_ID),
        ),
    )

    expect(row?.text).toBe("My own repair: {{faults}}")
  })
})
