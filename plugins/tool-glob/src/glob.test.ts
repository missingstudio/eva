import type { FileSystem, ToolResult } from "@missingstudio/eva-core"
import { CALLING_CONTEXT, virtualFileSystem } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { globTool } from "./glob.js"

const said = (result: ToolResult): string => {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

const running = (files: Effect.Effect<FileSystem | undefined>, input: unknown) => {
  const execute = globTool({ files }).execute
  if (execute === undefined) throw new Error("the glob row carries no implementation")
  return Effect.runPromise(execute(input, CALLING_CONTEXT))
}

const TREE = {
  "src/one.ts": "one",
  "src/deep/two.ts": "two",
  "docs/three.md": "three",
}

const holding = (seed: Readonly<Record<string, string>> = TREE) =>
  Effect.succeed(virtualFileSystem(seed).fs)

describe("the glob tool", () => {
  // The pattern rule is core's `globMatcher`, so a disk and a map answer the
  // same paths — sorted, relative to the root, files only.
  it("names the files the pattern matches, one per line", async () => {
    const result = await running(holding(), { pattern: "src/**/*.ts" })

    expect(result.disposition).toBe("ok")
    expect(said(result).split("\n")).toEqual(["src/deep/two.ts", "src/one.ts"])
  })

  it("says so when nothing matches", async () => {
    const result = await running(holding(), { pattern: "**/*.rs" })

    expect(result.disposition).toBe("ok")
    expect(said(result)).toBe("no file matches **/*.rs")
  })

  it("reports an input with no pattern", async () => {
    for (const input of [undefined, {}, { pattern: 5 }, { pattern: "" }]) {
      const result = await running(holding(), input)
      expect(result.disposition).toBe("failed")
      expect(said(result)).toBe("glob wants a `pattern` string")
    }
  })

  it("reports an empty FileSystem slot", async () => {
    const result = await running(Effect.succeed(undefined), { pattern: "**/*" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toBe("the FileSystem slot is empty")
  })

  // A consumer reads a Slot at the moment of use and never captures it.
  it("reads the slot again on the next call", async () => {
    let held = virtualFileSystem({ "one.ts": "one" }).fs
    const files = Effect.sync(() => held as FileSystem | undefined)

    const before = await running(files, { pattern: "**/*.ts" })
    held = virtualFileSystem({ "two.ts": "two" }).fs
    const after = await running(files, { pattern: "**/*.ts" })

    expect([said(before), said(after)]).toEqual(["one.ts", "two.ts"])
  })
})
