import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { define } from "@missingstudio/eva-sdk"
import { calling, withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { sched, serialNames } from "./index.js"

/**
 * Which calls had committed when each tool started. A call that names the one
 * before it ran after that call reached the record, which is what a barrier
 * means; a call that names nothing ran beside its neighbour.
 */
interface Board {
  readonly said: string[]
  readonly marks: { by: string; saw: readonly string[] }[]
}

const board = (): Board => ({ said: [], marks: [] })

// Two tools that both claim they may run beside another call, so what a group
// does with them is this plugin's answer and not the tools' own.
const claiming = (at: Board) =>
  define({
    id: "test.claiming",
    effect: Effect.fn("test.claiming")(function* (ctx) {
      const row = (id: string): ToolInfo => ({
        id,
        kind: "read",
        description: "reads",
        input: {},
        parallelSafe: () => true,
        execute: () =>
          Effect.sync(() => {
            at.marks.push({ by: id, saw: [...at.said] })
            return toolText("ok", id)
          }),
      })
      yield* ctx.tool.transform((draft) => {
        draft.set(row("read"))
        draft.set(row("grep"))
      })
    }),
  })

const scheduling = (at: Board, options: Record<string, unknown> = {}) =>
  withPlugin(
    sched,
    (kernel) => {
      const calls = calling(kernel, {
        emit: (payload) =>
          Effect.sync(() => {
            if (payload.kind === "tool_result") at.said.push(payload.id)
          }),
      })
      return calls.group([{ name: "read" }, { name: "grep" }])
    },
    { before: [claiming(at)], options },
  )

describe("the scheduler plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(sched.id).toBe("eva.sched")
  })

  /**
   * The whole option surface, in one assertion. There is no key that marks a
   * tool parallel-safe, so no configuration widens what a tool claimed — the
   * policy narrows, and this is the shape of that promise.
   */
  it("offers one option, and it only takes safety away", () => {
    expect(Object.keys(sched.takes ?? {})).toEqual(["serial"])
  })

  it("leaves a tool's own claim alone when it is named in nothing", async () => {
    const at = board()
    const results = await scheduling(at)

    expect(results.map((result) => result.disposition)).toEqual(["ok", "ok"])
    expect(at.marks.map((mark) => mark.saw)).toEqual([[], []])
  })

  it("makes a named tool run alone, whatever the tool claims", async () => {
    const at = board()
    const results = await scheduling(at, { serial: ["grep"] })

    expect(results.map((result) => result.disposition)).toEqual(["ok", "ok"])
    expect(at.marks.map((mark) => mark)).toEqual([
      { by: "read", saw: [] },
      { by: "grep", saw: ["call_1"] },
    ])
  })

  it("takes the claim off the row, so the row reads as unclassified", async () => {
    const rows = await withPlugin(sched, (kernel) => kernel.domains.tool.get, {
      before: [claiming(board())],
      options: { serial: ["grep"] },
    })

    expect(rows.map((row) => [row.id, row.parallelSafe === undefined])).toEqual([
      ["read", false],
      ["grep", true],
    ])
  })

  // The narrowing is a transform, so it leaves with the plugin: the tool's own
  // claim is what remains, never this plugin's edit of it.
  it("gives the claim back when it unloads", async () => {
    const rows = await withPlugin(
      sched,
      (kernel) =>
        Effect.gen(function* () {
          yield* kernel.runtime.remove("eva.sched")
          return yield* kernel.domains.tool.get
        }),
      { before: [claiming(board())], options: { serial: ["grep"] } },
    )

    expect(rows.every((row) => row.parallelSafe !== undefined)).toBe(true)
  })
})

describe("the names a build forces serial", () => {
  it("are nothing when the option is absent", () => {
    expect(serialNames({})).toEqual([])
  })

  // A list is written by a person, so an entry that is not a name is dropped
  // rather than read as one.
  it("drop an entry that is not a name", () => {
    expect(serialNames({ serial: ["bash", 7, "", null, "edit"] })).toEqual(["bash", "edit"])
  })

  it("are nothing when the option is written as another shape", () => {
    expect(serialNames({ serial: "bash" })).toEqual([])
  })
})
