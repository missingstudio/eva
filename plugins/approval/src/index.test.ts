import type { Approving, ToolDecision, ToolInfo, ToolResult } from "@missingstudio/eva-core"
import { toolText } from "@missingstudio/eva-core"
import type { ToolKind } from "@missingstudio/eva-schema"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { calling, withKernel } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { approval } from "./index.js"

const row = (id: string, kind: ToolKind): ToolInfo => ({
  id,
  kind,
  description: id,
  input: {},
  execute: () => Effect.succeed(toolText("ok", `${id} ran`)),
})

/**
 * The six tools this stage ships, by kind. The plugin's own suite registers
 * them itself rather than loading six tool plugins: what is under test is what
 * a mode does with a kind.
 */
const tools: Plugin = define({
  id: "acme.tools",
  effect: Effect.fn("acme.tools")(function* (ctx) {
    yield* ctx.tool.transform((draft) => {
      for (const one of [
        row("read", "read"),
        row("grep", "search"),
        row("web", "fetch"),
        row("edit", "edit"),
        row("bash", "execute"),
      ])
        draft.set(one)
    })
  }),
})

interface Answered {
  readonly asked: readonly string[]
  readonly result: ToolResult
}

// An asker that always answers the same way, and keeps what it was asked.
const answering =
  (kind: "allow_once" | "reject_once", asked: string[]): Approving =>
  (request) =>
    Effect.sync(() => {
      asked.push(request.toolCall.title)
      return kind === "allow_once" ? { kind } : { kind, reason: "a person refused" }
    })

/**
 * A gate that decides, the way the deterministic one does. It stands in for
 * `eva.tool.policy` here, because a plugin may never import another plugin —
 * the two real gates meet in the conformance suite.
 */
const gating = (decision: ToolDecision): Plugin =>
  define({
    id: "acme.gate",
    effect: Effect.fn("acme.gate")(function* (ctx) {
      yield* ctx.toolHooks["tool.execute.before"]((event) => {
        event.decide(decision)
      })
    }),
  })

const running = (
  config: Record<string, unknown>,
  name: string,
  args: unknown = {},
  answer: "allow_once" | "reject_once" = "allow_once",
  gates: readonly Plugin[] = [],
): Promise<Answered> =>
  withKernel(
    [tools, ...gates, approval],
    (kernel) =>
      Effect.gen(function* () {
        const asked: string[] = []
        const result = yield* calling(kernel, {
          approving: answering(answer, asked),
        }).call(name, args)
        return { asked, result }
      }),
    { config },
  )

const names = (config: Record<string, unknown>): Promise<readonly string[]> =>
  withKernel(
    [tools, approval],
    (kernel) => Effect.map(kernel.domains.tool.get, (rows) => rows.map((one) => one.id)),
    { config },
  )

describe("capability selection", () => {
  // A mode decides which tools the agent sees, and that is a rebuild of the
  // tool domain rather than a filter at call time.
  it("holds no changing row in read-only mode", async () => {
    expect(await names({ approval: { mode: "read-only" } })).toEqual(["read", "grep", "web"])
  })

  it("holds every row in autonomous mode", async () => {
    expect(await names({ approval: { mode: "autonomous" } })).toEqual([
      "read",
      "grep",
      "web",
      "edit",
      "bash",
    ])
  })

  // A row the domain does not hold is not a tool the model may call, so the
  // execution refuses the name outright.
  it("refuses a call naming a row the mode removed", async () => {
    const { result } = await running({ approval: { mode: "read-only" } }, "edit", {
      path: "one.md",
    })

    expect(result.disposition).toBe("unknown_tool")
  })
})

describe("the mandate", () => {
  it("reads in every mode", async () => {
    for (const mode of ["read-only", "supervised", "autonomous", "plan"]) {
      const { result, asked } = await running({ approval: { mode } }, "read", { path: "one.md" })
      expect(result.disposition).toBe("ok")
      expect(asked).toEqual([])
    }
  })

  it("asks about a changing call in supervised mode", async () => {
    const { result, asked } = await running({ approval: { mode: "supervised" } }, "edit", {
      path: "one.md",
    })

    expect(asked).toEqual(["edit may change something. Run it?"])
    expect(result.disposition).toBe("ok")
  })

  it("refuses the same call when the person says no", async () => {
    const { result } = await running(
      { approval: { mode: "supervised" } },
      "edit",
      { path: "one.md" },
      "reject_once",
    )

    expect(result.disposition).toBe("denied")
  })

  it("asks about nothing in autonomous mode", async () => {
    const { result, asked } = await running({ approval: { mode: "autonomous" } }, "edit", {
      path: "one.md",
    })

    expect(asked).toEqual([])
    expect(result.disposition).toBe("ok")
  })

  /**
   * Supervision is a baseline, so specific standing authority is never asked
   * about again — which is what makes an `allow_always` written into the
   * profile stop the asking. The deterministic gate is what decides here in a
   * real build; the conformance suite is where the two plugins meet.
   */
  it("asks nothing about a call another gate already allowed", async () => {
    const { result, asked } = await running(
      { approval: { mode: "supervised" } },
      "edit",
      { path: "one.md" },
      "allow_once",
      [gating({ kind: "allow_once" })],
    )

    expect(asked).toEqual([])
    expect(result.disposition).toBe("ok")
  })

  // A mandate is a decision and not a baseline, so an allow that would widen
  // it loses: the strictest decision wins.
  it("refuses a call another gate allowed, when the mode forbids the kind", async () => {
    const { result } = await running(
      { approval: { mode: "supervised", modes: { supervised: { tools: { edit: "deny" } } } } },
      "edit",
      { path: "one.md" },
      "allow_once",
      [gating({ kind: "allow_once" })],
    )

    expect(result.disposition).toBe("denied")
  })
})

describe("a per-tool override inside a mode", () => {
  it("asks about one tool in a mode that asks about nothing", async () => {
    const { asked, result } = await running(
      { approval: { mode: "autonomous", modes: { autonomous: { tools: { bash: "ask" } } } } },
      "bash",
      { command: ["ls"] },
    )

    expect(asked).toEqual(["bash is asked about in autonomous mode. Run it?"])
    expect(result.disposition).toBe("ok")
  })

  it("refuses one tool as a mandate", async () => {
    const { asked, result } = await running(
      { approval: { mode: "autonomous", modes: { autonomous: { tools: { edit: "deny" } } } } },
      "edit",
      { path: "one.md" },
    )

    expect(asked).toEqual([])
    expect(result.disposition).toBe("denied")
  })

  it("leaves the other tools of the mode alone", async () => {
    const { result } = await running(
      { approval: { mode: "autonomous", modes: { autonomous: { tools: { edit: "deny" } } } } },
      "bash",
      { command: ["ls"] },
    )

    expect(result.disposition).toBe("ok")
  })
})

// A gate that cannot read its own configuration is not a gate.
describe("a build whose modes cannot be read", () => {
  it("denies every call and names what is wrong", async () => {
    const { result } = await running({ approval: { mode: "yolo" } }, "read", { path: "one.md" })

    expect(result.disposition).toBe("denied")
    const said = result.content[0]
    expect(said?.type === "text" && said.text).toContain("no mode is named yolo")
  })
})
