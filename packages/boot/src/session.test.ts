import {
  providerTurn,
  type Harness,
  type HarnessHost,
  type ModelRef,
  type Provider,
  type Recorder,
  type SubmitInput,
} from "@missingstudio/eva-core"
import {
  runID,
  sessionID,
  type Claim,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import type { HarnessInfo, Plugin } from "@missingstudio/eva-sdk"
import { Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, type Kernel } from "./boot.js"
import { harnessHost, makeSessionAPI, runTurn } from "./session.js"

const MODEL: ModelRef = { provider: "anthropic", model: "claude-sonnet-4-5" }

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

interface FakeRecorder extends Recorder {
  readonly groups: Payload[][]
  readonly closed: Claim[]
  readonly opened: SessionID[]
}

const fakeRecorder = (): FakeRecorder => {
  const groups: Payload[][] = []
  const closed: Claim[] = []
  const opened: SessionID[] = []
  return {
    groups,
    closed,
    opened,
    open: (session) => Effect.sync(() => (opened.push(session), runID(`run_of_${session}`))),
    commit: (payloads) => Effect.sync(() => void groups.push([...payloads])),
    close: (claim) => Effect.sync(() => void closed.push(claim)),
  }
}

// A Provider that counts what reached it, so a test can say a Run happened
// once rather than trusting that it happened at all.
const countingProvider = (calls: { count: number }, said = "answered"): Provider => ({
  id: "eva.provider.counting",
  available: () => true,
  turn: () => {
    calls.count += 1
    return providerTurn(Stream.fromIterable([text(said)]), "end_turn")
  },
})

const providerPlugin = (provider: Provider): Plugin => ({
  id: "acme.provider",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider["model.resolve"]((event) =>
      Effect.sync(() => event.resolve({ model: event.reference, provider })),
    )
  }),
})

const harnessPlugin = (row: HarnessInfo): Plugin => ({
  id: "acme.harness",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.harness.transform((draft) => draft.set(row))
  }),
})

/**
 * A Harness that records what it was handed and takes one Run through the
 * host. It is the whole of what plan 006's Workflow will do, in six lines.
 */
const spyHarness = (
  seen: { opens: number; prompts: SubmitInput[]; text: string[] },
  host: HarnessHost,
): Harness => ({
  id: "acme.spy",
  capabilities: {} as Harness["capabilities"],
  initialize: () => Effect.succeed({} as Harness["capabilities"]),
  createSession: (_cwd: string) => Effect.succeed(sessionID("sess_spy")),
  resumeSession: () => Effect.succeed({ kind: "undetectable" as const }),
  prompt: Effect.fn(function* (id: SessionID, input: SubmitInput) {
    seen.prompts.push(input)
    const run = yield* host.run({
      session: id,
      spec: { intent: input.text },
      model: MODEL,
      history: [],
    })
    seen.text.push(run.text)
    return "end_turn" as const
  }),
  cancel: () => Effect.void,
  // A native harness has no wire, so there is nothing to stream.
  updates: Stream.empty,
})

interface Wiring {
  readonly kernel: Kernel
  readonly recorder: FakeRecorder
  readonly calls: { count: number }
}

const wired = <A>(
  options: { readonly harness?: HarnessInfo; readonly recorder?: boolean },
  body: (wiring: Wiring, scope: Scope.Scope) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const calls = { count: 0 }
      const carried: Plugin[] = [providerPlugin(countingProvider(calls))]
      if (options.harness !== undefined) carried.push(harnessPlugin(options.harness))

      const kernel = yield* boot({
        scope,
        resolved: carried.map((plugin) => ({ id: plugin.id })),
        build: buildOf(carried),
      })

      const recorder = fakeRecorder()
      if (options.recorder !== false) {
        yield* Effect.provideService(
          kernel.slot.recorder.provide("acme.recorder", recorder),
          Scope.Scope,
          scope,
        )
      }

      const answer = yield* body({ kernel, recorder, calls }, scope)
      yield* Scope.close(scope, Exit.void)
      return answer
    }),
  )

// Every payload one Session saw, collected off the API's own stream rather
// than a hand-built emit, so the route under test is the one a surface uses.
const watched = (
  wiring: Wiring,
  scope: Scope.Scope,
  input: SubmitInput,
): Effect.Effect<readonly Payload[]> =>
  Effect.gen(function* () {
    const api = yield* makeSessionAPI(wiring.kernel, MODEL, scope)
    const session = yield* api.session.create(".")
    const seen: Payload[] = []
    const watching = yield* Effect.forkChild(
      api.session
        .watch(session)
        .pipe(Stream.runForEach((one) => Effect.sync(() => void seen.push(one)))),
    )
    yield* Effect.yieldNow
    yield* api.session.submit(session, input)
    yield* Effect.yieldNow
    yield* Fiber.interrupt(watching)
    return seen
  })

const summaryOf = (payloads: readonly Payload[]): string | undefined => {
  const last = payloads.findLast((one) => one.kind === "finished")
  return last?.kind === "finished" ? last.claim.summary : undefined
}

describe("a Prompt with no harness", () => {
  // The regression guard: `--print` and the Console take this path, and this
  // plan must not move them.
  it("runs against the resolved model, as it always has", async () => {
    const seen = await wired({}, (wiring, scope) =>
      Effect.map(watched(wiring, scope, { kind: "prompt", text: "hello" }), (payloads) => ({
        kinds: payloads.map((one) => one.kind),
        calls: wiring.calls.count,
        closed: wiring.recorder.closed,
      })),
    )

    expect(seen.kinds).toEqual(["started", "text", "finished"])
    expect(seen.calls).toBe(1)
    expect(seen.closed).toEqual([{ result: "done", summary: "answered" }])
  })
})

describe("a Prompt that names a harness", () => {
  it("opens the row once and hands its Harness the Prompt", async () => {
    const seen = { opens: 0, prompts: [] as SubmitInput[], text: [] as string[] }
    const row: HarnessInfo = {
      id: "acme.spy",
      name: "Spy",
      open: (host) =>
        Effect.sync(() => {
          seen.opens += 1
          return spyHarness(seen, host)
        }),
    }

    const calls = await wired({ harness: row }, (wiring, scope) =>
      Effect.map(
        watched(wiring, scope, { kind: "prompt", text: "judge this", harness: "acme.spy" }),
        () => wiring.calls.count,
      ),
    )

    expect(seen.opens).toBe(1)
    expect(seen.prompts).toEqual([{ kind: "prompt", text: "judge this", harness: "acme.spy" }])
    // The Harness took its Run through the host, so the Provider was reached
    // once and the answer came back on `RunResult.text`.
    expect(calls).toBe(1)
    expect(seen.text).toEqual(["answered"])
  })

  it("refuses an id that names no row, names a near miss, and resolves no model", async () => {
    const row: HarnessInfo = { id: "acme.spy", name: "Spy", open: () => Effect.die("unreachable") }
    const seen = await wired({ harness: row }, (wiring, scope) =>
      Effect.map(
        watched(wiring, scope, { kind: "prompt", text: "hello", harness: "acme.spi" }),
        (payloads) => ({
          summary: summaryOf(payloads),
          kinds: payloads.map((one) => one.kind),
          calls: wiring.calls.count,
          closed: wiring.recorder.closed,
        }),
      ),
    )

    expect(seen.summary).toBe("no harness answers acme.spi, did you mean acme.spy")
    expect(seen.kinds).toEqual(["started", "finished"])
    expect(seen.calls).toBe(0)
    expect(seen.closed).toEqual([
      {
        result: "failed",
        summary: "no harness answers acme.spi, did you mean acme.spy",
        errorClass: "other",
      },
    ])
  })

  it("refuses an id nothing is near without inventing a near miss", async () => {
    const row: HarnessInfo = { id: "acme.spy", name: "Spy", open: () => Effect.die("unreachable") }
    const summary = await wired({ harness: row }, (wiring, scope) =>
      Effect.map(
        watched(wiring, scope, { kind: "prompt", text: "hello", harness: "totally-elsewhere" }),
        summaryOf,
      ),
    )

    expect(summary).toBe("no harness answers totally-elsewhere")
  })

  // A row without `open` names a harness the build knows of and cannot run.
  // Saying "no such harness" for it would ask a person to correct a spelling
  // that is already correct.
  it("refuses a row that cannot run, and says the build knows it", async () => {
    const seen = await wired({ harness: { id: "acme.named", name: "Named" } }, (wiring, scope) =>
      Effect.map(
        watched(wiring, scope, { kind: "prompt", text: "hello", harness: "acme.named" }),
        (payloads) => ({ summary: summaryOf(payloads), calls: wiring.calls.count }),
      ),
    )

    expect(seen.summary).toBe("harness acme.named is registered and cannot run")
    expect(seen.calls).toBe(0)
  })

  // A refusal is a Run a person can read back, so it opens one too.
  it("records the refusal as a Run of its own", async () => {
    const opened = await wired({ harness: { id: "acme.named", name: "Named" } }, (wiring, scope) =>
      Effect.map(
        watched(wiring, scope, { kind: "prompt", text: "the intent", harness: "acme.named" }),
        () => ({
          opened: wiring.recorder.opened.length,
          committed: wiring.recorder.groups.flat(),
        }),
      ),
    )

    expect(opened.opened).toBe(1)
    expect(opened.committed).toEqual([{ kind: "started", intent: "the intent" }])
  })

  // A refusal that could not record marks itself Degraded, the same way
  // `submit` does, so a reader is never told a Run was recorded when it was not.
  it("refuses without a Recorder, and marks itself degraded", async () => {
    const seen = await wired(
      { harness: { id: "acme.named", name: "Named" }, recorder: false },
      (wiring, scope) =>
        Effect.map(
          watched(wiring, scope, { kind: "prompt", text: "hello", harness: "acme.named" }),
          (payloads) => ({
            summary: summaryOf(payloads),
            payloads,
            groups: wiring.recorder.groups,
          }),
        ),
    )

    expect(seen.summary).toBe("harness acme.named is registered and cannot run")
    expect(seen.payloads).toContainEqual({ kind: "degraded", missing: ["Recorder"] })
    expect(seen.groups).toEqual([])
  })
})

describe("harnessHost", () => {
  // One spelling for a Run. Two would drift, and the drift would be silent.
  it("reaches the same submit runTurn reaches", async () => {
    const counts = await wired({}, (wiring) =>
      Effect.gen(function* () {
        const said: Payload[] = []
        const emit = (payload: Payload) => Effect.sync(() => void said.push(payload))
        const session = sessionID("sess_1")

        const viaTurn = yield* runTurn(wiring.kernel, {
          session,
          model: MODEL,
          prompt: "one",
          history: [],
          emit,
        })
        const viaHost = yield* harnessHost(wiring.kernel, session, emit).run({
          session,
          spec: { intent: "two" },
          model: MODEL,
          history: [],
        })

        return { calls: wiring.calls.count, viaTurn: viaTurn.text, viaHost: viaHost.text }
      }),
    )

    expect(counts.calls).toBe(2)
    expect(counts.viaTurn).toBe("answered")
    expect(counts.viaHost).toBe("answered")
  })

  it("emits every payload of a group and commits it", async () => {
    const seen = await wired({}, (wiring) =>
      Effect.gen(function* () {
        const said: Payload[] = []
        const group: readonly Payload[] = [
          { kind: "verdict", step: "draft", attempt: 1, verdict: "valid", faults: [] },
          text("judged"),
        ]
        yield* harnessHost(wiring.kernel, sessionID("sess_report"), (payload) =>
          Effect.sync(() => void said.push(payload)),
        ).report(group)
        return { said, groups: wiring.recorder.groups }
      }),
    )

    expect(seen.said).toHaveLength(2)
    expect(seen.groups).toEqual([
      [
        { kind: "verdict", step: "draft", attempt: 1, verdict: "valid", faults: [] },
        text("judged"),
      ],
    ])
  })

  /**
   * The refusal a Harness reports before its first Run is a `started` and a
   * `finished`. It is a whole Run of its own, so the host records it through
   * the Recorder's open and close — a bare commit before the first Run has
   * no Run to land in, and the record would lose the refusal.
   */
  it("records a group that opens with started through open and close", async () => {
    const claim: Claim = { result: "failed", summary: "workflow w cannot run" }
    const seen = await wired({}, (wiring) =>
      Effect.gen(function* () {
        yield* harnessHost(wiring.kernel, sessionID("sess_refused"), () => Effect.void).report([
          { kind: "started", intent: "refuse me" },
          { kind: "finished", claim },
        ])
        return {
          opened: wiring.recorder.opened,
          groups: wiring.recorder.groups,
          closed: wiring.recorder.closed,
        }
      }),
    )

    expect(seen.opened).toEqual([sessionID("sess_refused")])
    expect(seen.groups).toEqual([[{ kind: "started", intent: "refuse me" }]])
    expect(seen.closed).toEqual([claim])
  })

  // Stage 0's exit test says disabling the trace plugin degrades rather than
  // crashing. This is that rule one level up.
  it("commits nothing and still emits when the Recorder slot is empty", async () => {
    const said = await wired({ recorder: false }, (wiring) =>
      Effect.gen(function* () {
        const seen: Payload[] = []
        yield* harnessHost(wiring.kernel, sessionID("sess_report"), (payload) =>
          Effect.sync(() => void seen.push(payload)),
        ).report([text("unrecorded")])
        return { seen, groups: wiring.recorder.groups }
      }),
    )

    expect(said.seen).toEqual([text("unrecorded")])
    expect(said.groups).toEqual([])
  })
})
