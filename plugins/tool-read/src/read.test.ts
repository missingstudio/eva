import type { FileSystem, ToolResult } from "@missingstudio/eva-core"
import { virtualFileSystem } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { readTool } from "./read.js"

const said = (result: ToolResult): string => {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

const running = (files: Effect.Effect<FileSystem | undefined>, input: unknown) => {
  const execute = readTool({ files }).execute
  if (execute === undefined) throw new Error("the read row carries no implementation")
  return Effect.runPromise(execute(input))
}

const holding = (seed: Readonly<Record<string, string>>) =>
  Effect.succeed(virtualFileSystem(seed).fs)

describe("the read tool", () => {
  it("answers the content of the file, whole", async () => {
    const result = await running(holding({ "one.md": "first\nsecond\n" }), { path: "one.md" })

    expect(result.disposition).toBe("ok")
    // Nothing is numbered and nothing is trimmed: the edit tool matches the
    // text the model was shown.
    expect(said(result)).toBe("first\nsecond\n")
  })

  it("reports a file that is not there rather than failing the call", async () => {
    const result = await running(holding({}), { path: "gone.md" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toContain("gone.md")
  })

  // The root is the whole reach of a call, and the refusal is the slot's.
  it("reports a path outside the root", async () => {
    const result = await running(holding({ "one.md": "first" }), { path: "../secrets.txt" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toContain("outside")
  })

  it("reports an input with no path", async () => {
    for (const input of [undefined, {}, { path: 5 }, { path: "" }]) {
      const result = await running(holding({ "one.md": "first" }), input)
      expect(result.disposition).toBe("failed")
      expect(said(result)).toBe("read wants a `path` string")
    }
  })

  // An empty Slot is Degraded and not an error: the tool says so, and the
  // model reads it as a Disposition.
  it("reports an empty FileSystem slot", async () => {
    const result = await running(Effect.succeed(undefined), { path: "one.md" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toBe("the FileSystem slot is empty")
  })

  // A consumer reads a Slot at the moment of use and never captures it, so a
  // filler swapped between two calls answers the second one.
  it("reads the slot again on the next call", async () => {
    let held = virtualFileSystem({ "one.md": "first" }).fs
    const files = Effect.sync(() => held as FileSystem | undefined)

    const before = await running(files, { path: "one.md" })
    held = virtualFileSystem({ "one.md": "second" }).fs
    const after = await running(files, { path: "one.md" })

    expect([said(before), said(after)]).toEqual(["first", "second"])
  })
})
