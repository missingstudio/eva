import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FileSystem, FileSystemError } from "@missingstudio/eva-core"
import { makeFileSystem } from "@missingstudio/eva-fs"
import { virtualFileSystem } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-fs-contract-"))

/**
 * One row per implementation: a name, and a factory for a fresh FileSystem
 * with the root it answers under. A third filler adds its row here and
 * inherits every test.
 */
type Row = readonly [string, () => { readonly fs: FileSystem; readonly root: string }]

const fillers: readonly Row[] = [
  [
    "eva.fs",
    () => {
      const root = scratch()
      return { fs: makeFileSystem(root), root }
    },
  ],
  [
    "the virtual filler",
    () => {
      const made = virtualFileSystem()
      return { fs: made.fs, root: made.root }
    },
  ],
]

const ran = <A>(effect: Effect.Effect<A, FileSystemError>) => Effect.runPromise(effect)

const reasonOf = <A>(effect: Effect.Effect<A, FileSystemError>) =>
  Effect.runPromise(Effect.map(Effect.flip(effect), (fault) => fault.reason))

/**
 * One suite, every FileSystem this build carries. A tool stands on this
 * contract and never on a filler, so a test that runs on the disk and a test
 * that runs on a map are the same test — which is what makes the virtual
 * filler a real answer rather than a convenient one.
 */
describe.each(fillers)("the %s FileSystem honors the contract", (_name, make) => {
  it("reads back what it wrote", async () => {
    const { fs } = make()
    await ran(fs.write("notes/one.md", "the first note"))

    expect(await ran(fs.read("notes/one.md"))).toBe("the first note")
  })

  it("makes the parent directories a write needs", async () => {
    const { fs } = make()
    await ran(fs.write("deep/under/here.txt", "arrived"))

    expect(await ran(fs.read("deep/under/here.txt"))).toBe("arrived")
  })

  it("replaces the content of a file it already holds", async () => {
    const { fs } = make()
    await ran(fs.write("one.txt", "first"))
    await ran(fs.write("one.txt", "second"))

    expect(await ran(fs.read("one.txt"))).toBe("second")
  })

  it("faults with not_found when nothing is at the path", async () => {
    const { fs } = make()

    expect(await reasonOf(fs.read("missing.txt"))).toBe("not_found")
  })

  it("answers undefined rather than failing when nothing is at the path", async () => {
    const { fs } = make()

    expect(await ran(fs.stat("missing.txt"))).toBeUndefined()
  })

  it("stats a file by kind and byte count", async () => {
    const { fs } = make()
    await ran(fs.write("one.txt", "12345"))

    expect(await ran(fs.stat("one.txt"))).toEqual({ kind: "file", bytes: 5 })
  })

  it("stats a directory by kind", async () => {
    const { fs } = make()
    await ran(fs.write("src/index.ts", "export {}"))

    expect(await ran(fs.stat("src"))).toMatchObject({ kind: "directory" })
  })

  it("faults with io when the path names a directory", async () => {
    const { fs } = make()
    await ran(fs.write("src/index.ts", "export {}"))

    expect(await reasonOf(fs.read("src"))).toBe("io")
  })

  it("globs paths relative to the root, sorted, files only", async () => {
    const { fs } = make()
    await ran(fs.write("index.ts", ""))
    await ran(fs.write("src/two.ts", ""))
    await ran(fs.write("src/deep/one.ts", ""))
    await ran(fs.write("src/notes.md", ""))

    expect(await ran(fs.glob("**/*.ts"))).toEqual(["index.ts", "src/deep/one.ts", "src/two.ts"])
    expect(await ran(fs.glob("src/*.ts"))).toEqual(["src/two.ts"])
    expect(await ran(fs.glob("*.md"))).toEqual([])
  })

  it("reads a path written as an absolute one under the root", async () => {
    const { fs, root } = make()
    await ran(fs.write("one.txt", "either spelling"))

    expect(await ran(fs.read(join(root, "one.txt")))).toBe("either spelling")
  })

  // The refusal the seam exists for, on every call that takes a path.
  it("refuses a relative path that climbs out of the root", async () => {
    const { fs } = make()

    expect(await reasonOf(fs.read("../escaped.txt"))).toBe("outside_root")
    expect(await reasonOf(fs.write("../escaped.txt", "no"))).toBe("outside_root")
    expect(await reasonOf(fs.stat("../escaped.txt"))).toBe("outside_root")
    expect(await reasonOf(fs.glob("../*.txt"))).toBe("outside_root")
  })

  it("refuses an absolute path outside the root", async () => {
    const { fs } = make()

    expect(await reasonOf(fs.read("/etc/hosts"))).toBe("outside_root")
    expect(await reasonOf(fs.write("/etc/hosts", "no"))).toBe("outside_root")
  })

  // A path that climbs out and comes back is inside, and is read as inside:
  // the rule is where the path lands, never how it is spelled.
  it("accepts a path that leaves and returns", async () => {
    const { fs, root } = make()
    await ran(fs.write("one.txt", "still inside"))
    const here = root.split("/").pop() ?? ""

    expect(await ran(fs.read(`../${here}/one.txt`))).toBe("still inside")
  })
})
