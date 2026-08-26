import { describe, expect, it } from "vitest"
import {
  BUILT_IN_RULES,
  checkRules,
  matches,
  readRules,
  rulesOf,
  sayFault,
  type Rule,
} from "./rules.js"

const rule = (kind: Rule["kind"], words: readonly (readonly string[])[]): Rule => ({ kind, words })

describe("readRules", () => {
  it("reads a bare word as a union of one", () => {
    expect(readRules({ rules: [{ deny: ["rm", "-rf"] }] })).toEqual({
      rules: [rule("deny", [["rm"], ["-rf"]])],
      faults: [],
    })
  })

  it("reads a union at one position", () => {
    expect(readRules({ rules: [{ allow: ["git", ["status", "diff"]] }] }).rules).toEqual([
      rule("allow", [["git"], ["status", "diff"]]),
    ])
  })

  it("keeps the sentence a person reads", () => {
    expect(
      readRules({ rules: [{ ask: ["git", "push"], why: "it leaves the machine" }] }).rules,
    ).toEqual([{ kind: "ask", words: [["git"], ["push"]], why: "it leaves the machine" }])
  })

  it("reads a profile that writes no rules", () => {
    for (const value of [undefined, null, {}, { rules: [] }])
      expect(readRules(value)).toEqual({ rules: [], faults: [] })
  })

  // Each of these is a fault a person can fix, named where it is. A rule set
  // read part way is what `eva policy check` exists to stop.
  it.each([
    ["a rule set that is not a mapping", "rules: []", "policy"],
    ["rules that are not a list", { rules: "rm" }, "policy.rules"],
    ["a rule that is not a mapping", { rules: ["rm"] }, "policy.rules.0"],
    ["a rule that names no decision", { rules: [{ why: "nothing" }] }, "policy.rules.0"],
    [
      "a rule that names two decisions",
      { rules: [{ allow: ["a"], deny: ["a"] }] },
      "policy.rules.0",
    ],
    ["a rule matching no list", { rules: [{ deny: "rm" }] }, "policy.rules.0.deny"],
    ["a rule with no position", { rules: [{ deny: [] }] }, "policy.rules.0.deny"],
    ["an empty union", { rules: [{ allow: [[]] }] }, "policy.rules.0.allow.0"],
    [
      "a union holding something else",
      { rules: [{ allow: [["git", 7]] }] },
      "policy.rules.0.allow.0.1",
    ],
    ["an empty word", { rules: [{ allow: [""] }] }, "policy.rules.0.allow.0"],
    ["a why that is not a sentence", { rules: [{ deny: ["rm"], why: 7 }] }, "policy.rules.0.why"],
  ])("names the fault in %s", (_what, value, at) => {
    const found = readRules(value)
    expect(found.rules).toEqual([])
    expect(found.faults.map((fault) => fault.at)).toContain(at)
    expect(sayFault(found.faults[0]!)).toContain(found.faults[0]!.at)
  })

  // Every fault at once, because a person fixes a file and not a line.
  it("names every fault in one pass", () => {
    const found = readRules({ rules: [{ deny: [] }, { allow: [[]] }, { why: "nothing" }] })
    expect(found.faults).toHaveLength(3)
  })
})

describe("matches", () => {
  it("matches a prefix and says nothing about the words after it", () => {
    expect(matches(rule("deny", [["rm"], ["-rf"]]), ["rm", "-rf", "/tmp/x"])).toBe(true)
  })

  it("never matches fewer words than it names", () => {
    expect(matches(rule("deny", [["rm"], ["-rf"]]), ["rm"])).toBe(false)
  })

  it("matches a word at the position that names it, and no other", () => {
    expect(matches(rule("deny", [["rm"], ["-rf"]]), ["-rf", "rm"])).toBe(false)
  })

  it("matches any word of a union", () => {
    const one = rule("allow", [["git"], ["status", "diff", "log"]])
    expect(["status", "diff", "log"].every((word) => matches(one, ["git", word]))).toBe(true)
    expect(matches(one, ["git", "push"])).toBe(false)
  })
})

describe("the built-in rules", () => {
  // The rule, not the luck: this is the row that answers, by its own semantics.
  it("holds a rule that matches rm -rf /", () => {
    const found = BUILT_IN_RULES.filter((one) => matches(one, ["rm", "-rf", "/"]))
    expect(found.map((one) => one.kind)).toContain("deny")
  })

  it.each([
    ["rm", "-rf", "/"],
    ["rm", "-fr", "/"],
    ["rm", "-r", "-f", "/"],
    ["rm", "-f", "-r", "~"],
    ["rm", "--recursive", "--force", "."],
    ["rm", "-rf", "*"],
    ["rm", "/"],
  ])("denies %s %s %s", (...words) => {
    expect(BUILT_IN_RULES.some((one) => one.kind === "deny" && matches(one, words))).toBe(true)
  })

  // A remove inside the tree is work, not a catastrophe.
  it.each([
    ["rm", "-rf", "./out"],
    ["rm", "packages/core/dist/index.mjs"],
  ])("leaves %s %s %s alone", (...words) => {
    expect(BUILT_IN_RULES.some((one) => matches(one, words))).toBe(false)
  })

  it("carries the built-in rules into every rule set", () => {
    const found = rulesOf({ policy: { rules: [{ allow: ["git"] }] } })
    expect(found.faults).toEqual([])
    expect(found.rules).toEqual([...BUILT_IN_RULES, rule("allow", [["git"]])])
  })

  it("faults on a policy key that is not a mapping, rather than falling back", () => {
    expect(rulesOf({ policy: "off" }).faults.map(sayFault)).toEqual([
      "policy: a rule set is a mapping",
    ])
  })
})

describe("checkRules", () => {
  it("reads the rules under the policy key of a config file", () => {
    const found = checkRules("policy:\n  rules:\n    - deny: [rm, -rf]\n")
    expect(found).toEqual({ rules: [rule("deny", [["rm"], ["-rf"]])], faults: [] })
  })

  // The same reader a run uses, so CI and the gate cannot disagree.
  it("finds the fault a run would find", () => {
    const source = "policy:\n  rules:\n    - allow: [[]]\n"
    expect(checkRules(source).faults).toEqual(readRules({ rules: [{ allow: [[]] }] }).faults)
  })

  it("names a file that is not YAML", () => {
    expect(checkRules("policy: [\n").faults[0]?.at).toBe("the file")
  })

  it("names a file that is not a mapping", () => {
    expect(checkRules("- one\n- two\n").faults.map(sayFault)).toEqual([
      "the file: a config file is a mapping",
    ])
  })

  it("reads an empty file, and a file with no policy, as no rules", () => {
    for (const source of ["", "\n", "model: anthropic/claude\n"])
      expect(checkRules(source)).toEqual({ rules: [], faults: [] })
  })
})
