import { describe, expect, it } from "vitest"
import { globMatcher } from "./glob.js"

const matches = (pattern: string, path: string) => globMatcher(pattern)(path)

describe("a glob pattern", () => {
  it("matches a star inside one segment and never across one", () => {
    expect(matches("*.ts", "index.ts")).toBe(true)
    expect(matches("*.ts", "src/index.ts")).toBe(false)
    expect(matches("src/*.ts", "src/index.ts")).toBe(true)
  })

  it("crosses segments on a double star, and matches none of them", () => {
    expect(matches("**/*.ts", "index.ts")).toBe(true)
    expect(matches("**/*.ts", "src/deep/index.ts")).toBe(true)
    expect(matches("src/**/*.ts", "src/index.ts")).toBe(true)
    expect(matches("src/**", "src/deep/index.ts")).toBe(true)
  })

  it("matches one character on a question mark", () => {
    expect(matches("a?.ts", "ab.ts")).toBe(true)
    expect(matches("a?.ts", "abc.ts")).toBe(false)
    expect(matches("a?b", "a/b")).toBe(false)
  })

  // A dot in a pattern is a dot, and a dot in a path is an ordinary
  // character: nothing here hides a file for being hidden.
  it("reads a dot as a dot, in the pattern and in the path", () => {
    expect(matches("*.ts", "indexats")).toBe(false)
    expect(matches("*", ".eva")).toBe(true)
    expect(matches("**/*", ".eva/config.yaml")).toBe(true)
  })

  it("anchors the whole path", () => {
    expect(matches("src/*.ts", "packages/src/index.ts")).toBe(false)
    expect(matches("index", "index.ts")).toBe(false)
  })
})
