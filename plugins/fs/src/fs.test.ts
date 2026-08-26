import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FileSystemError } from "@missingstudio/eva-core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeFileSystem } from "./fs.js"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-fs-"))

const reasonOf = <A>(effect: Effect.Effect<A, FileSystemError>) =>
  Effect.runPromise(Effect.map(Effect.flip(effect), (fault) => fault.reason))

/**
 * What only the disk filler owes. The contract every filler owes is held in
 * `packages/conformance/src/fs-contract.test.ts`, over this one and the
 * testkit's virtual filler at once.
 */
describe("eva.fs on the disk", () => {
  it("refuses a path a symlink inside the root points out of", async () => {
    const root = scratch()
    const outside = scratch()
    writeFileSync(join(outside, "secret.txt"), "not yours")
    symlinkSync(outside, join(root, "away"))

    const fs = makeFileSystem(root)

    expect(await reasonOf(fs.read("away/secret.txt"))).toBe("outside_root")
    expect(await reasonOf(fs.write("away/planted.txt", "x"))).toBe("outside_root")
  })

  // A symlinked directory is not walked: the walk would leave the root, and
  // a link that pointed at its own parent would never end.
  it("does not walk a symlinked directory", async () => {
    const root = scratch()
    const outside = scratch()
    writeFileSync(join(outside, "secret.txt"), "not yours")
    symlinkSync(outside, join(root, "away"))
    writeFileSync(join(root, "own.txt"), "mine")

    const found = await Effect.runPromise(makeFileSystem(root).glob("**/*.txt"))

    expect(found).toEqual(["own.txt"])
  })

  it("reads a root written before it was resolved", async () => {
    const root = scratch()
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src", "index.ts"), "export {}")

    const found = await Effect.runPromise(makeFileSystem(root).read("src/index.ts"))

    expect(found).toBe("export {}")
  })

  // Reading a directory is an `io` fault and not a missing file, because the
  // path names something — the virtual filler answers the same word.
  it("faults with io when the path is a directory", async () => {
    const root = scratch()
    mkdirSync(join(root, "src"))

    expect(await reasonOf(makeFileSystem(root).read("src"))).toBe("io")
  })
})
