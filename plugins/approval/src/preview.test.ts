import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { previewed } from "./preview.js"

/**
 * The question about a write, without a kernel. The reading of the arguments
 * is core's `editOf`, tested beside it — one reader, so what is pinned here is
 * only the wording. What the question looks like over the real applier and the
 * real file system is in `packages/conformance/src/approval.test.ts`, because
 * a plugin may not import another plugin.
 */

// Neither slot filled: the words the model wrote, and nothing resolved.
const EMPTY = { files: Effect.succeed(undefined), applier: Effect.succeed(undefined) }

describe("the question", () => {
  it("shows the change even when no slot resolves it", async () => {
    const found = await Effect.runPromise(
      previewed(EMPTY, "edit", { path: "one.md", hunks: [{ find: "a", replace: "b" }] }),
    )

    expect(found).toBe(["edit changes one.md, 1 hunk:", "- a", "+ b", "Run it?"].join("\n"))
  })

  // A dry run writes nothing, and the question says so: a person asked about
  // a write that is not one is answering the wrong question.
  it("says a dry run writes nothing", async () => {
    const found = await Effect.runPromise(
      previewed(EMPTY, "edit", {
        path: "one.md",
        hunks: [{ find: "a", replace: "b" }],
        dryRun: true,
      }),
    )

    expect(found).toBe(
      ["edit previews one.md, 1 hunk, and writes nothing:", "- a", "+ b", "Run it?"].join("\n"),
    )
  })

  // Nothing to preview is nothing to say: the caller asks what it was going
  // to ask.
  it("is nothing when the arguments name no Edit", async () => {
    const found = await Effect.runPromise(previewed(EMPTY, "bash", { command: ["ls"] }))

    expect(found).toBeUndefined()
  })
})
