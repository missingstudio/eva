import type { Payload } from "@missingstudio/eva-schema"
import { sessionID } from "@missingstudio/eva-schema"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { calling, committed, virtualFileSystem, withKernel } from "@missingstudio/eva-testkit"
import { toolGlob } from "@missingstudio/eva-tool-glob"
import { toolGrep } from "@missingstudio/eva-tool-grep"
import { toolRead } from "@missingstudio/eva-tool-read"
import { toolWeb } from "@missingstudio/eva-tool-web"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

const SESSION = sessionID("sess_tools")

const TREE = {
  "src/one.ts": "const UserSvc = 1\n",
  "docs/two.md": "UserSvc is the old name\n",
}

interface Called {
  readonly name: string
  readonly args?: unknown
}

interface Ran {
  readonly dispositions: readonly string[]
  readonly recorded: readonly Payload[]
}

/**
 * The four tools over a live kernel, with the real Recorder and a real sink
 * behind it. What the calls emit is committed as it is emitted, so the order
 * asserted below is the order a reader of the Trace finds.
 */
const running = (made: readonly Called[], gate?: Plugin): Promise<Ran> =>
  withKernel(
    [
      trace,
      traceMemory,
      virtualFileSystem(TREE).plugin,
      toolRead,
      toolGrep,
      toolGlob,
      toolWeb,
      ...(gate === undefined ? [] : [gate]),
    ],
    (kernel) =>
      Effect.gen(function* () {
        const recorder = yield* kernel.slot.recorder.get
        yield* recorder.open(SESSION)

        const calls = calling(kernel, {
          session: SESSION,
          // Read at the moment of use, the way every commit path reads it.
          emit: (payload) =>
            Effect.flatMap(kernel.slot.recorder.get, (one) => one.commit([payload])),
        })

        const dispositions: string[] = []
        for (const one of made)
          dispositions.push((yield* calls.call(one.name, one.args)).disposition)

        return {
          dispositions,
          recorded: (yield* committed(kernel)).map((event) => event.payload),
        }
      }),
  )

describe("a tool call on the Trace", () => {
  it("lands the call, the closing update, and the result, in that order", async () => {
    const ran = await running([{ name: "read", args: { path: "src/one.ts" } }])

    expect(ran.dispositions).toEqual(["ok"])
    expect(ran.recorded.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "tool_update",
      "tool_result",
    ])
    // One id joins the three, or the fold drops the update and the result
    // without a word.
    expect(new Set(ran.recorded.map((payload) => "id" in payload && payload.id)).size).toBe(1)
  })

  it("lands one triple per call, each with its own id", async () => {
    const ran = await running([
      { name: "glob", args: { pattern: "**/*.ts" } },
      { name: "grep", args: { pattern: "UserSvc" } },
    ])

    expect(ran.dispositions).toEqual(["ok", "ok"])
    expect(ran.recorded.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "tool_update",
      "tool_result",
      "tool_call",
      "tool_update",
      "tool_result",
    ])
    expect(new Set(ran.recorded.map((payload) => "id" in payload && payload.id)).size).toBe(2)
  })

  // A denial is on the record for the same reason an answer is: it is what
  // the Run did, and the model reads the Disposition.
  it("lands a denied call as fully as one that ran", async () => {
    const gate = define({
      id: "acme.gate",
      effect: Effect.fn("acme.gate")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"]((event) => {
          event.decide({ kind: "reject_once", reason: "read-only" })
        })
      }),
    })

    const ran = await running([{ name: "read", args: { path: "src/one.ts" } }], gate)
    const result = ran.recorded[2]

    expect(ran.dispositions).toEqual(["denied"])
    expect(ran.recorded.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "tool_update",
      "tool_result",
    ])
    expect(result?.kind === "tool_result" && result.disposition).toBe("denied")
  })

  it("refuses a name no tool holds, and records the refusal", async () => {
    const ran = await running([{ name: "write", args: { path: "src/one.ts" } }])
    const result = ran.recorded[2]

    expect(ran.dispositions).toEqual(["unknown_tool"])
    expect(result?.kind === "tool_result" && result.disposition).toBe("unknown_tool")
  })
})

describe("the tool domain of a build that carries the four tools", () => {
  it("holds one row per tool, under the name the model calls", async () => {
    const rows = await withKernel(
      [virtualFileSystem(TREE).plugin, toolRead, toolGrep, toolGlob, toolWeb],
      (kernel) => kernel.domains.tool.get,
    )

    expect(rows.map((row) => row.id)).toEqual(["read", "grep", "glob", "web"])
    expect(rows.map((row) => row.kind)).toEqual(["read", "search", "search", "fetch"])
  })
})
