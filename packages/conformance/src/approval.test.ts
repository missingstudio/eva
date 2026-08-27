import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { approval, remembering } from "@missingstudio/eva-approval"
import { makeSessionAPI, type Kernel } from "@missingstudio/eva-boot"
import type { Approving, Command, ModelRef, ToolResult } from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import type { Event, Payload } from "@missingstudio/eva-schema"
import type { CommandContext } from "@missingstudio/eva-sdk"
import {
  calling,
  CALLING_SESSION,
  committed,
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
import { parse } from "yaml"
import { describe, expect, it } from "vitest"

/**
 * The four-option gate, the mandate, and the mode — in front of the real write
 * tool and the real command tool, beside the real deterministic gate.
 *
 * A plugin may never import another plugin, so this is where `eva.approval`
 * and `eva.tool.policy` meet. What is proven here is what needs both: that a
 * mandate outranks a rule that would widen it, that a rule a person wrote is
 * not asked about a second time, and that an `allow_always` reaches disk in the
 * form the other gate reads back.
 *
 * Nothing spawns. The Sandbox slot holds a double that remembers what it was
 * asked to run and runs nothing.
 */

const MODEL: ModelRef = { provider: "anthropic", model: "claude-sonnet-4-5" }

// One answer to every ask, and what it was asked. A suite that names none is a
// run with nobody to answer.
const answering =
  (
    outcome: "allow_once" | "allow_always" | "reject_once" | "reject_always",
    asked: string[],
  ): Approving =>
  (request) =>
    Effect.sync(() => {
      asked.push(request.toolCall.title)
      return outcome === "allow_once" || outcome === "allow_always"
        ? { kind: outcome }
        : { kind: outcome, reason: "a person refused" }
    })

interface Bench {
  readonly call: (name: string, args: unknown) => Effect.Effect<ToolResult>
  readonly asked: readonly string[]
  readonly ran: readonly Command[]
  readonly held: () => Readonly<Record<string, string>>
  // `/mode <name>`, through the row `eva.approval` registered.
  readonly mode: (name?: string) => Effect.Effect<readonly string[]>
  readonly record: Effect.Effect<readonly Event[]>
}

const bench = <A>(
  body: (found: Bench, kernel: Kernel) => Effect.Effect<A>,
  options: {
    readonly config?: Record<string, unknown>
    readonly seed?: Readonly<Record<string, string>>
    readonly approving?: Approving
    readonly asked?: string[]
  } = {},
): Promise<A> => {
  const virtual = virtualFileSystem(options.seed ?? { "one.md": "before\n" })
  const sandbox = spyingSandbox()
  const asked = options.asked ?? []

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
      approval,
    ],
    (kernel, scope) =>
      Effect.gen(function* () {
        const recorder = yield* kernel.slot.recorder.peek
        if (recorder !== undefined) yield* recorder.open(CALLING_SESSION)
        const api = yield* makeSessionAPI(kernel, MODEL, scope)
        // The payloads reach the real Trace beside the log, so a denial is
        // read back off the record and not off the call's own answer.
        const calls = calling(kernel, {
          ...(options.approving === undefined ? {} : { approving: options.approving }),
          ...(recorder === undefined ? {} : { emit: (payload) => recorder.commit([payload]) }),
        })

        const mode = Effect.fn("test.mode")(function* (name?: string) {
          const row = (yield* kernel.domains.command.get).find((one) => one.id === "mode")
          const said: string[] = []
          const context: CommandContext = {
            api: api.session,
            session: CALLING_SESSION,
            ...(name === undefined ? {} : { argument: name }),
            write: (text) => void said.push(text),
            select: () => {},
          }
          yield* row?.run?.(context) ?? Effect.void
          return said as readonly string[]
        })

        return yield* body(
          {
            call: calls.call,
            asked,
            ran: sandbox.asked,
            held: virtual.files,
            mode,
            record: committed(kernel),
          },
          kernel,
        )
      }),
    { config: options.config ?? {} },
  )
}

const EDIT = { path: "one.md", hunks: [{ find: "before", replace: "after" }] }

/**
 * What a person is asked about that Edit. The question carries the change,
 * because the arguments are the Edit and the gate holds the two slots that
 * resolve it.
 */
const ASKED = ["edit changes one.md, 1 hunk:", "- before", "+ after", "Run it?"].join("\n")

const textOf = (result: ToolResult): string =>
  result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")

const payloadsOf = (record: readonly Event[]): readonly Payload[] =>
  record.map((event) => event.payload)

/**
 * The exit clause. It is proven on one live kernel and one Session: the same
 * process that ran the write refuses the next one.
 */
describe("changing a live session from autonomous to read-only", () => {
  it("takes effect before the next tool call", async () => {
    await bench(
      (found) =>
        Effect.gen(function* () {
          expect((yield* found.call("edit", EDIT)).disposition).toBe("ok")
          expect(found.held()["one.md"]).toBe("after\n")

          yield* found.mode("read-only")

          const after = yield* found.call("edit", {
            path: "one.md",
            hunks: [{ find: "after", replace: "again" }],
          })
          // The row left the domain, so the execution refuses the name. A
          // mode is capability selection and not a filter at call time.
          expect(after.disposition).toBe("unknown_tool")
          expect(found.held()["one.md"]).toBe("after\n")
        }),
      { config: { approval: { mode: "autonomous" } } },
    )
  })

  it("lands a mode payload on the Trace", async () => {
    await bench(
      (found) =>
        Effect.gen(function* () {
          yield* found.mode("read-only")

          expect(payloadsOf(yield* found.record)).toContainEqual({
            kind: "mode",
            mode: "read-only",
            reason: "a person named it",
          })
        }),
      { config: { approval: { mode: "autonomous" } } },
    )
  })

  it("says which mode is open, and names the four", async () => {
    await bench(
      (found) =>
        Effect.gen(function* () {
          expect(yield* found.mode()).toEqual([
            "mode: autonomous",
            expect.stringContaining("read-only"),
            expect.stringContaining("supervised"),
            expect.stringContaining("autonomous"),
            expect.stringContaining("plan"),
          ])
        }),
      { config: { approval: { mode: "autonomous" } } },
    )
  })

  it("keeps the mode it had when a person names one that does not exist", async () => {
    await bench(
      (found) =>
        Effect.gen(function* () {
          expect((yield* found.mode("yolo"))[0]).toContain("no mode is named yolo")
          expect((yield* found.call("edit", EDIT)).disposition).toBe("ok")
        }),
      { config: { approval: { mode: "autonomous" } } },
    )
  })
})

describe("all four options, through the gate and the real write tool", () => {
  const under = (
    outcome: "allow_once" | "allow_always" | "reject_once" | "reject_always",
  ): Promise<{ readonly result: ToolResult; readonly held: string | undefined }> => {
    const asked: string[] = []
    return bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("edit", EDIT)
          expect(found.asked).toEqual([ASKED])
          return { result, held: found.held()["one.md"] }
        }),
      {
        config: { approval: { mode: "supervised" } },
        approving: answering(outcome, asked),
        asked,
      },
    )
  }

  it.each(["allow_once", "allow_always"] as const)("writes the file on %s", async (outcome) => {
    const { result, held } = await under(outcome)
    expect(result.disposition).toBe("ok")
    expect(held).toBe("after\n")
  })

  it.each(["reject_once", "reject_always"] as const)(
    "leaves the file alone on %s",
    async (outcome) => {
      const { result, held } = await under(outcome)
      expect(result.disposition).toBe("denied")
      expect(textOf(result)).toBe("a person refused")
      expect(held).toBe("before\n")
    },
  )
})

/**
 * The demo's own words: "every write previewed, y/n". The preview is in the
 * question, resolved from the arguments over the real applier and the real
 * file system — so what a person answers about is the change, and the tool is
 * asked nothing.
 */
describe("the question about a write", () => {
  const asking = (
    args: unknown,
    seed?: Readonly<Record<string, string>>,
  ): Promise<{ readonly asked: readonly string[]; readonly held: string | undefined }> => {
    const asked: string[] = []
    return bench(
      (found) =>
        Effect.map(found.call("edit", args), () => ({
          asked: found.asked,
          held: found.held()["one.md"],
        })),
      {
        config: { approval: { mode: "supervised" } },
        approving: answering("reject_once", asked),
        asked,
        ...(seed === undefined ? {} : { seed }),
      },
    )
  }

  // Two hunks, each side one line: a whole diff in a prompt is its own
  // defect, and the whole diff is on the Trace.
  it("shows the change, on one line a side and bounded to two hunks", async () => {
    const found = await asking(
      {
        path: "one.md",
        hunks: [
          { find: "alpha\nbeta", replace: "one\ntwo" },
          { find: "gamma", replace: "three" },
          { find: "two", replace: "2" },
        ],
      },
      { "one.md": "alpha\nbeta\ngamma\n" },
    )

    expect(found.asked).toEqual([
      [
        "edit changes one.md, 3 hunks:",
        "- alpha beta",
        "+ one two",
        "- gamma",
        "+ three",
        "… and 1 more",
        "Run it?",
      ].join("\n"),
    ])
  })

  // A person told the change cannot land does not have to approve a call to
  // find out. The applier answers that, and the words are still shown.
  it("says when the change does not resolve", async () => {
    const found = await asking({ path: "one.md", hunks: [{ find: "missing", replace: "after" }] })

    expect(found.asked[0]).toContain("edit cannot change one.md — hunk_missing:")
    expect(found.asked[0]).toContain("- missing")
    expect(found.held).toBe("before\n")
  })

  // A call that names no Edit is asked about the way it always was: the
  // preview reads the shape and never the tool's name.
  it("asks the standing question about a call that names no edit", async () => {
    const asked: string[] = []
    const found = await bench(
      (found) => Effect.map(found.call("bash", { command: ["ls"] }), () => found.asked),
      {
        config: { approval: { mode: "supervised" } },
        approving: answering("reject_once", asked),
        asked,
      },
    )

    expect(found).toEqual(["bash may change something. Run it?"])
  })
})

/**
 * A permission request with nobody to answer it is a denial. `overSurface`
 * covers the surface half — no surface, or one that takes no input; this is the
 * execution half, where a build wired no asker at all.
 */
describe("a supervised call with nobody to answer it", () => {
  it("is denied, and the denial is on the record", async () => {
    await bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("edit", EDIT)

          expect(result.disposition).toBe("denied")
          expect(textOf(result)).toBe(`nobody answered: ${ASKED}`)
          expect(found.held()["one.md"]).toBe("before\n")
          expect(
            payloadsOf(yield* found.record).find((one) => one.kind === "tool_result"),
          ).toMatchObject({ id: "call_1", name: "edit", disposition: "denied" })
        }),
      { config: { approval: { mode: "supervised" } } },
    )
  })
})

describe("a profile rule beside a mode", () => {
  /**
   * A rule is standing authority, so supervision does not ask about a call the
   * rule set already allowed. Without this an `allow_always` written into the
   * profile would be asked about on every call forever.
   */
  it("stops the asking when the rule allows the call", async () => {
    const asked: string[] = []
    await bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("bash", { command: ["git", "status"] })

          expect(found.asked).toEqual([])
          expect(result.disposition).toBe("ok")
          expect(found.ran.map((one) => one.argv)).toEqual([["git", "status"]])
        }),
      {
        config: {
          approval: { mode: "supervised" },
          policy: { rules: [{ allow: [["git"], ["status"]] }] },
        },
        approving: answering("allow_once", asked),
        asked,
      },
    )
  })

  // The narrowing direction: the mode allows and the rule asks, so a person is
  // asked. A profile may always be stricter than the mode it runs under.
  it("narrows a mode that would have allowed the call", async () => {
    const asked: string[] = []
    await bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("bash", { command: ["git", "push"] })

          expect(found.asked).toHaveLength(1)
          expect(result.disposition).toBe("ok")
        }),
      {
        config: {
          approval: { mode: "autonomous" },
          policy: { rules: [{ ask: [["git"], ["push"]], why: "a push leaves this machine" }] },
        },
        approving: answering("allow_once", asked),
        asked,
      },
    )
  })

  /**
   * The widening direction: the profile allows and the mode's mandate refuses.
   * The mandate wins, and nothing here checks for that — the strictest decision
   * wins, and an allow is the least strict thing there is.
   */
  it("loses when it would widen a mandate", async () => {
    const asked: string[] = []
    await bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("bash", { command: ["git", "push"] })

          expect(found.asked).toEqual([])
          expect(result.disposition).toBe("denied")
          expect(textOf(result)).toBe("bash is denied in autonomous mode")
          expect(found.ran).toEqual([])
        }),
      {
        config: {
          approval: { mode: "autonomous", modes: { autonomous: { tools: { bash: "deny" } } } },
          policy: { rules: [{ allow: [["git"], ["push"]] }] },
        },
        approving: answering("allow_once", asked),
        asked,
      },
    )
  })

  /**
   * And the protected paths, which no profile and no answer may pre-approve. A
   * person may still approve one call — the roadmap's words are "never
   * auto-approved" — and the next call asks again, because the safety check is
   * computed before the rules and `allow_always` writes no rule for a call that
   * names no words.
   */
  it("never pre-approves a protected path, whatever a person answered", async () => {
    const asked: string[] = []
    await bench(
      (found) =>
        Effect.gen(function* () {
          yield* found.call("edit", {
            path: ".mcp.json",
            hunks: [{ find: "{}", replace: '{ "acme": {} }' }],
          })
          yield* found.call("edit", {
            path: ".mcp.json",
            hunks: [{ find: '{ "acme": {} }', replace: "{}" }],
          })

          expect(found.asked).toHaveLength(2)
          for (const question of found.asked) expect(question).toContain(".mcp.json")
        }),
      {
        seed: { ".mcp.json": "{}" },
        config: {
          approval: { mode: "autonomous" },
          policy: { rules: [{ allow: [["anything"]] }] },
        },
        approving: answering("allow_always", asked),
        asked,
      },
    )
  })
})

/**
 * `allow_always` has to reach disk in a form a later Run reads back, and the
 * form is the rule language the deterministic gate already reads. Two kernels,
 * one file: the first writes the grant, the second is never asked.
 */
describe("an allow_always", () => {
  it("persists as a profile rule a later Run reads", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "eva-approval-")), "config.yaml")
    const first: string[] = []

    await bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("bash", { command: ["git", "status"] })
          expect(found.asked).toHaveLength(1)
          expect(result.disposition).toBe("ok")
        }),
      {
        config: { approval: { mode: "supervised" } },
        approving: remembering(answering("allow_always", first), { EVA_CONFIG: path }),
        asked: first,
      },
    )

    // The mapping the file holds is what the kernel hands a plugin from that
    // layer, so a second kernel over it is a later Run over the same profile.
    const written = parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const second: string[] = []

    await bench(
      (found) =>
        Effect.gen(function* () {
          const result = yield* found.call("bash", { command: ["git", "status"] })

          expect(found.asked).toEqual([])
          expect(result.disposition).toBe("ok")
          expect(found.ran.map((one) => one.argv)).toEqual([["git", "status"]])
        }),
      {
        config: { ...written, approval: { mode: "supervised" } },
        approving: answering("allow_once", second),
        asked: second,
      },
    )
  })
})

// A mode is a named agent definition, which is where the four are published.
describe("the agent domain", () => {
  it("holds one row per mode", async () => {
    await bench((_found, kernel) =>
      Effect.gen(function* () {
        const rows = yield* kernel.domains.agent.get
        expect(rows.map((row) => row.id)).toEqual(["read-only", "supervised", "autonomous", "plan"])
        for (const row of rows) expect(row.prompt).toBeTypeOf("string")
      }),
    )
  })
})
