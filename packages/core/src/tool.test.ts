import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  executeTool,
  strictest,
  toolText,
  type Decided,
  type ToolCall,
  type ToolDecision,
  type ToolDeps,
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
