import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { editIn, previewed } from "./preview.js"

/**
 * The question about a write, without a kernel. What it looks like over the
 * real applier and the real file system is in
 * `packages/conformance/src/approval.test.ts`, because a plugin may not import
 * another plugin.
 */

// Neither slot filled: the words the model wrote, and nothing resolved.
const EMPTY = { files: Effect.succeed(undefined), applier: Effect.succeed(undefined) }

describe("the arguments read as an Edit", () => {
  it("reads a path and its hunks", () => {
    expect(editIn({ path: "one.md", hunks: [{ find: "a", replace: "b" }] })).toEqual({
      path: "one.md",
      hunks: [{ find: "a", replace: "b" }],
    })
  })

  it.each([
    ["nothing", undefined],
    ["a list", [1, 2]],
    ["no path", { hunks: [{ find: "a", replace: "b" }] }],
    ["an empty path", { path: "", hunks: [{ find: "a", replace: "b" }] }],
    ["no hunks", { path: "one.md" }],
    ["an empty hunk list", { path: "one.md", hunks: [] }],
    ["a hunk that is not one", { path: "one.md", hunks: [{ find: "a" }] }],
  ])("names no Edit when the arguments are %s", (_case, args) => {
    expect(editIn(args)).toBeUndefined()
  })
})

describe("the question", () => {
  it("shows the change even when no slot resolves it", async () => {
    const found = await Effect.runPromise(
      previewed(EMPTY, "edit", { path: "one.md", hunks: [{ find: "a", replace: "b" }] }),
    )

    expect(found).toBe(["edit changes one.md, 1 hunk:", "- a", "+ b", "Run it?"].join("\n"))
  })

  // Nothing to preview is nothing to say: the caller asks what it was going
  // to ask.
  it("is nothing when the arguments name no Edit", async () => {
    const found = await Effect.runPromise(previewed(EMPTY, "bash", { command: ["ls"] }))

    expect(found).toBeUndefined()
  })
})
