import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { withKernel } from "./context.js"
import { virtualFileSystem, VIRTUAL_FS } from "./fs.js"

/**
 * The contract this filler answers is held in
 * `packages/conformance/src/fs-contract.test.ts`, over `eva.fs` and this one
 * at once. What is here is the part only a test filler owes: it fills the
 * slot as a plugin, and it hands back what a tool wrote.
 */
describe("the virtual FileSystem", () => {
  it("fills the FileSystem slot as a plugin", async () => {
    const virtual = virtualFileSystem({ "one.txt": "seeded" })

    const found = await withKernel([virtual.plugin], (kernel) =>
      Effect.flatMap(kernel.slot.fileSystem.get, (fs) => fs.read("one.txt")).pipe(Effect.orDie),
    )

    expect(virtual.plugin.id).toBe(VIRTUAL_FS)
    expect(found).toBe("seeded")
  })

  it("hands back every file it holds, so a test reads what a tool wrote", async () => {
    const virtual = virtualFileSystem({ "one.txt": "seeded" })
    await Effect.runPromise(Effect.orDie(virtual.fs.write("notes/two.md", "written")))

    expect(virtual.files()).toEqual({ "one.txt": "seeded", "notes/two.md": "written" })
  })

  it("touches no disk", async () => {
    const virtual = virtualFileSystem()
    await Effect.runPromise(Effect.orDie(virtual.fs.write("one.txt", "nowhere")))

    expect(virtual.root).toBe("/workspace")
    expect(virtual.files()).toEqual({ "one.txt": "nowhere" })
  })
})
