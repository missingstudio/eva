import { define, type Plugin } from "@missingstudio/eva-sdk"
import { calling, withPlugin } from "@missingstudio/eva-testkit"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { commandTool, toolBash } from "./index.js"

/**
 * The plugin definition, and the row it registers, over a live kernel. The
 * tool's own decisions are in `command.test.ts`, over a written Sandbox; what
 * is here is that a name the model writes reaches the tool at all.
 */

// A Sandbox that answers one line and exits, so what is under test is the
// execution and not a real process.
const speaking = (text: string): Plugin =>
  define({
    id: "acme.sandbox",
    effect: Effect.fn("acme.sandbox")(function* (ctx) {
      yield* ctx.slot.sandbox.provide(ctx.id, {
        run: () =>
          Effect.succeed({
            output: Stream.make({ stream: "stdout" as const, text }),
            exit: Effect.succeed({ code: 0, signal: null }),
            kill: Effect.void,
          }),
        capabilities: Effect.succeed({ enforces: ["filesystem" as const] }),
      })
    }),
  })

describe("the eva.tool.bash plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolBash.id).toBe("eva.tool.bash")
  })

  // Every option a plugin reads is declared, so a misspelling under its
  // config entry is named rather than falling back in silence.
  it("declares the two options it reads", () => {
    expect(toolBash.takes).toEqual({ timeout: "number", maxOutput: "number" })
  })

  it("registers one row in the tool domain, under the name the model calls", async () => {
    const rows = await withPlugin(toolBash, (kernel) => kernel.domains.tool.get)

    expect(rows.map((row) => [row.id, row.kind])).toEqual([["bash", "execute"]])
    expect(rows[0]?.execute).toBeTypeOf("function")
  })

  it("names the tool a model calls, and what kind of tool it is", () => {
    const row = commandTool({ sandbox: Effect.succeed(undefined), timeout: 1, maxOutput: 1 })

    expect(row.id).toBe("bash")
    expect(row.kind).toBe("execute")
    expect(row.execute).toBeTypeOf("function")
  })

  // The words are already split, and a model has to be told so or it writes
  // a shell line into one of them.
  it("tells the model the command is already split into words", () => {
    const row = commandTool({ sandbox: Effect.succeed(undefined), timeout: 1, maxOutput: 1 })

    expect(row.description).toContain("already split into words")
  })

  /**
   * The name in, the records out. The streamed `tool_update` lands between the
   * `tool_call` and the closing pair, which is what the widened contract
   * bought: the execution opens the call before the tool writes a word.
   */
  it("runs a command through the execution, and streams while it runs", async () => {
    const ran = await withPlugin(
      toolBash,
      (kernel) => {
        const calls = calling(kernel)
        return Effect.map(calls.call("bash", { command: ["true"] }), (result) => ({
          result,
          said: calls.said(),
        }))
      },
      { before: [speaking("from the sandbox")] },
    )

    expect(ran.result.disposition).toBe("ok")
    // The tool says it started, streams one window, and says it ended. The
    // execution opens the call before all three and closes it after them.
    expect(ran.said.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "tool_update",
      "tool_update",
      "tool_update",
      "tool_update",
      "tool_result",
    ])
    expect(ran.said[2]).toEqual({
      kind: "tool_update",
      id: "call_1",
      status: "in_progress",
      content: [{ type: "text", text: "from the sandbox" }],
    })
    expect(new Set(ran.said.map((payload) => "id" in payload && payload.id)).size).toBe(1)
  })
})
