import type {
  Budget,
  CalledTool,
  HarnessHost,
  RunResult,
  SubmitInput,
  ToolInfo,
} from "@missingstudio/eva-core"
import { sessionID, type Disposition, type SessionID } from "@missingstudio/eva-schema"
import type { CatalogState } from "@missingstudio/eva-sdk"
import { scriptedHost, type ScriptedHost } from "@missingstudio/eva-testkit"
import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { makeLoopHarness, type LoopDeps } from "./harness.js"
import { LOOP_TEMPLATE, LOOP_TEMPLATE_ID } from "./prompt.js"

const SESSION: SessionID = sessionID("sess_loop")

const DONE = { result: "done", summary: "answered" } as const

const CATALOG: CatalogState = {
  providers: new Map(),
  models: new Map(),
  default: { provider: "fake", model: "model" },
}

const READ: ToolInfo = {
  id: "read",
  description: "reads a file",
  kind: "read",
  input: {},
  execute: () => Effect.succeed({ disposition: "ok", content: [] }),
}

const called = (name: string, disposition: Disposition, said = ""): CalledTool => ({
  call: { id: `call_${name}`, name, args: { path: "one.md" } },
  result: { disposition, content: said === "" ? [] : [{ type: "text", text: said }] },
})

// A Step that proposed one call, and what the call answered.
const acting = (name: string, disposition: Disposition, said = ""): Partial<RunResult> => ({
  text: "working",
  calls: [called(name, disposition, said)],
})

// A Step that proposed nothing, which is the answer.
const answering = (text: string): Partial<RunResult> => ({ text, calls: [] })

const exhausted = (limit: "tokens" | "steps"): Budget => {
  const state = {
    tokens: 0,
    spend: { kind: "none" } as const,
    milliseconds: 0,
    steps: 0,
    limits: {},
  }
  return {
    charge: () => Effect.succeed(state),
    state: Effect.succeed(state),
    check: Effect.succeed({ kind: "exhausted", limit }),
  }
}

const loop = (host: HarnessHost, over: Partial<LoopDeps> = {}) =>
  makeLoopHarness(host, {
    tools: Effect.succeed([READ]),
    prompts: Effect.succeed([{ id: LOOP_TEMPLATE_ID, text: LOOP_TEMPLATE }]),
    catalog: Effect.succeed(CATALOG),
    budget: Effect.succeed(undefined),
    steps: 4,
    malformedSteps: 1,
    ...over,
  })

const prompting = (
  script: readonly Partial<RunResult>[],
  over: Partial<LoopDeps> = {},
  text = "rename UserSvc",
): Promise<{ readonly reason: string; readonly watched: ScriptedHost }> => {
  const watched = scriptedHost(script)
  return Effect.runPromise(
    Effect.map(loop(watched.host, over).prompt(SESSION, { kind: "prompt", text }), (reason) => ({
      reason,
      watched,
    })),
  )
}

// What a refusal the loop wrote says, read off the group it reported.
const refusal = (watched: ScriptedHost) => {
  const reported = watched.reports.flat()
  const finished = reported.find((one) => one.kind === "finished")
  return finished?.kind === "finished" ? finished : undefined
}

describe("a Step that proposed no call", () => {
  it("is the answer, and the loop writes nothing of its own", async () => {
    const { reason, watched } = await prompting([answering("done")])

    expect(reason).toBe("end_turn")
    // The Run's own Claim closed it, so the loop reported nothing.
    expect(watched.calls).toEqual(["run"])
  })
})

describe("a Step that proposed calls", () => {
  it("opens one Run per Step and carries the exchange into the next", async () => {
    const { reason, watched } = await prompting([acting("read", "ok", "hello"), answering("done")])

    expect(reason).toBe("end_turn")
    expect(watched.calls).toEqual(["run", "run"])

    // The second Run is the second Step: one model request per Run, and the
    // history holds what the first Step asked for and what it was told.
    const second = watched.runs[1]
    expect(second?.history).toHaveLength(3)
    expect(second?.history[1]).toMatchObject({ author: "agent" })
    expect(second?.history[2]).toMatchObject({
      author: "human",
      blocks: [{ content: { type: "text", text: "tool_result call_read ok\nhello" } }],
    })
  })

  // Every Step is offered the domain as it stands, so a mode that rebuilt
  // the tool domain between two Steps is what the second Step is shown.
  it("shows the model the tools the domain holds at that Step", async () => {
    let rows: readonly ToolInfo[] = [READ]
    const { watched } = await prompting([acting("read", "ok"), answering("done")], {
      tools: Effect.suspend(() => {
        const held = rows
        rows = []
        return Effect.succeed(held)
      }),
    })

    expect(watched.runs[0]?.tools).toEqual([
      { name: "read", description: "reads a file", input: {} },
    ])
    expect(watched.runs[1]?.tools).toEqual([])
  })

  // A denial is observed and not fatal: it reaches the model as an answer and
  // the loop takes another Step.
  it("goes on after a denial", async () => {
    const { reason, watched } = await prompting([
      acting("read", "denied", "read is denied in read-only mode"),
      answering("I cannot read that file"),
    ])

    expect(reason).toBe("end_turn")
    expect(watched.calls).toEqual(["run", "run"])
    expect(watched.runs[1]?.history[2]).toMatchObject({
      blocks: [
        { content: { text: "tool_result call_read denied\nread is denied in read-only mode" } },
      ],
    })
  })

  // A tool that ran and failed is an answer too, and it does not count
  // against the repair ceiling.
  it("goes on after a tool that failed", async () => {
    const { reason, watched } = await prompting([
      acting("read", "failed", "one.md: not_found"),
      acting("read", "failed", "two.md: not_found"),
      acting("read", "failed", "three.md: not_found"),
      answering("none of those files exist"),
    ])

    expect(reason).toBe("end_turn")
    expect(watched.calls).toHaveLength(4)
  })
})

/**
 * A malformed proposal repairs the way a refused Candidate does: the fault is
 * named back to the model and the next Step is the repair. A model that does
 * not recover is stopped by a ceiling.
 */
describe("a call naming a tool that is not there", () => {
  it("is repaired by the next Step", async () => {
    const { reason, watched } = await prompting([
      acting("reed", "unknown_tool", "no tool named reed is registered"),
      acting("read", "ok", "hello"),
      answering("done"),
    ])

    expect(reason).toBe("end_turn")
    expect(refusal(watched)).toBeUndefined()
    // The fault is what the repair reads.
    expect(watched.runs[1]?.history[2]).toMatchObject({
      blocks: [
        {
          content: { text: "tool_result call_reed unknown_tool\nno tool named reed is registered" },
        },
      ],
    })
  })

  it("stops the Prompt once the ceiling is past", async () => {
    const { reason, watched } = await prompting(
      [
        acting("reed", "unknown_tool", "no tool named reed is registered"),
        acting("reed", "unknown_tool", "no tool named reed is registered"),
      ],
      { malformedSteps: 1 },
    )

    expect(reason).toBe("max_turn_requests")
    expect(refusal(watched)).toMatchObject({
      claim: { result: "failed", summary: "no tool answered any call for 2 Steps: reed" },
      stopReason: "max_turn_requests",
    })
    // One first pass and one Repair ran; the ceiling stopped the next Step.
    expect(watched.calls.filter((one) => one === "run")).toHaveLength(2)
  })
})

describe("the max-steps fuse", () => {
  it("stops the Prompt and says so, and every Step it allowed ran", async () => {
    const { reason, watched } = await prompting([acting("read", "ok"), acting("read", "ok")], {
      steps: 2,
    })

    expect(reason).toBe("max_turn_requests")
    expect(watched.calls.filter((one) => one === "run")).toHaveLength(2)
    expect(refusal(watched)).toMatchObject({
      claim: {
        result: "failed",
        summary: "the max-steps fuse stopped this Prompt after 2 Steps",
      },
      stopReason: "max_turn_requests",
    })
  })

  // The Runs already carry the story, so the refusal after one is the
  // `finished` alone rather than a Run of its own.
  it("reports the finished alone once a Run has opened", async () => {
    const { watched } = await prompting([acting("read", "ok")], { steps: 1 })
    expect(watched.calls).toEqual(["run", "report:finished"])
  })
})

describe("an exhausted Budget", () => {
  // Before any Run, the refusal is a whole Run of its own so a person can
  // read it back.
  it("refuses as its own Run before the first Step", async () => {
    const { reason, watched } = await prompting([], { budget: Effect.succeed(exhausted("tokens")) })

    expect(reason).toBe("max_turn_requests")
    expect(watched.calls).toEqual(["report:started+finished"])
    expect(refusal(watched)).toMatchObject({
      claim: { result: "failed", summary: "the Budget is exhausted: tokens" },
    })
  })

  /**
   * After a Step, the partial work is on the Trace and the Run that did it
   * closed with its own Claim. Exhausting a Budget is an Outcome, so the
   * Prompt ends with a Stop Reason and nothing throws.
   */
  it("closes the Prompt after the Step that spent it", async () => {
    let spent = false
    const budget = Effect.suspend(() =>
      Effect.succeed(spent ? exhausted("tokens") : undefined).pipe(
        Effect.tap(() => Effect.sync(() => void (spent = true))),
      ),
    )
    const { reason, watched } = await prompting(
      [{ text: "working", calls: [called("read", "budget_denied", "the Budget is exhausted")] }],
      { budget },
    )

    expect(reason).toBe("max_turn_requests")
    expect(watched.calls).toEqual(["run", "report:finished"])
    expect(refusal(watched)).toMatchObject({
      claim: { result: "failed", summary: "the Budget is exhausted: tokens" },
      stopReason: "max_turn_requests",
    })
  })

  // The Budget is the spend and the fuse is this Prompt's ceiling. Both stop
  // the Prompt; the Budget is the more useful thing to say.
  it("is reported before the fuse when both are reached", async () => {
    const { watched } = await prompting([], {
      budget: Effect.succeed(exhausted("steps")),
      steps: 0,
    })

    expect(refusal(watched)).toMatchObject({
      claim: { summary: "the Budget is exhausted: steps" },
    })
  })
})

describe("what a Run said about itself", () => {
  // The Run's own record already says why it failed, so the loop stops and
  // adds no second story.
  it("stops the loop on a failed Claim and writes nothing", async () => {
    const { reason, watched } = await prompting([
      { claim: { result: "failed", summary: "no credential" }, stopReason: "end_turn" },
    ])

    expect(reason).toBe("end_turn")
    expect(watched.reports).toEqual([])
  })

  it("propagates a Stop Reason that is not end_turn, unchanged", async () => {
    const { reason, watched } = await prompting([
      { ...acting("read", "ok"), stopReason: "refusal" },
    ])

    expect(reason).toBe("refusal")
    expect(watched.reports).toEqual([])
  })

  /**
   * Silence is not `end_turn`. A Run that reported no reason ends the Prompt
   * by the loop's own shape instead: the Step proposed calls, so it goes on,
   * and a Step that proposes none is the answer.
   *
   * The host is built here rather than scripted, because a written script
   * cannot say "no reason" — `Partial<RunResult>` reads an absent field and an
   * explicit `undefined` as the same thing, and the default is `end_turn`.
   */
  it("takes another Step when a Run reported no reason but proposed calls", async () => {
    const answers: readonly RunResult[] = [
      { claim: DONE, degraded: [], attempts: 1, text: "working", calls: [called("read", "ok")] },
      { claim: DONE, degraded: [], attempts: 1, text: "done", calls: [] },
    ]
    let served = 0
    const host: HarnessHost = {
      run: () =>
        Effect.sync(() => {
          const one = answers[served]
          served += 1
          if (one === undefined) throw new Error(`the script holds ${answers.length} Runs`)
          return one
        }),
      report: () => Effect.void,
    }

    const reason = await Effect.runPromise(
      loop(host).prompt(SESSION, { kind: "prompt", text: "go" }),
    )

    expect(reason).toBe("end_turn")
    expect(served).toBe(2)
  })
})

describe("a build that cannot answer", () => {
  it("refuses before a Provider Turn is paid for when no model is named", async () => {
    const { reason, watched } = await prompting([], {
      catalog: Effect.succeed({ providers: new Map(), models: new Map() }),
    })

    expect(reason).toBe("end_turn")
    expect(watched.calls).toEqual(["report:started+finished"])
    expect(refusal(watched)).toMatchObject({
      claim: { summary: "no model is named and the Catalog holds no default" },
    })
  })

  it("names the Gap when the system Template cannot fill", async () => {
    const { watched } = await prompting([], { prompts: Effect.succeed([]) })

    expect(refusal(watched)).toMatchObject({
      claim: { summary: `the loop cannot fill ${LOOP_TEMPLATE_ID}: template ${LOOP_TEMPLATE_ID}` },
    })
  })
})

describe("a cancelled Prompt", () => {
  // A Harness answers a Stop Reason, so an interrupt is classified rather
  // than thrown.
  it("answers cancelled rather than failing", async () => {
    const opened = Deferred.makeUnsafe<void>()
    const host: HarnessHost = {
      run: () => Effect.andThen(Deferred.succeed(opened, undefined), Effect.never),
      report: () => Effect.void,
    }
    const harness = loop(host)

    const reason = await Effect.runPromise(
      Effect.gen(function* () {
        const prompting = yield* Effect.forkChild(
          harness.prompt(SESSION, { kind: "prompt", text: "go" }),
        )
        yield* Deferred.await(opened)
        yield* harness.cancel(SESSION)
        return yield* Fiber.join(prompting)
      }),
    )

    expect(reason).toBe("cancelled")
  })
})

/**
 * Steering lands at a boundary and never as an interrupt. `next-step` is a
 * boundary inside the Prompt that is running: the response and its tool group
 * are over and their records are committed, which is the top of the Step loop.
 * `next-run` is the whole arc's boundary, so it waits for the next Prompt.
 */
describe("a steer", () => {
  const STEER = "also rename the tests"

  const steer = (target: "next-run" | "next-step") =>
    ({ kind: "steer", text: STEER, target }) as const

  /**
   * A loop whose first Run delivers a steer to it. The Run is where the steer
   * comes from because that is the only point a test can be sure the Prompt has
   * not reached its next Step yet — and while it is open, what the Run's own
   * `stop` answers is what the tool group would do at its next window boundary.
   */
  const steerable = (
    script: readonly Partial<RunResult>[],
    during?: SubmitInput,
    over: Partial<LoopDeps> = {},
  ) => {
    const watched = scriptedHost(script)
    const stops: (string | undefined)[] = []
    let delivered = false
    const host: HarnessHost = {
      run: Effect.fn(function* (input) {
        if (during !== undefined && !delivered) {
          delivered = true
          yield* harness.prompt(SESSION, during)
        }
        stops.push(input.stop === undefined ? undefined : yield* input.stop)
        return yield* watched.host.run(input)
      }),
      report: watched.host.report,
    }
    const harness = loop(host, over)
    return {
      watched,
      stops,
      harness,
      prompting: (text = "rename UserSvc") => harness.prompt(SESSION, { kind: "prompt", text }),
    }
  }

  // What one Run was handed: the last thing said to the model, and the words
  // this Run records as the person's.
  const carried = (watched: ScriptedHost, at: number) => ({
    last: watched.runs[at]?.history.at(-1),
    steered: watched.runs[at]?.steered,
  })

  it("aimed at the next Step lands at the top of the next Step, on the record", async () => {
    const held = steerable([acting("read", "ok"), answering("done")], steer("next-step"))
    const reason = await Effect.runPromise(held.prompting())

    expect(reason).toBe("end_turn")
    // While the steer waited, the Run in flight was told to stop its group.
    expect(held.stops).toEqual(["a steer arrived and this call did not start", undefined])
    expect(carried(held.watched, 1)).toEqual({
      last: {
        author: "human",
        blocks: [{ type: "content", block: 0, content: { type: "text", text: STEER } }],
      },
      steered: [{ kind: "message", content: { type: "text", text: STEER }, target: "next-step" }],
    })
  })

  it("aimed at the next Run leaves the Prompt that is running alone", async () => {
    const held = steerable([acting("read", "ok"), answering("done")], steer("next-run"))
    const reason = await Effect.runPromise(held.prompting())

    expect(reason).toBe("end_turn")
    // Nothing stops the group, and the next Step reads the tool results alone.
    expect(held.stops).toEqual([undefined, undefined])
    expect(carried(held.watched, 1).steered).toBeUndefined()
  })

  // The whole arc's boundary is the next Prompt, and the words are on the
  // record of the Run that carries them.
  it("aimed at the next Run is said before the next Prompt's intent", async () => {
    const held = steerable([answering("done"), answering("done")])
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* held.prompting("first")
        yield* held.harness.prompt(SESSION, steer("next-run"))
        yield* held.prompting("second")
      }),
    )

    expect(held.watched.runs[1]?.history[0]).toMatchObject({
      author: "human",
      blocks: [{ content: { type: "text", text: STEER } }],
    })
    expect(held.watched.runs[1]?.steered).toEqual([
      { kind: "message", content: { type: "text", text: STEER }, target: "next-run" },
    ])
  })

  /**
   * An idle Session is an ordinary prompt and never an error. The Prompt has
   * ended, so there is no Step to land at, and the words wait for the next
   * Prompt rather than starting one nobody asked for.
   */
  it("with no Prompt running answers the last Stop Reason and rides the next Prompt", async () => {
    const held = steerable([answering("done"), answering("done")])
    const reasons = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* held.prompting("first")
        const answered = yield* held.harness.prompt(SESSION, steer("next-step"))
        yield* held.prompting("second")
        return { first, answered }
      }),
    )

    expect(reasons).toEqual({ first: "end_turn", answered: "end_turn" })
    expect(held.watched.runs[1]?.history.at(-1)).toMatchObject({
      blocks: [{ content: { type: "text", text: STEER } }],
    })
  })

  /**
   * A ceiling reads before the inbox does, so a Prompt that cannot take another
   * Step leaves the words where they are. A steer is never swallowed by the
   * Prompt it could not reach.
   */
  it("survives a Prompt a ceiling stopped", async () => {
    const held = steerable([acting("read", "ok"), answering("done")], steer("next-step"), {
      steps: 1,
    })
    const reasons = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* held.prompting("first")
        const second = yield* held.prompting("second")
        return { first, second }
      }),
    )

    expect(reasons).toEqual({ first: "max_turn_requests", second: "end_turn" })
    expect(held.watched.runs[1]?.steered).toEqual([
      { kind: "message", content: { type: "text", text: STEER }, target: "next-step" },
    ])
  })
})

describe("the row's own answers", () => {
  it("resumes a Session it minted and rejects one it did not", async () => {
    const harness = loop(scriptedHost().host)
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const minted = yield* Effect.scoped(harness.createSession("/work"))
        return {
          mine: yield* harness.resumeSession(minted),
          other: yield* harness.resumeSession(SESSION),
        }
      }),
    )

    expect(found.mine.kind).toBe("resumed")
    // Never `undetectable`: a native harness always knows what it holds.
    expect(found.other.kind).toBe("rejected")
  })
})
