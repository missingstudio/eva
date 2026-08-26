import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { Deferred, Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  executeTool,
  executeToolGroup,
  optionFor,
  PERMISSION_OPTIONS,
  refuseCall,
  strictest,
  toolText,
  TOOL_GROUP_LIMIT,
  type Decided,
  type PermissionOutcome,
  type PermissionRequest,
  type ToolCall,
  type ToolDecision,
  type ToolDeps,
  type ToolGroupDeps,
  type ToolInfo,
  type ToolResult,
} from "./tool.js"

const call: ToolCall = {
  id: "call_1",
  name: "read",
  args: { path: "one.md" },
  session: sessionID("sess_tool"),
}

const reader = (answer: ToolResult, seen: unknown[] = []): ToolInfo => ({
  id: "read",
  kind: "read",
  description: "reads",
  input: {},
  execute: (input) =>
    Effect.sync(() => {
      seen.push(input)
      return answer
    }),
})

/**
 * A tool that says it is working before it answers, the way a command that
 * streams its output does. It writes through the context it is handed, so the
 * id its record joins on is the call's and not one of its own.
 */
const working = (): ToolInfo => ({
  id: "read",
  kind: "read",
  description: "reads",
  input: {},
  execute: (_input, context) =>
    Effect.as(
      context.emit({
        kind: "tool_update",
        id: context.id,
        status: "in_progress",
        content: [{ type: "text", text: "half way" }],
      }),
      toolText("ok", "done"),
    ),
})

interface Ran {
  readonly result: ToolResult
  readonly said: readonly Payload[]
}

const running = async (
  parts: Partial<ToolDeps> & Pick<ToolDeps, "tool">,
  one: ToolCall = call,
): Promise<Ran> => {
  const said: Payload[] = []
  const deps: ToolDeps = { ...parts, emit: (payload) => Effect.sync(() => void said.push(payload)) }
  const result = await Effect.runPromise(executeTool(deps, one))
  return { result, said }
}

const answering = (tool: ToolInfo | undefined): Pick<ToolDeps, "tool"> => ({
  tool: () => Effect.succeed(tool),
})

const deciding =
  (decision: ToolDecision): ((one: ToolCall) => Effect.Effect<Decided>) =>
  (one) =>
    Effect.succeed({ args: one.args, decision })

describe("the strictest decision", () => {
  it("is nothing when no hook decided, which allows", () => {
    expect(strictest([])).toBeUndefined()
  })

  // Hooks run in registration order and the strictest wins, which is what
  // lets a repo profile narrow a mandate and never widen it.
  it("is the rejection, whichever order the hooks decided in", () => {
    const deny: ToolDecision = { kind: "reject_always", reason: "no" }
    expect(strictest([{ kind: "allow_always" }, deny])).toEqual(deny)
    expect(strictest([deny, { kind: "allow_once" }])).toEqual(deny)
  })

  // A call nobody has answered for does not run, so asking outranks allowing.
  it("prefers a question to an allow, and a rejection to a question", () => {
    const ask: ToolDecision = { kind: "ask", question: "may it?" }
    expect(strictest([{ kind: "allow_once" }, ask])).toEqual(ask)
    expect(strictest([ask, { kind: "reject_once", reason: "no" }])).toEqual({
      kind: "reject_once",
      reason: "no",
    })
  })

  // A tie is equally strict either way, so the reason the model reads is the
  // first hook's rather than whichever hook happened to run last.
  it("keeps the first of two equally strict decisions", () => {
    expect(
      strictest([
        { kind: "reject_once", reason: "first" },
        { kind: "reject_once", reason: "second" },
      ]),
    ).toEqual({ kind: "reject_once", reason: "first" })
  })
})

describe("one tool call", () => {
  it("records the call, the closing status, and the result, in that order", async () => {
    const { result, said } = await running(answering(reader(toolText("ok", "hello"))))

    expect(result.disposition).toBe("ok")
    expect(said.map((payload) => payload.kind)).toEqual(["tool_call", "tool_update", "tool_result"])
    expect(said[0]).toEqual({
      kind: "tool_call",
      id: "call_1",
      name: "read",
      tool: "read",
      args: { path: "one.md" },
      status: "pending",
      redacted: false,
    })
    expect(said[1]).toEqual({
      kind: "tool_update",
      id: "call_1",
      status: "completed",
      content: [{ type: "text", text: "hello" }],
    })
    expect(said[2]).toEqual({
      kind: "tool_result",
      id: "call_1",
      name: "read",
      disposition: "ok",
      bytes: 5,
    })
  })

  // The fold joins the three records by the call id, so a result whose id
  // never opened a call reaches no Block at all.
  it("uses one id for all three records", async () => {
    const { said } = await running(answering(reader(toolText("ok", ""))))

    expect(new Set(said.map((payload) => "id" in payload && payload.id)).size).toBe(1)
  })

  it("counts the bytes of the content it answered, not its characters", async () => {
    const { said } = await running(answering(reader(toolText("ok", "é"))))
    const record = said[2]

    expect(record?.kind === "tool_result" && record.bytes).toBe(2)
  })

  // A call that ends is never left `pending`: the closing status says it
  // stopped and the Disposition says how.
  it("closes a failed tool with a failed status and its own disposition", async () => {
    const { result, said } = await running(answering(reader(toolText("failed", "no such file"))))
    const update = said[1]

    expect(result.disposition).toBe("failed")
    expect(update?.kind === "tool_update" && update.status).toBe("failed")
  })

  /**
   * A tool that works for a while says so while it works. Its record lands
   * after the `tool_call` and before the closing pair: a fold joins by the
   * call id, so an update the call record does not precede is an orphan.
   */
  it("leaves the tool's own update between the call and the closing pair", async () => {
    const { result, said } = await running(answering(working()))

    expect(result.disposition).toBe("ok")
    expect(said.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "tool_update",
      "tool_update",
      "tool_result",
    ])
    expect(said[1]).toEqual({
      kind: "tool_update",
      id: "call_1",
      status: "in_progress",
      content: [{ type: "text", text: "half way" }],
    })
    expect(said[2]?.kind === "tool_update" && said[2].status).toBe("completed")
  })
})

describe("a call naming no registered tool", () => {
  it("is refused as unknown_tool and records the call all the same", async () => {
    const { result, said } = await running(answering(undefined))

    expect(result.disposition).toBe("unknown_tool")
    expect(result.content).toEqual([{ type: "text", text: "no tool named read is registered" }])
    expect(said.map((payload) => payload.kind)).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  // A row that describes an action carries the action. One that carries none
  // names a tool this build knows of and cannot run, which the model may not
  // call twice hoping for a different answer.
  it("refuses a row that carries no implementation", async () => {
    const { result } = await running(
      answering({ id: "read", kind: "read", description: "reads", input: {} }),
    )

    expect(result.disposition).toBe("unknown_tool")
  })
})

/**
 * A call that will not run leaves the same three records a call that ran
 * leaves, so nothing on the Trace is a `tool_call` with no end.
 */
describe("a call that never starts", () => {
  it("records the pair and names why in the result", async () => {
    const said: Payload[] = []
    const deps: ToolDeps = {
      ...answering(reader(toolText("ok", "hello"))),
      emit: (payload) => Effect.sync(() => void said.push(payload)),
    }
    const result = await Effect.runPromise(
      refuseCall(deps, call, "budget_denied", "the Budget is exhausted: tokens"),
    )

    expect(result.disposition).toBe("budget_denied")
    expect(said.map((payload) => payload.kind)).toEqual(["tool_call", "tool_update", "tool_result"])
    // The row is resolved, so the record names what the call would have been.
    expect(said[0]).toMatchObject({ kind: "tool_call", tool: "read", args: { path: "one.md" } })
    expect(said[2]).toMatchObject({ kind: "tool_result", disposition: "budget_denied" })
  })

  // Nothing ran, so the tool is never reached.
  it("does not run the tool", async () => {
    const seen: unknown[] = []
    const said: Payload[] = []
    const deps: ToolDeps = {
      ...answering(reader(toolText("ok", "hello"), seen)),
      emit: (payload) => Effect.sync(() => void said.push(payload)),
    }
    await Effect.runPromise(refuseCall(deps, call, "skipped", "a steer arrived first"))

    expect(seen).toEqual([])
  })
})

describe("the deciding boundary", () => {
  it("denies the call, and the tool never runs", async () => {
    const seen: unknown[] = []
    const { result, said } = await running({
      ...answering(reader(toolText("ok", "hello"), seen)),
      beforeExecute: deciding({ kind: "reject_once", reason: "read-only mode" }),
    })

    expect(seen).toEqual([])
    expect(result).toEqual({
      disposition: "denied",
      content: [{ type: "text", text: "read-only mode" }],
    })
    expect(said.map((payload) => payload.kind)).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  // `ask` is not a final answer, and a permission request with nobody to
  // answer it is a denial rather than a call that hangs or one that runs.
  it("denies a question nothing resolved", async () => {
    const { result } = await running({
      ...answering(reader(toolText("ok", "hello"))),
      beforeExecute: deciding({ kind: "ask", question: "read one.md?" }),
    })

    expect(result.disposition).toBe("denied")
    expect(result.content).toEqual([{ type: "text", text: "nobody answered: read one.md?" }])
  })

  it("runs the tool on an allow, with the arguments the boundary settled", async () => {
    const seen: unknown[] = []
    const { result, said } = await running({
      ...answering(reader(toolText("ok", "hello"), seen)),
      beforeExecute: () => Effect.succeed({ args: { path: "two.md" } }),
    })

    expect(seen).toEqual([{ path: "two.md" }])
    expect(result.disposition).toBe("ok")
    // The record names what ran, because the schema carries the arguments in
    // one place and a record of arguments nothing ran with is a lie.
    expect(said[0]?.kind === "tool_call" && said[0].args).toEqual({ path: "two.md" })
  })
})

describe("a question the boundary settled on", () => {
  const asking = (outcome: PermissionOutcome, held: PermissionRequest[] = []) =>
    running({
      ...answering(reader(toolText("ok", "hello"))),
      beforeExecute: deciding({ kind: "ask", question: "read one.md?" }),
      approving: (request) =>
        Effect.sync(() => {
          held.push(request)
          return outcome
        }),
    })

  // All four options round-trip. Two of them run the call and two refuse it,
  // because the "always" axis is persistence and not strictness.
  it.each(["allow_once", "allow_always"] as const)("runs the call on %s", async (kind) => {
    expect((await asking({ kind })).result.disposition).toBe("ok")
  })

  it.each(["reject_once", "reject_always"] as const)("refuses the call on %s", async (kind) => {
    const { result } = await asking({ kind, reason: "not that file" })
    expect(result.disposition).toBe("denied")
    expect(result.content).toEqual([{ type: "text", text: "not that file" }])
  })

  /**
   * The call id is the request id, and the record naming it landed first, so
   * a surface drawing the question already holds the call it is about.
   */
  it("asks about the call the record already named", async () => {
    const held: PermissionRequest[] = []
    const { said } = await asking({ kind: "allow_once" }, held)

    expect(said[0]?.kind).toBe("tool_call")
    expect(held).toEqual([
      {
        sessionId: call.session,
        toolCall: { toolCallId: call.id, title: "read one.md?" },
        options: PERMISSION_OPTIONS,
      },
    ])
  })

  it("offers ACP's four options and no others", () => {
    expect(PERMISSION_OPTIONS.map((one) => one.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
      "reject_always",
    ])
    // The answer names an option by id, so a second spelling of an option
    // would be a table to keep in step with the kinds.
    for (const one of PERMISSION_OPTIONS) expect(one.optionId).toBe(one.kind)
  })

  it("reads an option from its id, or from the words a person is offered", () => {
    expect(optionFor("allow_always")).toBe("allow_always")
    expect(optionFor("  Reject Once ")).toBe("reject_once")
    expect(optionFor("maybe")).toBeUndefined()
  })

  // A call the boundary allowed or refused outright never reaches a person.
  it("is the only decision that asks", async () => {
    const held: PermissionRequest[] = []
    await running({
      ...answering(reader(toolText("ok", "hello"))),
      beforeExecute: deciding({ kind: "allow_once" }),
      approving: (request) =>
        Effect.sync(() => {
          held.push(request)
          return { kind: "allow_once" } as const
        }),
    })
    expect(held).toEqual([])
  })
})

describe("the observing boundary after a call", () => {
  it("reads what the tool answered and may replace it", async () => {
    const { result } = await running({
      ...answering(reader(toolText("ok", "hello"))),
      afterExecute: () => Effect.succeed(toolText("failed", "the observer disagreed")),
    })

    expect(result).toEqual({
      disposition: "failed",
      content: [{ type: "text", text: "the observer disagreed" }],
    })
  })

  // A hook that could rewrite a denial into an allow is not a gate.
  it("never sees a denial", async () => {
    const seen: ToolResult[] = []
    const { result } = await running({
      ...answering(reader(toolText("ok", "hello"))),
      beforeExecute: deciding({ kind: "reject_always", reason: "never" }),
      afterExecute: (_one, answer) =>
        Effect.sync(() => {
          seen.push(answer)
          return toolText("ok", "allowed after all")
        }),
    })

    expect(seen).toEqual([])
    expect(result.disposition).toBe("denied")
  })
})

/**
 * The safety net under every latch below. No test waits for it when the
 * schedule is right, and a test that does wait fails with its own words
 * instead of hanging until the runner gives up.
 */
const WAITING = "2 seconds"

/**
 * What one group left behind: the records that reached the Trace, and which
 * calls had already committed when each tool started. A call that names the
 * one before it did not start until that call was on the record.
 */
interface Board {
  readonly said: Payload[]
  readonly marks: { by: string; saw: readonly string[] }[]
}

const board = (): Board => ({ said: [], marks: [] })

// The calls whose result is on the record. A `tool_result` is the last of a
// call's three records, so a call it names has committed whole.
const committed = (at: Board): readonly string[] =>
  at.said.filter((payload) => payload.kind === "tool_result").map((payload) => payload.id)

const watcher = (id: string, at: Board, safe: boolean): ToolInfo => ({
  id,
  kind: "read",
  description: "watches",
  input: {},
  ...(safe ? { parallelSafe: () => true } : {}),
  execute: () =>
    Effect.sync(() => {
      at.marks.push({ by: id, saw: committed(at) })
      return toolText("ok", id)
    }),
})

/**
 * Tools that count how many of them are in flight at once. Each one waits for
 * the count to reach `wanted`, and the last to arrive releases the rest, so
 * the highest count is a fact about the schedule rather than about a clock.
 */
const counting = (ids: readonly string[], wanted: number) =>
  Effect.gen(function* () {
    const full = yield* Deferred.make<boolean>()
    const state = { now: 0, most: 0 }
    const rows = ids.map(
      (id): ToolInfo => ({
        id,
        kind: "read",
        description: "counts",
        input: {},
        parallelSafe: () => true,
        execute: () =>
          Effect.gen(function* () {
            state.now += 1
            state.most = Math.max(state.most, state.now)
            if (state.now >= wanted) yield* Deferred.succeed(full, true)
            const met = yield* Deferred.await(full).pipe(
              Effect.timeout(WAITING),
              Effect.orElseSucceed(() => false),
            )
            state.now -= 1
            return met ? toolText("ok", id) : toolText("failed", `${id} ran alone`)
          }),
      }),
    )
    return { rows, state }
  })

const grouping = async (
  rows: readonly ToolInfo[],
  wanted: readonly { readonly name: string; readonly args?: unknown }[],
  options: { readonly at?: Board; readonly limit?: number } = {},
): Promise<{ results: readonly ToolResult[]; said: readonly Payload[] }> => {
  const at = options.at ?? board()
  const deps: ToolGroupDeps = {
    tool: (one) => Effect.succeed(rows.find((row) => row.id === one.name)),
    emit: (payload) => Effect.sync(() => void at.said.push(payload)),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  }
  const results = await Effect.runPromise(
    executeToolGroup(
      deps,
      wanted.map((one, index) => ({
        id: `call_${index + 1}`,
        name: one.name,
        args: one.args ?? {},
        session: sessionID("sess_tool"),
      })),
    ),
  )
  return { results, said: at.said }
}

// Which calls had committed when one tool started, by the tool's own name.
const sawBy = (at: Board, by: string): readonly string[] =>
  at.marks.find((mark) => mark.by === by)?.saw ?? []

describe("two parallel-safe calls", () => {
  /**
   * A latch and not a clock: neither call is released until both have arrived,
   * so an overlap that did not happen cannot pass this. The repeat is what
   * makes it a proof rather than one lucky schedule.
   */
  it("overlap", { repeats: 25 }, async () => {
    const { rows, state } = await Effect.runPromise(counting(["one", "two"], 2))
    const { results } = await grouping(rows, [{ name: "one" }, { name: "two" }])

    expect(state.most).toBe(2)
    expect(results.map((result) => result.disposition)).toEqual(["ok", "ok"])
  })
})

describe("a call that is not parallel-safe", () => {
  /**
   * The barrier clause, whole: the window before it commits before it starts,
   * and its own records commit before the call after it starts. Both halves
   * are read off what each tool saw, so neither is a timing assertion.
   */
  it("is a barrier: nothing after it starts until it has committed", async () => {
    const at = board()
    const rows = [watcher("one", at, true), watcher("edit", at, false), watcher("two", at, true)]
    const { said } = await grouping(rows, [{ name: "one" }, { name: "edit" }, { name: "two" }], {
      at,
    })

    expect(sawBy(at, "one")).toEqual([])
    expect(sawBy(at, "edit")).toEqual(["call_1"])
    expect(sawBy(at, "two")).toEqual(["call_1", "call_2"])
    expect(said.filter((payload) => payload.kind === "tool_result").map((one) => one.id)).toEqual([
      "call_1",
      "call_2",
      "call_3",
    ])
  })

  // Nothing runs beside a barrier, so its own records go straight to the
  // Trace and a command that streams its output still streams.
  it("commits its records as it makes them", async () => {
    const at = board()
    const { said } = await grouping([watcher("edit", at, false)], [{ name: "edit" }], { at })

    expect(said.map((payload) => payload.kind)).toEqual(["tool_call", "tool_update", "tool_result"])
  })
})

describe("an unclassified tool", () => {
  // Fail closed to serial: a row that claims nothing runs alone.
  it("runs alone", async () => {
    const at = board()
    const rows = [watcher("one", at, false), watcher("two", at, false)]
    await grouping(rows, [{ name: "one" }, { name: "two" }], { at })

    expect(at.marks.map((mark) => mark.saw)).toEqual([[], ["call_1"]])
  })

  /**
   * The classification reads the arguments, so the same tool is a barrier for
   * one input and a neighbour for another. Records held back are the mark of
   * a parallel window: a call that saw nothing started before the call before
   * it had committed.
   */
  it("runs alone when its classifier answers false for this input", async () => {
    const choosy = (id: string, at: Board): ToolInfo => ({
      ...watcher(id, at, false),
      parallelSafe: (input) => (input as { readonly safe?: unknown }).safe === true,
    })
    const alone = board()
    const together = board()
    const rowsOf = (at: Board) => [choosy("one", at), choosy("two", at)]

    await grouping(
      rowsOf(alone),
      [
        { name: "one", args: { safe: false } },
        { name: "two", args: { safe: false } },
      ],
      { at: alone },
    )
    await grouping(
      rowsOf(together),
      [
        { name: "one", args: { safe: true } },
        { name: "two", args: { safe: true } },
      ],
      { at: together },
    )

    expect(alone.marks.map((mark) => mark.saw)).toEqual([[], ["call_1"]])
    expect(together.marks.map((mark) => mark.saw)).toEqual([[], []])
  })

  // A classifier that throws has not claimed safety, so it is read as a
  // refusal. The runtime never widens what a tool did not say.
  it("runs alone when its classifier throws", async () => {
    const at = board()
    const angry = (id: string): ToolInfo => ({
      ...watcher(id, at, false),
      parallelSafe: () => {
        throw new Error("cannot say")
      },
    })
    await grouping([angry("one"), angry("two")], [{ name: "one" }, { name: "two" }], { at })

    expect(at.marks.map((mark) => mark.saw)).toEqual([[], ["call_1"]])
  })
})

describe("a group's records", () => {
  /**
   * The second call cannot finish last: the first waits for it. So completion
   * order and source order disagree, and the record is in source order all
   * the same.
   */
  it("commit in source order whichever call finished first", async () => {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const done = yield* Deferred.make<boolean>()
        return [
          {
            id: "slow",
            kind: "read",
            description: "answers last",
            input: {},
            parallelSafe: () => true,
            execute: () =>
              Deferred.await(done).pipe(
                Effect.timeout(WAITING),
                Effect.match({
                  onFailure: () => toolText("failed", "the quick call never finished"),
                  onSuccess: () => toolText("ok", "slow"),
                }),
              ),
          },
          {
            id: "quick",
            kind: "read",
            description: "answers first",
            input: {},
            parallelSafe: () => true,
            execute: () => Effect.as(Deferred.succeed(done, true), toolText("ok", "quick")),
          },
        ] satisfies ToolInfo[]
      }),
    )
    const { results, said } = await grouping(rows, [{ name: "slow" }, { name: "quick" }])

    expect(results.map((result) => result.disposition)).toEqual(["ok", "ok"])
    expect(said.map((payload) => "id" in payload && payload.id)).toEqual([
      "call_1",
      "call_1",
      "call_1",
      "call_2",
      "call_2",
      "call_2",
    ])
  })
})

describe("the bound on a parallel window", () => {
  it("holds every group to TOOL_GROUP_LIMIT calls at once", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]
    const { rows, state } = await Effect.runPromise(counting(ids, TOOL_GROUP_LIMIT))
    await grouping(
      rows,
      ids.map((name) => ({ name })),
    )

    expect(ids).toHaveLength(TOOL_GROUP_LIMIT + 1)
    expect(state.most).toBe(TOOL_GROUP_LIMIT)
  })

  // A caller may lower the ceiling. Nothing raises it.
  it("holds a group to the lower bound its caller named", async () => {
    const ids = ["a", "b", "c"]
    const { rows, state } = await Effect.runPromise(counting(ids, 2))
    await grouping(
      rows,
      ids.map((name) => ({ name })),
      { limit: 2 },
    )

    expect(state.most).toBe(2)
  })
})

describe("one failing call in a group", () => {
  /**
   * Every ending a tool has is a Disposition, so a sibling that could not do
   * the work is data beside two results and not a failure of the group.
   */
  it("reports its failure, and its siblings answer for themselves", async () => {
    const plain = (id: string, result: ToolResult): ToolInfo => ({
      id,
      kind: "read",
      description: "answers",
      input: {},
      parallelSafe: () => true,
      execute: () => Effect.succeed(result),
    })
    const { results, said } = await grouping(
      [
        plain("one", toolText("ok", "first")),
        plain("bad", toolText("failed", "no such file")),
        plain("two", toolText("ok", "third")),
      ],
      [{ name: "one" }, { name: "bad" }, { name: "two" }],
    )

    expect(results.map((result) => result.disposition)).toEqual(["ok", "failed", "ok"])
    expect(said.filter((payload) => payload.kind === "tool_result").map((one) => one.id)).toEqual([
      "call_1",
      "call_2",
      "call_3",
    ])
  })

  // A name nothing answers is unclassified, so it is a barrier and it is
  // refused where it stands rather than ending the group.
  it("refuses a name nothing answers and runs the rest", async () => {
    const at = board()
    const { results } = await grouping(
      [watcher("one", at, true)],
      [{ name: "one" }, { name: "nowhere" }, { name: "one" }],
      { at },
    )

    expect(results.map((result) => result.disposition)).toEqual(["ok", "unknown_tool", "ok"])
  })
})
