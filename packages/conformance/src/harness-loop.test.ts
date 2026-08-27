import type { Kernel } from "@missingstudio/eva-boot"
import {
  foldTranscript,
  toolText,
  type Approving,
  type ProposedCall,
} from "@missingstudio/eva-core"
import { sessionID, type Event, type Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import {
  committed,
  openRow,
  scripted,
  virtualFileSystem,
  withKernel,
  type ScriptedTurn,
  type Virtual,
} from "@missingstudio/eva-testkit"
import { budget } from "@missingstudio/eva-budget"
import { diff } from "@missingstudio/eva-diff"
import { harnessLoop, LOOP_HARNESS_ID } from "@missingstudio/eva-harness-loop"
import { approval } from "@missingstudio/eva-approval"
import { sched } from "@missingstudio/eva-sched"
import { toolEdit } from "@missingstudio/eva-tool-edit"
import { toolGlob } from "@missingstudio/eva-tool-glob"
import { toolGrep } from "@missingstudio/eva-tool-grep"
import { toolPolicy } from "@missingstudio/eva-tool-policy"
import { toolRead } from "@missingstudio/eva-tool-read"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The loop, the tool execution, the gate and a named permission mode, driven
 * end to end with no model in the room. The Provider is a written script and
 * the FileSystem is a map, so the work the tools do is real and the answer
 * that asked for it is fixed.
 *
 * A plugin may not import another plugin, so this is the only place these
 * eleven can stand in one build.
 */

const SESSION = sessionID("sess_loop_end_to_end")

// Three files that name the same class, which is the stage's demo.
const TREE = {
  "a.ts": "export class UserSvc {}\n",
  "b.ts": "import { UserSvc } from './a'\nnew UserSvc()\n",
  "c.ts": "// UserSvc is the old name\n",
}

const RENAME = "rename UserSvc to UserService across this package"

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const usage = (tokens: number): Payload => ({
  kind: "usage",
  model: "fake/model",
  inputTokens: tokens,
  outputTokens: 0,
  cacheWriteTokens: null,
  cacheReadTokens: null,
})

// One Step as the script writes it: what the model said, and what it asked
// for. A turn that proposes nothing ends the Prompt.
const step = (said: string, calls: readonly ProposedCall[] = [], spent?: number): ScriptedTurn => ({
  payloads: spent === undefined ? [text(said)] : [text(said), usage(spent)],
  toolCalls: calls,
})

const reading = (id: string, path: string): ProposedCall => ({
  id,
  name: "read",
  args: { path },
})

/**
 * One rename, as the model would write it. A Hunk lands only when its text
 * appears exactly once, so a file naming the class twice needs two Hunks —
 * which is what makes `b.ts` worth having in the tree.
 */
const renaming = (id: string, path: string, finds: readonly string[]): ProposedCall => ({
  id,
  name: "edit",
  args: {
    path,
    hunks: finds.map((find) => ({ find, replace: find.replace("UserSvc", "UserService") })),
  },
})

const fakeCatalog = define({
  id: "test.catalog.fake",
  effect: Effect.fn("test.catalog.fake")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      draft.model.update("fake", "model", () => {})
      draft.model.default.set({ provider: "fake", model: "model" })
    })
  }),
})

interface Driven {
  readonly reason: string
  readonly said: readonly Payload[]
  readonly files: Readonly<Record<string, string>>
  readonly record: readonly Event[]
  readonly requests: number
}

interface DriveOptions {
  readonly config?: Record<string, unknown>
  readonly approving?: Approving
  readonly options?: Record<string, unknown>
  readonly seed?: Readonly<Record<string, string>>
  readonly withBudget?: Record<string, unknown>
}

/**
 * One Prompt through the loop over a live kernel: the real tool execution, the
 * real gate, the real Recorder, and a scripted Provider. The build is the
 * shipped load order — the tools, then `eva.sched`, then the two gates.
 */
const driving = (
  script: readonly ScriptedTurn[],
  over: DriveOptions = {},
): Promise<Driven & { readonly virtual: Virtual }> => {
  const virtual = virtualFileSystem({ ...TREE, ...over.seed })
  const fake = scripted(script)
  const plugins = [
    trace,
    traceMemory,
    virtual.plugin,
    ...(over.withBudget === undefined ? [] : [{ plugin: budget, options: over.withBudget }]),
    diff,
    toolRead,
    toolGrep,
    toolGlob,
    toolEdit,
    sched,
    toolPolicy,
    approval,
    fakeCatalog,
    fake.plugin,
    over.options === undefined ? harnessLoop : { plugin: harnessLoop, options: over.options },
  ]

  return withKernel(
    plugins,
    (kernel: Kernel, scope) =>
      Effect.gen(function* () {
        const opened = yield* openRow(
          kernel,
          scope,
          LOOP_HARNESS_ID,
          SESSION,
          over.approving === undefined ? {} : { approving: over.approving },
        )
        const reason = yield* opened.harness.prompt(SESSION, { kind: "prompt", text: RENAME })
        return {
          reason,
          said: opened.said(),
          files: virtual.files(),
          record: yield* committed(kernel),
          requests: fake.seen().length,
          virtual,
        }
      }),
    { config: { ...over.config } },
  )
}

const kindsIn = (record: readonly Event[]) => record.map((event) => event.payload.kind)

const dispositions = (record: readonly Event[]) =>
  record.flatMap((event) =>
    event.payload.kind === "tool_result" ? [event.payload.disposition] : [],
  )

const lastFinished = (record: readonly Event[]) =>
  [...record].reverse().find((event) => event.payload.kind === "finished")?.payload

/**
 * The stage's demo. Parallel reads and greps, then serial edits, inside a
 * named permission mode — and the loop ends when the model stops asking for
 * tools rather than when a counter runs out.
 */
describe("a three-file refactor, end to end", () => {
  const SCRIPT: readonly ScriptedTurn[] = [
    step("Looking for the name.", [
      { id: "call_1", name: "grep", args: { pattern: "UserSvc" } },
      { id: "call_2", name: "glob", args: { pattern: "*.ts" } },
    ]),
    step("Reading the three files.", [
      reading("call_3", "a.ts"),
      reading("call_4", "b.ts"),
      reading("call_5", "c.ts"),
    ]),
    step("Renaming.", [
      renaming("call_6", "a.ts", ["class UserSvc"]),
      renaming("call_7", "b.ts", ["{ UserSvc }", "new UserSvc()"]),
      renaming("call_8", "c.ts", ["UserSvc is"]),
    ]),
    step("Renamed UserSvc to UserService in three files."),
  ]

  it("changes all three files and ends when the model stops asking", async () => {
    const found = await driving(SCRIPT, { config: { approval: { mode: "autonomous" } } })

    expect(found.reason).toBe("end_turn")
    // Four Steps is four Runs and four Provider Turns: one model request per
    // Run, and a Run holds the work its response caused.
    expect(found.requests).toBe(4)

    expect(found.files).toEqual({
      "a.ts": "export class UserService {}\n",
      "b.ts": "import { UserService } from './a'\nnew UserService()\n",
      "c.ts": "// UserService is the old name\n",
    })

    // Every call answered, and each write left an `edit` record.
    expect(dispositions(found.record)).toEqual(Array.from({ length: 8 }, () => "ok"))
    expect(
      found.record
        .filter((event) => event.payload.kind === "edit")
        .map((event) => (event.payload.kind === "edit" ? event.payload.path : "")),
    ).toEqual(["a.ts", "b.ts", "c.ts"])
  })

  /**
   * The Claim and the Stop Reason are the schema's own words. Nothing here is
   * bespoke: the Run's Claim is `submit`'s, and the Prompt's Stop Reason is
   * one of ACP's five.
   */
  it("closes every Run with a Claim the schema carries", async () => {
    const found = await driving(SCRIPT, { config: { approval: { mode: "autonomous" } } })

    const finished = found.record.flatMap((event) =>
      event.payload.kind === "finished" ? [event.payload] : [],
    )
    expect(finished).toHaveLength(4)
    for (const one of finished) {
      expect(one.claim).toEqual({ result: "done", summary: "answered" })
      expect(one.stopReason).toBe("end_turn")
    }
  })

  // A call's records are inside the Run that proposed it: `finished` is last,
  // and every `tool_call` shares the Run of the `text` before it.
  it("records each call inside the Run that proposed it", async () => {
    const found = await driving(SCRIPT, { config: { approval: { mode: "autonomous" } } })

    const runs = new Map<string, string[]>()
    for (const event of found.record) {
      const held = runs.get(event.run) ?? []
      held.push(event.payload.kind)
      runs.set(event.run, held)
    }

    // The `edit` record is inside its own call, between the `tool_call` and
    // the closing pair — the tool wrote it while it worked.
    expect([...runs.values()][2]).toEqual([
      "started",
      "text",
      "tool_call",
      "edit",
      "tool_update",
      "tool_result",
      "tool_call",
      "edit",
      "tool_update",
      "tool_result",
      "tool_call",
      "edit",
      "tool_update",
      "tool_result",
      "finished",
    ])
    for (const kinds of runs.values()) expect(kinds.at(-1)).toBe("finished")
  })
})

/**
 * The gate is the execution's, not the loop's. So a mode the loop knows nothing
 * about decides its calls, and the loop reads the answer as data.
 */
describe("every Step's calls pass the gate", () => {
  const TRYING: readonly ScriptedTurn[] = [
    step("Renaming.", [renaming("call_1", "a.ts", ["class UserSvc"])]),
    step("I could not change a.ts."),
  ]

  /**
   * A mode is capability selection first. `read-only` rebuilds the tool domain
   * without the rows that change anything, so the Step is offered no `edit`
   * and a call to it can only answer `unknown_tool` — the domain never held
   * the row.
   */
  it("a mode the Step is offered no write tool in answers unknown_tool", async () => {
    const found = await driving(TRYING, { config: { approval: { mode: "read-only" } } })

    expect(found.reason).toBe("end_turn")
    expect(dispositions(found.record)).toEqual(["unknown_tool"])
    expect(found.said.some((one) => one.kind === "tool_call")).toBe(true)
    expect(found.files["a.ts"]).toBe(TREE["a.ts"])
  })

  /**
   * The default mode supervises, so a change is asked about and the row is
   * still there. A build with nobody to answer denies — and the loop observes
   * the denial and takes another Step rather than ending.
   */
  it("an ask nobody answers is a denial, and the loop goes on", async () => {
    const found = await driving(TRYING)

    expect(found.reason).toBe("end_turn")
    expect(dispositions(found.record)).toEqual(["denied"])
    expect(found.files["a.ts"]).toBe(TREE["a.ts"])
    // Two Steps ran: the denial did not end the Prompt.
    expect(found.requests).toBe(2)
  })

  /**
   * A protected path is asked about whatever the mode says, so `autonomous`
   * plus nobody to answer is a denial. Settings cannot pre-approve one, and
   * the loop reads the refusal as data.
   */
  it("a protected path is denied even in autonomous mode", async () => {
    const found = await driving(
      [
        step("Adding a server.", [renaming("call_1", ".mcp.json", ['"servers": {}'])]),
        step("I may not change .mcp.json."),
      ],
      {
        config: { approval: { mode: "autonomous" } },
        seed: { ".mcp.json": '{ "servers": {} }\n' },
      },
    )

    expect(found.reason).toBe("end_turn")
    expect(dispositions(found.record)).toEqual(["denied"])
    expect(found.files[".mcp.json"]).toBe('{ "servers": {} }\n')
  })

  // With an answer, the same call runs. This is the seam ticket 08 built,
  // reached through the Run the loop opened.
  it("an answered ask runs the call", async () => {
    const found = await driving(
      [step("Renaming.", [renaming("call_1", "a.ts", ["class UserSvc"])]), step("Renamed it.")],
      { approving: () => Effect.succeed({ kind: "allow_once" }) },
    )

    expect(dispositions(found.record)).toEqual(["ok"])
    expect(found.files["a.ts"]).toBe("export class UserService {}\n")
  })

  // A tool this build does not have is a Disposition and a repair, not a
  // crash: the next Step reads the fault and asks for the right tool.
  it("a call naming no tool is repaired by the next Step", async () => {
    const found = await driving([
      step("Reading.", [{ id: "call_1", name: "reed", args: { path: "a.ts" } }]),
      step("Reading.", [reading("call_2", "a.ts")]),
      step("class UserSvc, as named."),
    ])

    expect(found.reason).toBe("end_turn")
    expect(dispositions(found.record)).toEqual(["unknown_tool", "ok"])
  })
})

/**
 * "Run the tests and fix the first failure" stops at green or at the fuse.
 * Green is the model proposing no more calls; the fuse is the loop's own
 * ceiling on Steps in one Prompt.
 */
describe("a loop that fixes a failure", () => {
  it("stops at green", async () => {
    const found = await driving(
      [
        step("Reading the failing file.", [reading("call_1", "a.ts")]),
        step("Fixing it.", [renaming("call_2", "a.ts", ["class UserSvc"])]),
        step("Green."),
      ],
      { config: { approval: { mode: "autonomous" } } },
    )

    expect(found.reason).toBe("end_turn")
    expect(found.files["a.ts"]).toBe("export class UserService {}\n")
  })

  /**
   * The fuse. A model that never stops asking is stopped by the ceiling, and
   * the work it did before it stands: reaching a cap is an Outcome and the
   * partial work is kept.
   */
  it("stops at the max-steps fuse, with the work it did on the Trace", async () => {
    const found = await driving(
      [
        step("Fixing.", [renaming("call_1", "a.ts", ["class UserSvc"])]),
        step("Fixing.", [reading("call_2", "a.ts")]),
        step("Fixing.", [reading("call_3", "a.ts")]),
      ],
      { config: { approval: { mode: "autonomous" } }, options: { steps: 2 } },
    )

    expect(found.reason).toBe("max_turn_requests")
    expect(found.requests).toBe(2)
    // The edit the first Step made stands.
    expect(found.files["a.ts"]).toBe("export class UserService {}\n")
    expect(lastFinished(found.record)).toEqual({
      kind: "finished",
      claim: {
        result: "failed",
        summary: "the max-steps fuse stopped this Prompt after 2 Steps",
      },
      stopReason: "max_turn_requests",
    })
  })
})

/**
 * Exhausting a Budget is an Outcome, not an error. The call the response
 * proposed after the spend is `budget_denied` on the Trace, and the Prompt
 * closes with the partial work kept.
 */
describe("an exhausted Budget", () => {
  it("closes the Run as Exhausted with the partial work on the Trace", async () => {
    const found = await driving(
      [
        step("Reading.", [reading("call_1", "a.ts")], 10),
        step("Renaming.", [renaming("call_2", "a.ts", ["class UserSvc"])], 10),
      ],
      { config: { approval: { mode: "autonomous" } }, withBudget: { tokens: 15 } },
    )

    expect(found.reason).toBe("max_turn_requests")
    // The read ran; the edit the second response proposed did not.
    expect(dispositions(found.record)).toEqual(["ok", "budget_denied"])
    expect(found.files["a.ts"]).toBe(TREE["a.ts"])

    // The refused call left the same three records a call that ran leaves,
    // so nothing on the Trace is a `tool_call` with no end.
    expect(kindsIn(found.record).filter((one) => one.startsWith("tool_"))).toEqual([
      "tool_call",
      "tool_update",
      "tool_result",
      "tool_call",
      "tool_update",
      "tool_result",
    ])

    expect(lastFinished(found.record)).toEqual({
      kind: "finished",
      claim: { result: "failed", summary: "the Budget is exhausted: tokens" },
      stopReason: "max_turn_requests",
    })
  })
})

/**
 * Steering, end to end. A line typed while the loop works lands after the
 * current response and its tool group complete structurally: the window that
 * was running commits whole, the windows that never opened are `skipped`, and
 * the words are on the record of the Step that reads them.
 *
 * The boundary is proven with a latch and not a clock. Two calls to a waiting
 * tool are one window; neither answers until both have arrived, so the steer is
 * delivered while that window is in flight and the group's next boundary is
 * the first one it can stop at.
 */
describe("a steer while the loop works", () => {
  const STEER = "also rename the tests"

  interface Latch {
    readonly full: Deferred.Deferred<void>
    readonly release: Deferred.Deferred<void>
  }

  // A tool that waits for its window to fill. It claims a call may run beside
  // another, so two calls to it are one window.
  const waiting = (latch: Latch, wanted: number) => {
    let arrived = 0
    return define({
      id: "test.tool.wait",
      effect: Effect.fn("test.tool.wait")(function* (ctx) {
        yield* ctx.tool.transform((draft) => {
          draft.set({
            id: "wait",
            description: "waits for the window to fill",
            kind: "read",
            input: { type: "object", properties: {} },
            parallelSafe: () => true,
            execute: () =>
              Effect.gen(function* () {
                arrived += 1
                if (arrived >= wanted) yield* Deferred.succeed(latch.full, undefined)
                yield* Deferred.await(latch.release)
                return toolText("ok", "waited")
              }),
          })
        })
      }),
    })
  }

  /**
   * One Prompt, with a steer delivered while the first window is running. The
   * Prompt runs on its own fiber, and the latch is what makes the delivery land
   * inside the group rather than beside it.
   */
  const steering = (script: readonly ScriptedTurn[]) => {
    const virtual = virtualFileSystem(TREE)
    const fake = scripted(script)
    const latch = {
      full: Deferred.makeUnsafe<void>(),
      release: Deferred.makeUnsafe<void>(),
    }

    return withKernel(
      [
        trace,
        traceMemory,
        virtual.plugin,
        diff,
        toolRead,
        toolEdit,
        waiting(latch, 2),
        sched,
        toolPolicy,
        approval,
        fakeCatalog,
        fake.plugin,
        harnessLoop,
      ],
      (kernel: Kernel, scope) =>
        Effect.gen(function* () {
          const opened = yield* openRow(kernel, scope, LOOP_HARNESS_ID, SESSION)
          const prompting = yield* Effect.forkChild(
            opened.harness.prompt(SESSION, { kind: "prompt", text: RENAME }),
          )
          yield* Deferred.await(latch.full)
          yield* opened.harness.prompt(SESSION, {
            kind: "steer",
            text: STEER,
            target: "next-step",
          })
          yield* Deferred.succeed(latch.release, undefined)
          const reason = yield* Fiber.join(prompting)
          return {
            reason,
            files: virtual.files(),
            record: yield* committed(kernel),
            requests: fake.seen().length,
            seen: fake.seen(),
          }
        }),
      { config: { approval: { mode: "autonomous" } } },
    )
  }

  const SCRIPT: readonly ScriptedTurn[] = [
    step("Working.", [
      { id: "call_1", name: "wait", args: {} },
      { id: "call_2", name: "wait", args: {} },
      renaming("call_3", "a.ts", ["class UserSvc"]),
      reading("call_4", "b.ts"),
    ]),
    step("I stopped for you."),
  ]

  it("lets the window in flight finish and skips the calls that never started", async () => {
    const found = await steering(SCRIPT)

    expect(found.reason).toBe("end_turn")
    expect(dispositions(found.record)).toEqual(["ok", "ok", "skipped", "skipped"])
    // The barrier never ran, so the file it would have changed stands.
    expect(found.files["a.ts"]).toBe(TREE["a.ts"])
  })

  // The line is on the record, in the Run that reads it — which is the Step
  // after the one the response and its group belong to.
  it("records the line in the Step that reads it, after the group that was running", async () => {
    const found = await steering(SCRIPT)

    const runs = [...new Set(found.record.map((event) => event.run))]
    const steer = found.record.find((event) => event.payload.kind === "message")
    expect(steer?.payload).toEqual({
      kind: "message",
      content: { type: "text", text: STEER },
      target: "next-step",
    })
    expect(steer?.run).toBe(runs[1])
    // Every skipped call is on the record of the Run before it.
    expect(
      found.record.filter((event) => event.payload.kind === "tool_result").map((one) => one.run),
    ).toEqual([runs[0], runs[0], runs[0], runs[0]])
    // The model reads the line too, so the next request carries it.
    expect(found.seen[1]?.messages.at(-1)).toMatchObject({
      author: "human",
      blocks: [{ content: { type: "text", text: STEER } }],
    })
  })

  /**
   * The fold is the test of "nothing is orphaned": a `tool_call` with no result
   * shows as a call that never ended, and a result whose id has no `tool_call`
   * is dropped without a word. After a steer there is neither.
   */
  it("folds clean: no orphaned call, no dangling result", async () => {
    const found = await steering(SCRIPT)

    const ids = (kind: "tool_call" | "tool_result") =>
      found.record.flatMap((event) => (event.payload.kind === kind ? [event.payload.id] : []))
    expect(ids("tool_call")).toEqual(ids("tool_result"))

    const messages = foldTranscript(SESSION, found.record).messages()
    const tools = messages.flatMap((message) =>
      message.blocks.filter((block) => block.type === "tool"),
    )
    expect(tools).toHaveLength(4)
    for (const block of tools) expect(block.disposition).not.toBeUndefined()
    expect(tools.map((block) => block.disposition)).toEqual(["ok", "ok", "skipped", "skipped"])
    // The line the person typed is a human Message of its own.
    expect(
      messages.filter(
        (message) =>
          message.author === "human" &&
          message.blocks.some(
            (block) =>
              block.type === "content" &&
              block.content.type === "text" &&
              block.content.text === STEER,
          ),
      ),
    ).toHaveLength(1)
  })
})

/**
 * A cancel while a tool works. `SessionAPI.cancel` interrupts the fiber the
 * Prompt runs on, so interrupting that fiber is the same path a person's stop
 * takes.
 *
 * A barrier is where a stop can orphan a record: it emits straight through,
 * while a parallel window holds its records back and commits none of them when
 * it dies. So the tool here claims nothing and the group runs it alone.
 */
describe("a cancel while a tool works", () => {
  const parking = (reached: Deferred.Deferred<void>) =>
    define({
      id: "test.tool.park",
      effect: Effect.fn("test.tool.park")(function* (ctx) {
        yield* ctx.tool.transform((draft) => {
          draft.set({
            id: "park",
            description: "never answers",
            kind: "execute",
            input: { type: "object", properties: {} },
            execute: () => Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
          })
        })
      }),
    })

  const cancelling = (script: readonly ScriptedTurn[]) => {
    const virtual = virtualFileSystem(TREE)
    const fake = scripted(script)
    const reached = Deferred.makeUnsafe<void>()

    return withKernel(
      [
        trace,
        traceMemory,
        virtual.plugin,
        diff,
        toolRead,
        toolEdit,
        parking(reached),
        sched,
        toolPolicy,
        approval,
        fakeCatalog,
        fake.plugin,
        harnessLoop,
      ],
      (kernel: Kernel, scope) =>
        Effect.gen(function* () {
          const opened = yield* openRow(kernel, scope, LOOP_HARNESS_ID, SESSION)
          const prompting = yield* Effect.forkChild(
            opened.harness.prompt(SESSION, { kind: "prompt", text: RENAME }),
          )
          yield* Deferred.await(reached)
          yield* Fiber.interrupt(prompting)
          return { files: virtual.files(), record: yield* committed(kernel) }
        }),
      { config: { approval: { mode: "autonomous" } } },
    )
  }

  const SCRIPT: readonly ScriptedTurn[] = [
    step("Running it.", [{ id: "call_1", name: "park", args: {} }]),
  ]

  it("closes the call it opened, and the Trace folds clean", async () => {
    const found = await cancelling(SCRIPT)

    const ids = (kind: "tool_call" | "tool_result") =>
      found.record.flatMap((event) => (event.payload.kind === kind ? [event.payload.id] : []))
    expect(ids("tool_call")).toEqual(["call_1"])
    expect(ids("tool_result")).toEqual(["call_1"])
    expect(dispositions(found.record)).toEqual(["cancelled"])
    expect(lastFinished(found.record)).toMatchObject({
      claim: { result: "failed", summary: "cancelled" },
      stopReason: "cancelled",
    })

    // The fold is the test of "nothing is orphaned": a call with no result
    // shows as one that never ended, and a result with no call is dropped.
    const tools = foldTranscript(SESSION, found.record)
      .messages()
      .flatMap((message) => message.blocks.filter((block) => block.type === "tool"))
    expect(tools.map((block) => block.disposition)).toEqual(["cancelled"])
  })
})
