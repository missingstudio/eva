/**
 * What a call would run, in the one reading every gate takes.
 *
 * Two gates read the words of one call. The deterministic gate judges them
 * against a Rule Set, and the approval gate writes a grant over the words a
 * person allowed. Two readings would be a grant that never matches what the
 * gate judged, so there is one, it is here, and both gates ask it.
 *
 * An **Invocation** is one thing a call would run: either the plain words a
 * rule judges position by position, or an **Opaque Invocation** — a line this
 * cannot decompose, which nothing may approve without a person.
 *
 * The splitter is total and needs no model to answer.
 */

/**
 * One thing a call would run. `words` is a list of plain words a rule judges
 * position by position. `opaque` is a line this cannot decompose, so nothing
 * may approve it without a person.
 */
export type Invocation =
  | { readonly kind: "words"; readonly words: readonly string[] }
  | { readonly kind: "opaque"; readonly why: string }

/**
 * The words a call names, or nothing when it names none. A `command` argument
 * is already-split words, which is the shape a tool that runs a program takes
 * — so the words are read out of the arguments and never off the tool's name,
 * and a second command tool is read with no change here.
 */
export const argvOf = (args: unknown): readonly string[] | undefined => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>)["command"]
  return Array.isArray(command) &&
    command.length > 0 &&
    command.every((one) => typeof one === "string")
    ? (command as readonly string[])
    : undefined
}

/**
 * Every character class that makes a line more than a linear chain of plain
 * words, named once. Each one means the words that would run are not the words
 * this read, which is the whole reason such a line fails closed.
 */
const CLASSES: readonly (readonly [RegExp, string])[] = [
  [/[<>]/, "a redirection"],
  [/[$`]/, "a substitution or a variable"],
  [/['"\\]/, "a quotation"],
  [/[*?[\]]/, "a glob"],
  [/[(){}]/, "a subshell or a group"],
  [/[!#]/, "a history reference or a comment"],
  [/[\n\r]/, "more than one line"],
]

// The four a linear chain splits at, and nothing else. The space around each
// one is left in place, because the split into words takes it off.
const CHAIN = /&&|\|\||;|\|/

// `FOO=bar cmd` runs a command in an environment no rule read.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

const opaqueReason = (line: string): string | undefined => {
  const classed = CLASSES.find(([pattern]) => pattern.test(line))
  if (classed !== undefined) return `it holds ${classed[1]}`

  // A lone `&` puts a command in the background. `&&` is a chain, so the pairs
  // go first and whatever `&` is left is the one that is not a chain.
  if (line.replaceAll("&&", "").includes("&")) return "it holds a background command"

  const assigned = line.split(/\s+/).find((word) => ASSIGNMENT.test(word))
  return assigned === undefined ? undefined : `it sets ${assigned.split("=")[0] as string}`
}

// The shells whose flag word carries a line rather than a program.
export const SHELLS: readonly string[] = ["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]

export const isShell = (word: string): boolean =>
  SHELLS.includes(word.split(/[/\\]/).at(-1) as string)

// A flag word is a dash and letters. One that carries a line holds a `c`,
// which is `-c` itself and every bundle around it: `-lc`, `-ec`, `-xc`. The
// letters are read apart from the `c` so no input makes the match backtrack.
const FLAG_WORD = /^-[A-Za-z]*$/

const carriesLine = (word: string): boolean => FLAG_WORD.test(word) && word.includes("c")

/**
 * A shell named inside a chain is opaque, and this is the `curl … | sh` rule.
 * What that shell runs is what the pipe hands it, which is not a word here, so
 * there is nothing for a rule to judge.
 */
const shellReason = (shell: string): string => `${shell} runs a line that is not in these words`

const shellInvocation = (words: readonly string[]): Invocation | undefined => {
  const first = words[0] as string
  return isShell(first) ? { kind: "opaque", why: shellReason(first) } : undefined
}

/**
 * A shell line, as the Invocations a rule judges. A linear chain splits at
 * `&& || ; |` and every one is judged on its own, so one denied Invocation
 * denies the call. Anything else is one Opaque Invocation, whole.
 */
export const splitLine = (line: string): readonly Invocation[] => {
  const why = opaqueReason(line)
  if (why !== undefined) return [{ kind: "opaque", why }]

  const found = line
    .split(CHAIN)
    .map((part) => part.split(/\s+/).filter((word) => word !== ""))
    .filter((words) => words.length > 0)

  return found.length === 0
    ? [{ kind: "opaque", why: "it names no command" }]
    : found.map((words) => shellInvocation(words) ?? { kind: "words", words })
}

/**
 * The Invocations of one argument list.
 *
 * A shell named with a line runs that line, so the line is split. A shell
 * named without one runs what a file or a terminal holds, which is not in
 * these words, so it is opaque. Everything else is one Invocation: the words
 * themselves, which is what a rule judges.
 */
export const invocationsOf = (argv: readonly string[]): readonly Invocation[] => {
  const [first, ...rest] = argv
  if (first === undefined) return [{ kind: "opaque", why: "it names no command" }]
  if (!isShell(first)) return [{ kind: "words", words: argv }]

  const flag = rest.findIndex(carriesLine)
  if (flag < 0) return [{ kind: "opaque", why: shellReason(first) }]

  const [line, ...extra] = rest.slice(flag + 1)
  if (line === undefined) return [{ kind: "opaque", why: `${first} names no line` }]
  if (extra.length > 0) return [{ kind: "opaque", why: `${first} names a line with arguments` }]
  return splitLine(line)
}

/**
 * The Invocations of one call, and nothing when the call names no command.
 * This is the reading both gates take: the gate judges what it answers, and a
 * grant is written over what it answers, so a rule a person's answer wrote is
 * a rule the gate presents words to.
 */
export const invocationsIn = (args: unknown): readonly Invocation[] => {
  const argv = argvOf(args)
  return argv === undefined ? [] : invocationsOf(argv)
}

/**
 * The words of every Invocation, or nothing when the call names none or one of
 * them is opaque.
 *
 * A grant is standing authority over words, so it may only be written over
 * words somebody read. An Opaque Invocation is matched against no rule at
 * all, and a rule written over one could never fire — so a call holding one
 * grants nothing and a person is asked again.
 */
export const grantableWords = (args: unknown): readonly (readonly string[])[] | undefined => {
  const invocations = invocationsIn(args)
  if (invocations.length === 0) return undefined
  const words: (readonly string[])[] = []
  for (const one of invocations) {
    if (one.kind === "opaque") return undefined
    words.push(one.words)
  }
  return words
}
