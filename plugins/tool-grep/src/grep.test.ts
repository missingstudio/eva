import type { FileSystem, ToolResult } from "@missingstudio/eva-core"
import { virtualFileSystem } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { grepTool } from "./grep.js"

const said = (result: ToolResult): string => {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

const running = (files: Effect.Effect<FileSystem | undefined>, input: unknown) => {
  const execute = grepTool({ files }).execute
  if (execute === undefined) throw new Error("the grep row carries no implementation")
  return Effect.runPromise(execute(input))
}

const TREE = {
  "src/one.ts": "const UserSvc = 1\nexport { UserSvc }\n",
  "src/two.ts": "// nothing to find\n",
  "docs/three.md": "UserSvc is the old name\n",
}

const holding = (seed: Readonly<Record<string, string>> = TREE) =>
  Effect.succeed(virtualFileSystem(seed).fs)

describe("the grep tool", () => {
  it("answers every matching line as path, line number, and text", async () => {
    const result = await running(holding(), { pattern: "UserSvc" })

    expect(result.disposition).toBe("ok")
    expect(said(result).split("\n")).toEqual([
      "docs/three.md:1:UserSvc is the old name",
      "src/one.ts:1:const UserSvc = 1",
      "src/one.ts:2:export { UserSvc }",
    ])
  })

  it("searches only the files the glob names", async () => {
    const result = await running(holding(), { pattern: "UserSvc", glob: "src/**/*.ts" })

    expect(said(result).split("\n")).toEqual([
      "src/one.ts:1:const UserSvc = 1",
      "src/one.ts:2:export { UserSvc }",
    ])
  })

  // Nothing found is an answer and not a failure: the model reads it and
  // asks something else.
  it("says so when nothing matches", async () => {
    const result = await running(holding(), { pattern: "OrderSvc" })

    expect(result.disposition).toBe("ok")
    expect(said(result)).toBe("nothing matches OrderSvc")
  })

  it("reports a pattern no engine reads", async () => {
    const result = await running(holding(), { pattern: "(" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toBe("( is not a regular expression")
  })

  it("reports an input with no pattern", async () => {
    for (const input of [undefined, {}, { pattern: 5 }]) {
      const result = await running(holding(), input)
      expect(result.disposition).toBe("failed")
      expect(said(result)).toBe("grep wants a `pattern` string")
    }
  })

  it("reports an empty FileSystem slot", async () => {
    const result = await running(Effect.succeed(undefined), { pattern: "UserSvc" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toBe("the FileSystem slot is empty")
  })

  // A consumer reads a Slot at the moment of use and never captures it.
  it("reads the slot again on the next call", async () => {
    let held = virtualFileSystem({ "one.ts": "first" }).fs
    const files = Effect.sync(() => held as FileSystem | undefined)

    const before = await running(files, { pattern: "first" })
    held = virtualFileSystem({ "one.ts": "second" }).fs
    const after = await running(files, { pattern: "first" })

    expect([said(before), said(after)]).toEqual(["one.ts:1:first", "nothing matches first"])
  })
})
