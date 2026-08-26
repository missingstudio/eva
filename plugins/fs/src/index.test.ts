import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { fs } from "./index.js"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-fs-plugin-"))

describe("the fs plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(fs.id).toBe("eva.fs")
  })

  it("fills the FileSystem slot under the root it was given", async () => {
    const root = scratch()
    await withPlugin(
      fs,
      (kernel) =>
        Effect.gen(function* () {
          const found = yield* kernel.slot.fileSystem.get
          yield* found.write("notes/one.md", "written through the slot")
        }).pipe(Effect.orDie),
      { options: { root } },
    )

    expect(readFileSync(join(root, "notes/one.md"), "utf8")).toBe("written through the slot")
  })

  it("empties the slot when it unloads", async () => {
    const found = await withPlugin(
      fs,
      (kernel) =>
        Effect.gen(function* () {
          yield* kernel.runtime.remove("eva.fs")
          return yield* kernel.slot.fileSystem.peek
        }),
      { options: { root: scratch() } },
    )

    expect(found).toBeUndefined()
  })
})
