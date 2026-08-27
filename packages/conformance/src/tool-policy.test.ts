import type { Kernel } from "@missingstudio/eva-boot"
import type { Command, ToolResult } from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import type { Payload } from "@missingstudio/eva-schema"
import {
  calling,
  CALLING_SESSION,
  spyingSandbox,
  virtualFileSystem,
  withKernel,
} from "@missingstudio/eva-testkit"
import { toolBash } from "@missingstudio/eva-tool-bash"
import { toolEdit } from "@missingstudio/eva-tool-edit"
import { toolPolicy } from "@missingstudio/eva-tool-policy"
import { toolRead } from "@missingstudio/eva-tool-read"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The deterministic gate in front of the real write tool and the real command
 * tool. The gate's own decisions are held beside it in `plugins/tool-policy`;
 * what is here is the half that needs three plugins at once — that a refusal
 * reaches the tool as a `denied` result, that the file is not written, and that
 * the command never reaches the Sandbox.
 *
 * A plugin may not import another plugin, so this suite lives in this package.
 *
 * Nothing spawns. The Sandbox slot holds a double that records what it was
 * asked to run and runs nothing, so a gate that regressed is caught by an empty
 * record rather than by a machine that lost a directory.
 */

// A profile that allows every command these tests name. It is here so the
// refusals below are proven against a rule set that wanted to allow them.
const PERMISSIVE = {
  policy: {
    rules: [{ allow: ["cp"] }, { allow: ["rm"] }, { allow: ["git", ["status", "diff"]] }],
  },
}

interface Bench {
  readonly call: (name: string, args: unknown) => Effect.Effect<ToolResult>
  readonly said: () => readonly Payload[]
  readonly asked: readonly Command[]
  readonly held: () => Readonly<Record<string, string>>
}

const bench = <A>(
  seed: Readonly<Record<string, string>>,
  body: (found: Bench, kernel: Kernel) => Effect.Effect<A>,
  config: Record<string, unknown> = {},
): Promise<A> => {
  const virtual = virtualFileSystem(seed)
  const sandbox = spyingSandbox()

  return withKernel(
    [
      traceMemory,
      trace,
      diff,
      virtual.plugin,
      sandbox.plugin,
      toolRead,
      toolEdit,
      toolBash,
      toolPolicy,
    ],
    (kernel) =>
      Effect.gen(function* () {
        const recorder = yield* kernel.slot.recorder.peek
        if (recorder !== undefined) yield* recorder.open(CALLING_SESSION)
        const calls = calling(kernel)
        return yield* body(
          {
            call: calls.call,
            said: calls.said,
            asked: sandbox.asked,
            held: virtual.files,
          },
          kernel,
        )
      }),
    { config },
  )
}

const textOf = (result: ToolResult): string =>
  result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")

const resultOf = (said: readonly Payload[]): Payload | undefined =>
  said.find((payload) => payload.kind === "tool_result")

describe("the gate in front of eva.tool.edit", () => {
  /**
   * The exit clause, on the write door: the rule set allows every command it
   * could, and `.mcp.json` is refused anyway. Settings reach the rules and the
   * rules are judged beside the protected paths, never over them.
   */
  it("refuses a write to .mcp.json, and the file is unchanged", async () => {
    const before = '{ "mcpServers": {} }'
    await bench(
      { ".mcp.json": before },
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("edit", {
            path: ".mcp.json",
            hunks: [{ find: "{}", replace: '{ "acme": { "command": "acme-mcp" } }' }],
          })
          expect(result.disposition).toBe("denied")
          expect(textOf(result)).toContain(".mcp.json")
          expect(found.held()[".mcp.json"]).toBe(before)
          expect(resultOf(found.said())).toMatchObject({
            kind: "tool_result",
            disposition: "denied",
          })
        }),
      PERMISSIVE,
    )
  })

  it.each([".git/config", ".github/workflows/ci.yml", "package.json", ".envrc"])(
    "refuses a write to %s",
    async (path) => {
      await bench({ [path]: "one\n" }, (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("edit", {
            path,
            hunks: [{ find: "one", replace: "two" }],
          })
          expect(result.disposition).toBe("denied")
          expect(found.held()[path]).toBe("one\n")
        }),
      )
    },
  )

  /**
   * The row's `kind` is what decides, and these two rows name the same file.
   * Reading a dependency manifest is most of what an agent does first, and the
   * rule the roadmap states is about writes.
   */
  it("lets a read of the same file through, and refuses the write", async () => {
    await bench({ "package.json": '{ "name": "eva" }' }, (found) =>
      Effect.gen(function* () {
        const read = yield* found.call("read", { path: "package.json" })
        expect(read.disposition).toBe("ok")

        const write = yield* found.call("edit", {
          path: "package.json",
          hunks: [{ find: "eva", replace: "acme" }],
        })
        expect(write.disposition).toBe("denied")
      }),
    )
  })

  // The gate is not a blanket refusal: a write the list does not name lands.
  it("lets a write to a file no rule protects through", async () => {
    await bench({ "src/one.ts": "const one = 1\n" }, (found) =>
      Effect.gen(function* () {
        const result = yield* found.call("edit", {
          path: "src/one.ts",
          hunks: [{ find: "one = 1", replace: "one = 2" }],
        })
        expect(result.disposition).toBe("ok")
        expect(found.held()["src/one.ts"]).toBe("const one = 2\n")
      }),
    )
  })
})

describe("the gate in front of eva.tool.bash", () => {
  const denied = (command: readonly string[], config: Record<string, unknown> = PERMISSIVE) =>
    bench(
      {},
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("bash", { command })
          expect(result.disposition).toBe("denied")
          // The refusal is what stops the command: the Sandbox was never asked.
          expect(found.asked).toEqual([])
          return textOf(result)
        }),
      config,
    )

  it("refuses rm -rf /, and the command never reaches the Sandbox", async () => {
    expect(await denied(["rm", "-rf", "/"])).toContain("cannot be undone")
  })

  it("refuses rm -rf / written as a shell line", async () => {
    expect(await denied(["bash", "-c", "rm -rf /"])).toContain("cannot be undone")
  })

  it("fails closed on an opaque invocation", async () => {
    expect(await denied(["bash", "-c", "echo x > $VAR"])).toContain("one opaque invocation")
  })

  it("refuses a command that names a protected path", async () => {
    expect(await denied(["cp", "rules.json", ".mcp.json"])).toContain(".mcp.json")
  })

  // One denied part denies the call, and the parts before it do not run
  // either: the gate answers before the tool starts anything.
  it("refuses a whole chain for one denied part", async () => {
    expect(await denied(["bash", "-c", "git status && rm -rf /"])).toContain("cannot be undone")
  })

  /**
   * The gate judged the parts and the tool ran the words it was handed. Two
   * splitters that disagree is the hole the gate exists to close, so the chain
   * reaches the Sandbox whole.
   */
  it("runs a chain whose every part a rule allows, as the words it was given", async () => {
    await bench(
      {},
      (found) =>
        Effect.gen(function* () {
          const command = ["bash", "-c", "git status && git diff"]
          const result = yield* found.call("bash", { command })
          expect(result.disposition).toBe("ok")
          expect(found.asked.map((one) => one.argv)).toEqual([command])
        }),
      PERMISSIVE,
    )
  })
})
