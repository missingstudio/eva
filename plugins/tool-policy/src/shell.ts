/**
 * The one splitter. It reads a shell line and answers either the parts of a
 * linear chain or one opaque invocation.
 *
 * A command tool takes already-split words and splits nothing, so the only
 * line left to split is the one a caller handed a shell — `["bash", "-c",
 * line]`. Two splitters that disagree is the hole a gate exists to close, so
 * there is one, it is total, and it needs no model to answer.
 */

/**
 * One thing a call would run. `words` is a list of plain words a rule judges
 * position by position. `opaque` is a line this cannot decompose, so nothing
 * may approve it without a person.
 */
export type Part =
  | { readonly kind: "words"; readonly words: readonly string[] }
  | { readonly kind: "opaque"; readonly why: string }

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

// The four a linear chain splits at, and nothing else.
const CHAIN = /\s*(?:&&|\|\||;|\|)\s*/

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
const SHELLS: readonly string[] = ["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]

const isShell = (word: string): boolean => SHELLS.includes(word.split(/[/\\]/).at(-1) as string)

// `-c`, and every bundle that carries it: `-lc`, `-ec`, `-xc`.
const CARRIES = /^-[A-Za-z]*c[A-Za-z]*$/

/**
 * A shell named inside a chain is opaque, and this is the `curl … | sh` rule.
 * What that shell runs is what the pipe hands it, which is not a word here, so
 * there is nothing for a rule to judge.
 */
const shellReason = (shell: string): string => `${shell} runs a line that is not in these words`

const shellPart = (words: readonly string[]): Part | undefined => {
  const first = words[0] as string
  return isShell(first) ? { kind: "opaque", why: shellReason(first) } : undefined
}

/**
 * A shell line, as the parts a rule judges. A linear chain splits at
 * `&& || ; |` and every part is judged on its own, so one denied part denies
 * the call. Anything else is one opaque invocation, whole.
 */
export const splitLine = (line: string): readonly Part[] => {
  const why = opaqueReason(line)
  if (why !== undefined) return [{ kind: "opaque", why }]

  const parts = line
    .split(CHAIN)
    .map((part) => part.split(/\s+/).filter((word) => word !== ""))
    .filter((words) => words.length > 0)

  return parts.length === 0
    ? [{ kind: "opaque", why: "it names no command" }]
    : parts.map((words) => shellPart(words) ?? { kind: "words", words })
}

/**
 * The parts of one call's argument list.
 *
 * A shell named with a line runs that line, so the line is split. A shell
 * named without one runs what a file or a terminal holds, which is not in
 * these words, so it is opaque. Everything else is one part: the words
 * themselves, which is what a rule judges.
 */
export const partsOf = (argv: readonly string[]): readonly Part[] => {
  const [first, ...rest] = argv
  if (first === undefined) return [{ kind: "opaque", why: "it names no command" }]
  if (!isShell(first)) return [{ kind: "words", words: argv }]

  const flag = rest.findIndex((word) => CARRIES.test(word))
  if (flag < 0) return [{ kind: "opaque", why: shellReason(first) }]

  const [line, ...extra] = rest.slice(flag + 1)
  if (line === undefined) return [{ kind: "opaque", why: `${first} names no line` }]
  if (extra.length > 0) return [{ kind: "opaque", why: `${first} names a line with arguments` }]
  return splitLine(line)
}
