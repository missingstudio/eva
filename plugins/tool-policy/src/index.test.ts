import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { calling, withKernel } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { toolPolicy } from "./index.js"

/**
 * A tool row the gate can decide about, and nothing else. It stands in for
 * every tool: a plugin may not import another plugin, and what the gate reads
 * is the arguments rather than which plugin registered the row.
 */
const ROW: ToolInfo = {
  id: "bash",
  kind: "execute",
  description: "runs a command",
  input: {},
  execute: () => Effect.succeed(toolText("ok", "it ran")),
}

const rowPlugin = (row: ToolInfo = ROW): Plugin =>
  define({
    id: "test.tool.row",
    effect: Effect.fn("test.tool.row")(function* (ctx) {
      yield* ctx.tool.transform((draft) => {
        draft.set(row)
      })
    }),
  })

// A hook at the deciding boundary that dies where it stands.
const dying = define({
  id: "test.policy.dying",
  effect: Effect.fn("test.policy.dying")(function* (ctx) {
    yield* ctx.toolHooks["tool.execute.before"](() => {
      throw new Error("the rule file went away")
    })
  }),
})

const called = (
  name: string,
  args: unknown,
  config: Record<string, unknown> = {},
  extra: readonly Plugin[] = [],
) =>
  withKernel([rowPlugin(), toolPolicy, ...extra], (kernel) => calling(kernel).call(name, args), {
    config,
  })

describe("eva.tool.policy", () => {
  it("is the plugin the design names, and reads one config key", () => {
    expect(toolPolicy.id).toBe("eva.tool.policy")
    expect(toolPolicy.reads).toEqual({ policy: "mapping" })
  })

  /**
   * The whole gate, with nothing else in the kernel: no provider, no slot, no
   * model, no key. This is what makes the gate a CI artifact — every clause
   * below is a call and an assertion, and nothing in the room answers with a
   * guess.
   */
  it("decides with nothing else loaded", async () => {
    const found = await called("bash", { command: ["rm", "-rf", "/"] })
    expect(found.disposition).toBe("denied")
    expect(found.content).toEqual([
      { type: "text", text: "a remove at a root or at the working tree cannot be undone" },
    ])
  })

  it("lets a call no rule names through to the tool", async () => {
    const found = await called("bash", { command: ["npm", "test"] })
    expect(found.disposition).toBe("ok")
  })

  it("refuses a protected path, whatever a profile allows", async () => {
    const found = await called(
      "bash",
      { command: ["cp", "rules.json", ".mcp.json"] },
      { policy: { rules: [{ allow: ["cp"] }] } },
    )
    expect(found.disposition).toBe("denied")
    expect(found.content[0]).toMatchObject({ text: expect.stringContaining(".mcp.json") })
  })

  it("fails closed on an opaque invocation", async () => {
    const found = await called("bash", { command: ["bash", "-c", "echo x > $VAR"] })
    expect(found.disposition).toBe("denied")
    expect(found.content[0]).toMatchObject({
      text: expect.stringContaining("one opaque invocation"),
    })
  })

  /**
   * A gate that cannot read its own rules denies every call. Running with the
   * half of a rule set it could read would let a profile whose deny rule has a
   * typo go on allowing.
   */
  it("denies every call when it cannot read its rules", async () => {
    const found = await called("bash", { command: ["npm", "test"] }, { policy: { rules: [{}] } })
    expect(found.disposition).toBe("denied")
    expect(found.content[0]).toMatchObject({
      text: expect.stringContaining("eva policy check"),
    })
  })

  /**
   * `tool.execute.before` is a deciding boundary, so a hook there that throws
   * is the boundary's answer. The gate allows this call and the dying hook
   * still denies it.
   */
  it("denies a call whose policy hook throws", async () => {
    const found = await called("bash", { command: ["npm", "test"] }, {}, [dying])
    expect(found.disposition).toBe("denied")
    expect(found.content).toEqual([
      { type: "text", text: "the tool.execute.before hook of test.policy.dying failed" },
    ])
  })
})
