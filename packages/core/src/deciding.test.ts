import { describe, expect, it } from "vitest"
import {
  editOf,
  looksOnly,
  optionFor,
  PERMISSION_OPTIONS,
  strictest,
  type ToolDecision,
} from "./deciding.js"

/**
 * The words a gate reasons in. Nothing here runs a tool, so every clause is a
 * value in and a value out — which is what makes a gate plugin's own suite
 * short.
 */

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

describe("the options a person is offered", () => {
  it("offers ACP's four options and no others", () => {
    expect(PERMISSION_OPTIONS.map((one) => one.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
      "reject_always",
    ])
    // The answer names an option by id, so a second spelling of an option
    // would be a table to keep in step with the kinds.
    for (const one of PERMISSION_OPTIONS) expect(one.optionId).toBe(one.kind)
  })

  it("reads an option from its id, or from the words a person is offered", () => {
    expect(optionFor("allow_always")).toBe("allow_always")
    expect(optionFor("  Reject Once ")).toBe("reject_once")
    expect(optionFor("maybe")).toBeUndefined()
  })
})

/**
 * The tool kinds that only look. A kind this list does not name may change
 * something, which is the direction a gate fails in.
 */
describe("a tool kind that only looks", () => {
  it.each(["read", "search", "think", "fetch"] as const)("says %s only looks", (kind) => {
    expect(looksOnly(kind)).toBe(true)
  })

  it.each(["edit", "execute", "other"] as const)("says %s may change something", (kind) => {
    expect(looksOnly(kind)).toBe(false)
  })
})

/**
 * The one reader of an Edit's arguments. The write tool runs what it answers
 * and the approval gate previews it, so this table is the whole of what
 * "the arguments name an Edit" means — there is no second table to agree with.
 */
describe("the arguments read as an Edit", () => {
  it("reads a path and its hunks", () => {
    expect(editOf({ path: "one.md", hunks: [{ find: "a", replace: "b" }] })).toEqual({
      path: "one.md",
      hunks: [{ find: "a", replace: "b" }],
    })
  })

  // The flag rides along, so a gate asked about a dry run knows it is one.
  it("carries the dry-run flag", () => {
    expect(editOf({ path: "one.md", hunks: [{ find: "a", replace: "b" }], dryRun: true })).toEqual({
      path: "one.md",
      hunks: [{ find: "a", replace: "b" }],
      dryRun: true,
    })
  })

  // Only `true` is a dry run. A flag in another shape is not half an Edit.
  it("drops a dry-run flag that is not true", () => {
    expect(editOf({ path: "one.md", hunks: [{ find: "a", replace: "b" }], dryRun: "yes" })).toEqual(
      {
        path: "one.md",
        hunks: [{ find: "a", replace: "b" }],
      },
    )
  })

  it.each([
    ["nothing", undefined],
    ["a list", [1, 2]],
    ["no path", { hunks: [{ find: "a", replace: "b" }] }],
    ["an empty path", { path: "", hunks: [{ find: "a", replace: "b" }] }],
    ["no hunks", { path: "one.md" }],
    ["an empty hunk list", { path: "one.md", hunks: [] }],
    ["a hunk that is not one", { path: "one.md", hunks: [{ find: "a" }] }],
    [
      "one good hunk and one that is not",
      { path: "one.md", hunks: [{ find: "a", replace: "b" }, 1] },
    ],
  ])("names no Edit when the arguments are %s", (_case, args) => {
    expect(editOf(args)).toBeUndefined()
  })
})
