import type { CalledTool, ToolInfo } from "@missingstudio/eva-core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { answerLine, offeredIn, proposalLine, stepMessages } from "./step.js"

const row = (over: Partial<ToolInfo> = {}): ToolInfo => ({
  id: "read",
  description: "reads a file",
  kind: "read",
  input: { type: "object" },
  execute: () => Effect.succeed({ disposition: "ok", content: [] }),
  ...over,
})

const called = (over: Partial<CalledTool["result"]> = {}): CalledTool => ({
  call: { id: "call_1", name: "read", args: { path: "one.md" } },
  result: { disposition: "ok", content: [{ type: "text", text: "hello" }], ...over },
})

describe("the tools a Step offers", () => {
  it("names each row by the name the model calls", () => {
    expect(offeredIn([row()])).toEqual([
      { name: "read", description: "reads a file", input: { type: "object" } },
    ])
  })

  // A row with no `execute` names a tool this build knows of and cannot run.
  // Offering it would be offering a call that can only answer `unknown_tool`.
  it("leaves out a row that carries no implementation", () => {
    expect(offeredIn([{ id: "read", description: "reads", kind: "read", input: {} }])).toEqual([])
  })
})

describe("one call, said back to the model", () => {
  it("carries the id, the name, and the arguments as JSON", () => {
    expect(proposalLine(called().call)).toBe('tool_call call_1 read {"path":"one.md"}')
  })

  // Every ending is data the model can act on, so what kind of ending it was
  // comes before what it said.
  it("puts the Disposition before the content", () => {
    expect(answerLine(called())).toBe("tool_result call_1 ok\nhello")
  })

  it("is the head alone when the tool said nothing", () => {
    expect(answerLine(called({ content: [] }))).toBe("tool_result call_1 ok")
  })

  // A denial is an answer and reaches the model as one.
  it("names a denial as the Disposition it is", () => {
    const denied = called({ disposition: "denied", content: [{ type: "text", text: "no" }] })
    expect(answerLine(denied)).toBe("tool_result call_1 denied\nno")
  })
})

describe("what a Step adds to the history", () => {
  it("is what the model said and asked for, then what the tools answered", () => {
    expect(stepMessages("reading now", [called()])).toEqual([
      {
        author: "agent",
        blocks: [
          {
            type: "content",
            block: 0,
            content: {
              type: "text",
              text: 'reading now\ntool_call call_1 read {"path":"one.md"}',
            },
          },
        ],
      },
      {
        author: "human",
        blocks: [
          {
            type: "content",
            block: 0,
            content: { type: "text", text: "tool_result call_1 ok\nhello" },
          },
        ],
      },
    ])
  })

  // A response of calls alone is normal, and an empty content string is what
  // every chat wire refuses — so the proposals carry the message.
  it("carries the proposals when the model wrote no words", () => {
    const [agent] = stepMessages("", [called()])
    expect(agent?.blocks[0]).toMatchObject({
      content: { type: "text", text: 'tool_call call_1 read {"path":"one.md"}' },
    })
  })
})
