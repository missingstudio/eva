import { executeTool, toolText, type ToolCall, type ToolInfo } from "@missingstudio/eva-core"
import { define, type BroadcastMap, type Plugin } from "@missingstudio/eva-sdk"
import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { Effect, Exit, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, type Kernel } from "./boot.js"
import { toolDeps } from "./deps.js"

const call: ToolCall = {
  id: "call_1",
  name: "read",
  args: { path: "one.md" },
  session: sessionID("sess_tool"),
}

const reading = (answer: string, seen: unknown[] = []): ToolInfo => ({
  id: "read",
  kind: "read",
  description: "reads",
  input: {},
  execute: (input) =>
    Effect.sync(() => {
      seen.push(input)
      return toolText("ok", answer)
    }),
})

// A plugin that registers one tool row, the way every tool plugin does.
const registering = (row: ToolInfo, id = "acme.tool"): Plugin =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      yield* ctx.tool.transform((draft) => {
        draft.set(row)
      })
    }),
  })

interface Ran {
  readonly disposition: string
  readonly text: string
  readonly said: readonly Payload[]
  readonly failures: readonly BroadcastMap["plugin.failed"][]
}

/**
 * One call over a live kernel, through the execution the composition root
 * builds. Boot is where a boundary's kind and a hook's owner are stamped, so
 * the tool boundaries are pinned against a real boot rather than a double.
 */
const calling = (plugins: readonly Plugin[], one: ToolCall = call): Promise<Ran> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const failures: BroadcastMap["plugin.failed"][] = []
      const kernel: Kernel = yield* boot({
        scope,
        resolved: plugins.map((plugin) => ({ id: plugin.id })),
        build: buildOf(plugins),
      })
      yield* Effect.forkIn(
        Stream.runForEach(kernel.broadcast.subscribe("plugin.failed"), (payload) =>
          Effect.sync(() => void failures.push(payload)),
        ),
        scope,
      )
      yield* Effect.yieldNow

      const said: Payload[] = []
      const deps = toolDeps(kernel, (payload) => Effect.sync(() => void said.push(payload)))
      const result = yield* executeTool(deps, one)
      yield* Scope.close(scope, Exit.void)

      const first = result.content[0]
      return {
        disposition: result.disposition,
        text: first?.type === "text" ? first.text : "",
        said,
        failures,
      }
    }),
  )

describe("the tool domain, as the execution reads it", () => {
  it("answers the row a plugin registered, by the name the model called", async () => {
    const ran = await calling([registering(reading("hello"))])

    expect(ran.disposition).toBe("ok")
    expect(ran.text).toBe("hello")
  })

  it("refuses a name no row holds, and does not fail the call", async () => {
    const ran = await calling([registering(reading("hello"))], { ...call, name: "write" })

    expect(ran.disposition).toBe("unknown_tool")
    expect(ran.said.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "tool_update",
      "tool_result",
    ])
  })

  // The rows are what the transforms put there, so a plugin that unloads
  // takes its tool with it — which is how a mode change rebuilds the set an
  // agent sees.
  it("holds no row for a plugin that unloaded", async () => {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const plugin = registering(reading("hello"))
        const kernel = yield* boot({
          scope,
          resolved: [{ id: plugin.id }],
          build: buildOf([plugin]),
        })
        const before = (yield* kernel.domains.tool.get).length
        yield* kernel.runtime.remove(plugin.id)
        const after = (yield* kernel.domains.tool.get).length
        yield* Scope.close(scope, Exit.void)
        return { before, after }
      }),
    )

    expect(rows).toEqual({ before: 1, after: 0 })
  })
})

describe("tool.resolve", () => {
  it("replaces which tool answers the name", async () => {
    const other = registering(reading("hello"))
    const swap = define({
      id: "acme.swap",
      effect: Effect.fn("acme.swap")(function* (ctx) {
        yield* ctx.toolHooks["tool.resolve"]((event) => {
          event.resolve({ ...reading("from the hook"), id: event.name })
        })
      }),
    })

    const ran = await calling([other, swap])

    expect(ran.text).toBe("from the hook")
  })

  // It observes: it states which tool answers and never whether the call
  // proceeds, so a broken one is reported and the call goes on.
  it("is reported as its plugin's failure when it throws, and the row still answers", async () => {
    const broken = define({
      id: "acme.broken",
      effect: Effect.fn("acme.broken")(function* (ctx) {
        yield* ctx.toolHooks["tool.resolve"](() => {
          throw new Error("the observer broke")
        })
      }),
    })

    const ran = await calling([registering(reading("hello")), broken])

    expect(ran.disposition).toBe("ok")
    expect(ran.failures.map((one) => [one.id, one.hook])).toEqual([["acme.broken", "tool.resolve"]])
  })
})

describe("tool.execute.before", () => {
  it("denies the call when a hook rejects it", async () => {
    const gate = define({
      id: "acme.gate",
      effect: Effect.fn("acme.gate")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"]((event) => {
          event.decide({ kind: "reject_once", reason: `${event.name} is not in this profile` })
        })
      }),
    })
    const seen: unknown[] = []

    const ran = await calling([registering(reading("hello", seen)), gate])

    expect(ran.disposition).toBe("denied")
    expect(ran.text).toBe("read is not in this profile")
    expect(seen).toEqual([])
  })

  /**
   * The rule this stage brings: a hook at a deciding boundary that dies is a
   * denial. The kernel hands the failure back and the caller reads it, because
   * a gate that fails open because a plugin threw is not a gate.
   */
  it("denies the call when a hook throws, and names the hook and the plugin", async () => {
    const broken = define({
      id: "acme.broken",
      effect: Effect.fn("acme.broken")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"](() => {
          throw new Error("the gate broke")
        })
      }),
    })
    const seen: unknown[] = []

    const ran = await calling([registering(reading("hello", seen)), broken])

    expect(ran.disposition).toBe("denied")
    expect(ran.text).toBe("the tool.execute.before hook of acme.broken failed")
    expect(seen).toEqual([])
  })

  /**
   * The wiring, and only the wiring: both halves of the boundary reach the
   * settlement from real plugins, and what it answered is what the call did.
   * The precedence among a decision, a baseline and a hook that died is
   * `settled`'s, and its table is in `@missingstudio/eva-core`.
   */
  it("carries a decision and a baseline from two plugins to the settlement", async () => {
    const supervising = define({
      id: "acme.mode",
      effect: Effect.fn("acme.mode")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"]((event) => {
          event.otherwise({ kind: "ask", question: "may it?" })
        })
      }),
    })
    const allow = define({
      id: "acme.rule",
      effect: Effect.fn("acme.rule")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"]((event) => {
          event.decide({ kind: "allow_once" })
        })
      }),
    })
    const deny = define({
      id: "acme.deny",
      effect: Effect.fn("acme.deny")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"]((event) => {
          event.decide({ kind: "reject_always", reason: "a mandate" })
        })
      }),
    })

    // A baseline nothing decided against is what the call answers to.
    const asked = await calling([registering(reading("hello")), supervising])
    expect(asked.disposition).toBe("denied")
    expect(asked.text).toBe("nobody could be asked: may it?")

    // A decision outranks every baseline, and the strictest decision wins.
    const ran = await calling([registering(reading("hello")), supervising, allow, deny])
    expect(ran.disposition).toBe("denied")
    expect(ran.text).toBe("a mandate")

    // With nothing to deny it, the rule's own decision runs the call.
    const went = await calling([registering(reading("hello")), supervising, allow])
    expect(went.disposition).toBe("ok")
  })

  it("hands the tool the arguments a hook left", async () => {
    const rewrite = define({
      id: "acme.rewrite",
      effect: Effect.fn("acme.rewrite")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.before"]((event) => {
          event.args.update(() => ({ path: "two.md" }))
        })
      }),
    })
    const seen: unknown[] = []

    const ran = await calling([registering(reading("hello", seen)), rewrite])

    expect(seen).toEqual([{ path: "two.md" }])
    expect(ran.said[0]?.kind === "tool_call" && ran.said[0].args).toEqual({ path: "two.md" })
  })
})

describe("tool.execute.after", () => {
  it("reads the result and may replace it", async () => {
    const trim = define({
      id: "acme.trim",
      effect: Effect.fn("acme.trim")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.after"]((event) => {
          event.result.update(() => toolText("ok", "trimmed"))
        })
      }),
    })

    const ran = await calling([registering(reading("hello")), trim])

    expect(ran.text).toBe("trimmed")
  })

  it("is reported as its plugin's failure when it throws, and the result survives", async () => {
    const broken = define({
      id: "acme.broken",
      effect: Effect.fn("acme.broken")(function* (ctx) {
        yield* ctx.toolHooks["tool.execute.after"](() => {
          throw new Error("the observer broke")
        })
      }),
    })

    const ran = await calling([registering(reading("hello")), broken])

    expect(ran.text).toBe("hello")
    expect(ran.failures.map((one) => [one.id, one.hook])).toEqual([
      ["acme.broken", "tool.execute.after"],
    ])
  })
})
