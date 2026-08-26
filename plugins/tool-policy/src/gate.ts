import { strictest, type ToolDecision } from "@missingstudio/eva-core"
import type { ToolKind } from "@missingstudio/eva-schema"
import { readShape } from "@missingstudio/eva-sdk"
import { protectedIn } from "./paths.js"
import { matches, type Rule } from "./rules.js"
import { partsOf, type Part } from "./shell.js"

/**
 * The gate itself: one call in, one decision out, and no model in the room.
 */

/**
 * One call, as the gate reads it: what kind of act the row describes, and the
 * arguments the boundary settled.
 *
 * The kind comes from the row rather than from the name, so a tool added later
 * is judged by what it does. It is read at the moment of use, so a rebuilt tool
 * domain is judged on the next call.
 */
export interface JudgedCall {
  readonly kind: ToolKind
  readonly args: unknown
}

/**
 * The kinds that only look. Everything else may change something, so a
 * protected path in its arguments is not auto-approved — a kind this list does
 * not name included, because failing closed is what a gate does.
 *
 * A read is not gated at a protected path. Reading a dependency manifest is
 * most of what an agent does first, and the rule the roadmap states is about
 * writes: a write there is a delayed-action shell command, and a read there is
 * a file somebody looked at.
 */
const READING: readonly ToolKind[] = ["read", "search", "think", "fetch"]

const isWords = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((word) => typeof word === "string")

/**
 * The words a call would run. A `command` list is already-split words, which
 * is the shape a tool that runs a program takes. It is read out of the
 * arguments rather than off the tool's name, so a second command tool is
 * judged with no change here.
 */
export const argvOf = (args: unknown): readonly string[] | undefined => {
  const found = readShape(args, "mapping")
  if (found === undefined) return undefined
  const command = found["command"]
  return isWords(command) && command.length > 0 ? command : undefined
}

/**
 * Every path a call would change. `path` is the field a tool that names one
 * file uses, and a call that only looks names none of them here.
 */
export const writtenIn = (call: JudgedCall): readonly string[] => {
  if (READING.includes(call.kind)) return []
  const found = readShape(call.args, "mapping")
  if (found === undefined) return []
  const path = found["path"]
  return typeof path === "string" && path !== "" ? [path] : []
}

/**
 * A rule, as the decision the boundary reads.
 *
 * A rule is standing authority already, so it never asks for its answer to be
 * remembered: `allow_always` is what a person's answer writes and
 * `reject_always` is what a mandate does, and the approval gate owns both.
 */
const decisionOf = (rule: Rule, words: readonly string[]): ToolDecision => {
  const said = rule.why ?? `${words.join(" ")} matches a ${rule.kind} rule`
  switch (rule.kind) {
    case "allow":
      return { kind: "allow_once" }
    case "deny":
      return { kind: "reject_once", reason: said }
    case "ask":
      return { kind: "ask", question: `${said}. Run it?` }
  }
}

// The strictest rule that matches these words. A rule set says nothing about a
// command no rule names.
const ruled = (rules: readonly Rule[], words: readonly string[]): ToolDecision | undefined =>
  strictest(rules.filter((rule) => matches(rule, words)).map((rule) => decisionOf(rule, words)))

const wordsOf = (part: Part): readonly string[] => (part.kind === "words" ? part.words : [])

/**
 * The gate's answer for one call, or nothing when neither a protected path nor
 * a rule names it. Nothing allows: a gate that denied every call nobody wrote
 * a rule for would deny reading a file.
 *
 * **The safety check runs before the rules, and that is structural rather than
 * a flag.** It is computed first and named first, `strictest` only ever goes
 * stricter, and a tie keeps the first decision — so a protected path is never
 * weakened by a rule and its reason is the one a person reads. A profile
 * reaches the rules; nothing reaches this ordering.
 *
 * An opaque invocation is judged against no rule at all. It cannot be: the
 * words that would run are not the words a rule could read, so it fails
 * closed and a person is asked.
 */
export const judge = (rules: readonly Rule[], call: JudgedCall): ToolDecision | undefined => {
  const argv = argvOf(call.args)
  const parts = argv === undefined ? [] : partsOf(argv)
  const decisions: ToolDecision[] = []

  /**
   * Both doors, one predicate. A tool that changes a file names it in a `path`
   * argument; a command names it as one of its words. A command's words are
   * checked whatever it would do with them, because the gate cannot know which
   * of them a program writes and a bootstrap file is where it matters.
   */
  const guarded = protectedIn([...writtenIn(call), ...parts.flatMap(wordsOf)])
  if (guarded !== undefined) {
    decisions.push({
      kind: "ask",
      question: `${guarded} bootstraps the toolchain, so no rule approves it. Go on?`,
    })
  }

  for (const part of parts) {
    if (part.kind === "opaque") {
      decisions.push({
        kind: "ask",
        question: `this is one opaque invocation — ${part.why}. Run it?`,
      })
      continue
    }
    const decision = ruled(rules, part.words)
    if (decision !== undefined) decisions.push(decision)
  }

  return strictest(decisions)
}
