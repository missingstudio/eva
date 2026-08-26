import { strictest, type ToolDecision } from "@missingstudio/eva-core"
import { readShape } from "@missingstudio/eva-sdk"
import { protectedIn } from "./paths.js"
import { matches, type Rule } from "./rules.js"
import { partsOf, type Part } from "./shell.js"

/**
 * The gate itself: one call's arguments in, one decision out, and no model in
 * the room.
 */

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
 * Every path a call names. `path` is the field a tool that names one file
 * uses.
 *
 * A read is checked the same way a write is. The gate cannot know which
 * argument a tool writes to, `.npmrc` holds a credential, and a gate is
 * allowed to narrow — so the path is checked, and what the tool would do with
 * it is not guessed.
 */
export const pathsOf = (args: unknown): readonly string[] => {
  const found = readShape(args, "mapping")
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
export const judge = (rules: readonly Rule[], args: unknown): ToolDecision | undefined => {
  const argv = argvOf(args)
  const parts = argv === undefined ? [] : partsOf(argv)
  const decisions: ToolDecision[] = []

  const guarded = protectedIn([...pathsOf(args), ...parts.flatMap(wordsOf)])
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
