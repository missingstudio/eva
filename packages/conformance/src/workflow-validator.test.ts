import { providerTurn, type Provider, type ProviderRequest } from "@missingstudio/eva-core"
import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { providing } from "@missingstudio/eva-testkit"
import { prompt } from "@missingstudio/eva-prompt"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory, type MemorySink } from "@missingstudio/eva-trace-memory"
import { validator } from "@missingstudio/eva-validator"
import { workflow } from "@missingstudio/eva-workflow"
import { Cause, Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, harnessHost, type Kernel } from "@missingstudio/eva-boot"

const SESSION = sessionID("sess_workflow_validator")

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const fakeCatalog = define({
  id: "test.catalog.fake",
  effect: Effect.fn("test.catalog.fake")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      draft.model.update("fake", "model", () => {})
    })
  }),
})

const SCHEMA = {
  type: "object",
  required: ["entries"],
  properties: { entries: { type: "array", items: { type: "string" } } },
}

const CONFIG = {
  prompts: { summarize: { text: "Summarize: {{changelog}}" } },
  workflows: {
    notes: {
      name: "Notes",
      model: "fake/model",
      steps: [
        { id: "summarize", template: "summarize", with: { changelog: "input" }, schema: SCHEMA },
      ],
    },
    grouped: {
      name: "Grouped",
      model: "fake/model",
      steps: [
        { id: "one", template: "summarize", with: { changelog: "input" }, schema: SCHEMA },
        { id: "two", template: "summarize", with: { changelog: "input" }, schema: SCHEMA },
      ],
    },
  },
}

const PLUGINS: readonly Plugin[] = [trace, traceMemory, fakeCatalog, prompt, validator, workflow]

interface Live {
  readonly kernel: Kernel
  readonly scope: Scope.Scope
  readonly said: readonly Payload[]
  readonly memory: () => readonly Payload[]
  readonly prompt: (id: string, input: string) => Effect.Effect<unknown>
  readonly promptFiber: (id: string, input: string) => Effect.Effect<Fiber.Fiber<unknown, unknown>>
}

// A live kernel with the record behind it, and the Workflow row opened over
// boot's own HarnessHost. The Provider is added by the body, so a test can
// close over the kernel — which is how one removes a plugin mid-Run.
const started = <A>(body: (live: Live) => Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: PLUGINS.map((one) => ({ id: one.id })),
        build: buildOf([...PLUGINS]),
        config: CONFIG,
      })
      const said: Payload[] = []
      const emit = (payload: Payload) => Effect.sync(() => void said.push(payload))

      const open = (id: string) =>
        Effect.gen(function* () {
          const rows = yield* kernel.domains.harness.get
          const row = rows.find((one) => one.id === id)
          if (row?.open === undefined) throw new Error(`no runnable harness row ${id}`)
          return yield* Effect.provideService(
            row.open(harnessHost(kernel, SESSION, emit)),
            Scope.Scope,
            scope,
          )
        })

      const memory = () =>
        Effect.runSync(
          Effect.map(kernel.slot.traceSink.get, (sink) =>
            (sink as MemorySink).all().map((event) => event.payload),
          ),
        )

      const result = yield* body({
        kernel,
        scope,
        said,
        memory,
        prompt: (id, input) =>
          Effect.flatMap(open(id), (harness) =>
            harness.prompt(SESSION, { kind: "prompt", text: input }),
          ),
        promptFiber: (id, input) =>
          Effect.flatMap(open(id), (harness) =>
            Effect.forkChild(harness.prompt(SESSION, { kind: "prompt", text: input })),
          ),
      })
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

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

const verdicts = (payloads: readonly Payload[]) => payloads.filter((one) => one.kind === "verdict")

describe("a refused Candidate over a live kernel", () => {
  it("repairs exactly once, and both Verdicts reach the record", async () => {
    const seen: ProviderRequest[] = []
    const found = await started((live) =>
      Effect.gen(function* () {
        yield* live.kernel.runtime.add(
          providing(scripted([[text('{"entries": 1}')], [text('{"entries":["a"]}')]], seen)),
        )
        yield* live.prompt("notes", "THE CHANGES")
        return live.memory()
      }),
    )

    expect(seen).toHaveLength(2)
    expect(verdicts(found)).toEqual([
      {
        kind: "verdict",
        step: "summarize",
        verdict: "invalid",
        attempt: 1,
        faults: [{ at: "/entries", wanted: "an array" }],
      },
      { kind: "verdict", step: "summarize", verdict: "valid", attempt: 2, faults: [] },
    ])
    // The Repair's Run carries the refused Candidate as the prior assistant
    // message, never inlined into a human one.
    const repair = seen[1]?.messages ?? []
    expect(repair.map((one) => one.author)).toEqual(["human", "agent", "human"])
  })

  // The capture anti-pattern, on the Validator: the slot is read at every
  // check, so removing the plugin mid-Run degrades the next check rather
  // than the one already answered.
  it("degrades the next check when the Validator plugin leaves mid-Run", async () => {
    const seen: ProviderRequest[] = []
    const found = await started((live) => {
      const provider: Provider = {
        id: "eva.provider.fake",
        available: () => true,
        turn: (request) => {
          seen.push(request)
          const gone = seen.length === 2
          return providerTurn(
            Stream.unwrap(
              // Between the first check and the second: the second Step's
              // Provider Turn is the only thing that runs there.
              (gone ? live.kernel.runtime.remove("eva.validator") : Effect.void).pipe(
                Effect.as(Stream.fromIterable([text('{"entries":["ok"]}')])),
              ),
            ),
            "end_turn",
          )
        },
      }
      return Effect.gen(function* () {
        yield* live.kernel.runtime.add(providing(provider))
        yield* live.prompt("grouped", "THE CHANGES")
        return live.memory()
      })
    })

    expect(verdicts(found)).toEqual([
      { kind: "verdict", step: "one", verdict: "valid", attempt: 1, faults: [] },
      { kind: "verdict", step: "two", verdict: "unchecked", attempt: 1, faults: [] },
    ])
    expect(found).toContainEqual({ kind: "degraded", missing: ["Validator"] })
  })
})

describe("a cancelled Workflow", () => {
  // A Run that never closed cannot be folded, and a Step loop inherits the
  // obligation from submit rather than reimplementing it.
  it("still closes, with the partial work committed", async () => {
    const found = await started((live) =>
      Effect.gen(function* () {
        yield* live.kernel.runtime.add(
          providing({
            id: "eva.provider.fake",
            available: () => true,
            turn: () => providerTurn(Stream.never),
          }),
        )
        const running = yield* live.promptFiber("notes", "THE CHANGES")

        // Wait for the Run to open on the record, then interrupt it.
        yield* Effect.gen(function* () {
          while (!live.memory().some((one) => one.kind === "started")) {
            yield* Effect.sleep(5)
          }
        })
        yield* Fiber.interrupt(running)
        const exit = yield* Fiber.await(running)
        return {
          memory: live.memory(),
          interrupted: Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        }
      }),
    )

    expect(found.interrupted).toBe(true)
    const finished = found.memory.find((one) => one.kind === "finished")
    expect(finished).toEqual({
      kind: "finished",
      claim: { result: "failed", summary: "cancelled", errorClass: "other" },
      stopReason: "cancelled",
    })
  })
})
