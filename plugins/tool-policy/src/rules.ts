import { declare, readShape } from "@missingstudio/eva-sdk"
import { parse } from "yaml"

/**
 * The rule language, and the one reader that judges a rule set.
 *
 * A rule is a prefix over an argument list. Each position holds one word or a
 * union of words, and a rule matches a command whose first words each fall in
 * the position that names them. A rule says nothing about the words after the
 * ones it names.
 *
 * There is one reader. A run hands it the `policy` config key and
 * `eva policy check` hands it the same mapping out of a file, so a rule set
 * that passed in CI is a rule set the gate reads the same way.
 */

// The words one position accepts. A union of one is a literal.
export type Position = readonly string[]

export interface Rule {
  readonly kind: "allow" | "deny" | "ask"
  // The positions, in order, from the first word of the command.
  readonly words: readonly Position[]
  // What a person is told when this rule decides.
  readonly why?: string
}

// Where a rule set is wrong, and what is wrong there. `at` is a dotted path
// into the document, so a person finds the fault without counting lines.
export interface Fault {
  readonly at: string
  readonly says: string
}

/**
 * A rule set, read. The faults are collected rather than thrown: the command
 * line names every one of them at once, and the gate refuses a rule set it
 * could not read whole.
 */
export interface RuleSet {
  readonly rules: readonly Rule[]
  readonly faults: readonly Fault[]
}

export const sayFault = (fault: Fault): string => `${fault.at}: ${fault.says}`

const KINDS = ["allow", "deny", "ask"] as const

const mappingOf = (value: unknown): Record<string, unknown> | undefined =>
  readShape(value, "mapping")

const listOf = (value: unknown): readonly unknown[] | undefined => readShape(value, "list")

/**
 * One position, read. A bare string is a union of one, because a person may
 * name one word or a choice of them. An empty union matches no word at all,
 * so a rule holding one can never decide anything and is a fault rather than
 * a rule that quietly does nothing.
 */
const readPosition = (value: unknown, at: string, faults: Fault[]): Position | undefined => {
  if (typeof value === "string") {
    if (value !== "") return [value]
    faults.push({ at, says: "a position holds a word, and the word is written" })
    return undefined
  }

  const listed = listOf(value)
  if (listed === undefined) {
    faults.push({ at, says: "a position is a word or a union of words" })
    return undefined
  }
  if (listed.length === 0) {
    faults.push({ at, says: "an empty union matches no word, so the rule can never match" })
    return undefined
  }

  const words: string[] = []
  for (const [index, one] of listed.entries()) {
    if (typeof one === "string" && one !== "") {
      words.push(one)
      continue
    }
    faults.push({ at: `${at}.${index}`, says: "a union holds words" })
  }
  return words.length === listed.length ? words : undefined
}

const readRule = (value: unknown, at: string, faults: Fault[]): Rule | undefined => {
  const found = mappingOf(value)
  if (found === undefined) {
    faults.push({ at, says: "a rule is a mapping of one decision to the words it matches" })
    return undefined
  }

  const named = KINDS.filter((kind) => found[kind] !== undefined)
  const kind = named[0]
  if (kind === undefined) {
    faults.push({ at, says: `a rule names one of ${KINDS.join(", ")}` })
    return undefined
  }
  if (named.length > 1) {
    faults.push({ at, says: `a rule names one decision, and this names ${named.join(" and ")}` })
    return undefined
  }

  const listed = listOf(found[kind])
  if (listed === undefined) {
    faults.push({ at: `${at}.${kind}`, says: "a rule matches a list of positions" })
    return undefined
  }
  if (listed.length === 0) {
    faults.push({ at: `${at}.${kind}`, says: "a rule with no position matches every command" })
    return undefined
  }

  const why = found["why"]
  if (why !== undefined && typeof why !== "string") {
    faults.push({ at: `${at}.why`, says: "why is the sentence a person reads" })
    return undefined
  }

  const words: Position[] = []
  for (const [index, one] of listed.entries()) {
    const position = readPosition(one, `${at}.${kind}.${index}`, faults)
    if (position !== undefined) words.push(position)
  }
  if (words.length !== listed.length) return undefined

  return { kind, words, ...(typeof why === "string" ? { why } : {}) }
}

/**
 * A rule set, out of the value the `policy` key holds. Nothing there is not a
 * fault: a profile that writes no rules writes none.
 */
export const readRules = (value: unknown): RuleSet => {
  if (value === undefined || value === null) return { rules: [], faults: [] }

  const found = mappingOf(value)
  if (found === undefined)
    return { rules: [], faults: [{ at: "policy", says: "a rule set is a mapping" }] }

  if (found["rules"] === undefined) return { rules: [], faults: [] }
  const listed = listOf(found["rules"])
  if (listed === undefined)
    return { rules: [], faults: [{ at: "policy.rules", says: "the rules are a list" }] }

  const faults: Fault[] = []
  const rules: Rule[] = []
  for (const [index, one] of listed.entries()) {
    const rule = readRule(one, `policy.rules.${index}`, faults)
    if (rule !== undefined) rules.push(rule)
  }
  return { rules, faults }
}

/**
 * Whether a rule matches the words a command would run. The rule is a prefix,
 * so it never matches fewer words than it names and it says nothing about the
 * words after them.
 */
export const matches = (rule: Rule, words: readonly string[]): boolean =>
  rule.words.length <= words.length &&
  rule.words.every((position, index) => position.includes(words[index] as string))

// Where a remove is never a mistake worth making: the root, a home, and the
// working tree itself. A path inside one of them is not here — `rm -rf ./out`
// removes what a build made.
const ROOTS: Position = ["/", "/*", "*", ".", "./", "..", "../", "~", "~/", "~/*", "$HOME"]

// Every spelling of "recursive" and "force" a person reaches for. A rule
// matches positions in order, so a second flag word is a second rule.
const RECURSIVE: Position = [
  "-rf",
  "-fr",
  "-Rf",
  "-fR",
  "-r",
  "-R",
  "--recursive",
  "-f",
  "--force",
  "--no-preserve-root",
]

const NO_UNDO = "a remove at a root or at the working tree cannot be undone"

/**
 * The rules every run carries. They are floors and not defaults: the
 * strictest decision wins, so a profile can add a rule and can never take one
 * of these away.
 */
export const BUILT_IN_RULES: readonly Rule[] = [
  { kind: "deny", words: [["rm"], ROOTS], why: NO_UNDO },
  { kind: "deny", words: [["rm"], RECURSIVE, ROOTS], why: NO_UNDO },
  { kind: "deny", words: [["rm"], RECURSIVE, RECURSIVE, ROOTS], why: NO_UNDO },
  {
    kind: "ask",
    words: [["sudo", "doas", "su"]],
    why: "a command run as another user is outside every rule that judged this one",
  },
]

// The one config key this plugin reads, for the sweep that names a key
// nothing read.
export const POLICY_KEYS = declare({ policy: "mapping" })

/**
 * The rule set a run reads: the built-in rules first, then the profile's.
 * First matters only for the reason a person reads, because a tie keeps the
 * earlier decision.
 *
 * The key is read straight rather than through the declaration's fallback: a
 * `policy` written as something other than a mapping is a fault this gate
 * refuses, and not a default it may quietly fall back to.
 */
export const rulesOf = (config: Record<string, unknown>): RuleSet => {
  const found = readRules(config["policy"])
  return { rules: [...BUILT_IN_RULES, ...found.rules], faults: found.faults }
}

/**
 * A rule set out of the text of a config file, which is what `eva policy
 * check` holds. The reader below the parse is the one a run uses, so the
 * command line and the gate cannot disagree about what a malformed rule set
 * is.
 *
 * The built-in rules are left out. What this checks is what a person wrote.
 */
export const checkRules = (source: string): RuleSet => {
  let parsed: unknown
  try {
    parsed = parse(source)
  } catch (cause) {
    const says = cause instanceof Error ? cause.message.split("\n")[0] : String(cause)
    return { rules: [], faults: [{ at: "the file", says: `it is not YAML — ${says}` }] }
  }

  if (parsed === undefined || parsed === null) return { rules: [], faults: [] }
  const found = mappingOf(parsed)
  return found === undefined
    ? { rules: [], faults: [{ at: "the file", says: "a config file is a mapping" }] }
    : readRules(found["policy"])
}
