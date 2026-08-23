import { providerTurn, type Provider, type ProviderRequest } from "@missingstudio/eva-core"
import {
  sessionID,
  validityOf,
  verdictFold,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { openRow, providing, scripted } from "@missingstudio/eva-testkit"
import { prompt } from "@missingstudio/eva-prompt"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory, type MemorySink } from "@missingstudio/eva-trace-memory"
import { validator } from "@missingstudio/eva-validator"
import { workflow } from "@missingstudio/eva-workflow"
import { Cause, Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, type Kernel } from "@missingstudio/eva-boot"

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
  readonly events: () => readonly Event[]
  readonly memory: () => readonly Payload[]
  readonly prompt: (id: string, input: string) => Effect.Effect<unknown>
  readonly promptFiber: (id: string, input: string) => Effect.Effect<Fiber.Fiber<unknown, unknown>>
}

// A live kernel with the record behind it, and the Workflow row opened over
// boot's own HarnessHost. The Provider is added by the body, so a test can
// close over the kernel — which is how one removes a plugin mid-Run.
const started = <A>(
  body: (live: Live) => Effect.Effect<A>,
  plugins: readonly Plugin[] = PLUGINS,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: plugins.map((one) => ({ id: one.id })),
        build: buildOf([...plugins]),
        config: CONFIG,
      })
      const open = (id: string) =>
        Effect.map(openRow(kernel, scope, id, SESSION), (row) => row.harness)

      const events = () =>
        Effect.runSync(Effect.map(kernel.slot.traceSink.get, (sink) => (sink as MemorySink).all()))
      const memory = () => events().map((event) => event.payload)

      const result = yield* body({
        kernel,
        scope,
        events,
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

const verdicts = (payloads: readonly Payload[]) => payloads.filter((one) => one.kind === "verdict")

describe("a refused Candidate over a live kernel", () => {
  /**
   * The repair path end to end: eva.workflow, eva.validator and a Provider
   * meet only in a build. The Repair's message shape and ordering are proved
   * once against the fake HarnessHost in plugins/workflow, and the fake is
   * held to boot's real host by the contract test in harness-host.test.ts —
   * what needs the live kernel is the record itself, and the one fold the
   * measurement reads.
   */
  it("repairs exactly once, and both Verdicts reach the record", async () => {
    const fake = scripted([
      { payloads: [text('{"entries": 1}')] },
      { payloads: [text('{"entries":["a"]}')] },
    ])
    const found = await started((live) =>
      Effect.gen(function* () {
        yield* live.kernel.runtime.add(fake.plugin)
        yield* live.prompt("notes", "THE CHANGES")
        return live.events()
      }),
    )

    expect(fake.seen()).toHaveLength(2)
    const payloads = found.map((event) => event.payload)
    expect(verdicts(payloads)).toEqual([
      {
        kind: "verdict",
        step: "summarize",
        verdict: "invalid",
        attempt: 1,
        faults: [{ at: "/entries", wanted: "an array" }],
      },
      { kind: "verdict", step: "summarize", verdict: "valid", attempt: 2, faults: [] },
    ])

    // The repaired answer commits: the Workflow's last Run closes done.
    const finished = payloads.filter((one) => one.kind === "finished")
    expect(finished.at(-1)?.claim.result).toBe("done")

    // One fold, the one the measurement reads.
    const summary = verdictFold(found)
    expect(summary).toEqual({
      firstPass: 1,
      firstPassValid: 0,
      settledValid: 1,
      unchecked: 0,
      held: 0,
    })
  })

  // The empty slot from the first check: a build with no Validator degrades
  // every Candidate and can never report a rate at all.
  it("yields unchecked, degraded and no rate when the build holds no Validator", async () => {
    const fake = scripted([{ payloads: [text('{"entries":["ok"]}')] }])
    const found = await started(
      (live) =>
        Effect.gen(function* () {
          yield* live.kernel.runtime.add(fake.plugin)
          yield* live.prompt("notes", "THE CHANGES")
          return live.events()
        }),
      PLUGINS.filter((one) => one.id !== "eva.validator"),
    )

    const payloads = found.map((event) => event.payload)
    expect(verdicts(payloads)).toEqual([
      { kind: "verdict", step: "summarize", verdict: "unchecked", attempt: 1, faults: [] },
    ])
    expect(payloads).toContainEqual({ kind: "degraded", missing: ["Validator"] })

    const summary = verdictFold(found)
    expect(summary).toEqual({
      firstPass: 0,
      firstPassValid: 0,
      settledValid: 0,
      unchecked: 1,
      held: 1,
    })
    expect(validityOf(summary)).toEqual({ kind: "none" })
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
