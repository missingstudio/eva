import { Effect } from "effect"
import type { CommandContext, CommandInfo } from "./domains.js"
import { nearest } from "./suggest.js"

export interface Parsed {
  readonly name: string
  readonly argument?: string
}

// A slash command is the whole line, so anything after the name is one
// argument rather than a parsed list.
const parseCommand = (line: string): Parsed | undefined => {
  const trimmed = line.trim()
  if (!trimmed.startsWith("/")) return undefined

  const body = trimmed.slice(1)
  const space = body.indexOf(" ")
  if (space < 0) return body.length === 0 ? undefined : { name: body }

  const argument = body.slice(space + 1).trim()
  return {
    name: body.slice(0, space),
    ...(argument.length === 0 ? {} : { argument }),
  }
}

/**
 * Whether a line names a command at all.
 *
 * It is a fact of the line and of nothing else: no registry answers it, so a
 * door that runs its lines in another process decides here what a Prompt is
 * rather than asking the far side. The rule is `parseCommand`'s own, read
 * from the one module that holds it, so the two doors cannot drift.
 */
export const namesCommand = (line: string): boolean => parseCommand(line) !== undefined

const resolveCommand = (rows: readonly CommandInfo[], name: string): CommandInfo | undefined =>
  rows.find((row) => row.id === name || (row.aliases ?? []).includes(name))

// Every name a line may resolve through, so a near miss on an alias is named
// the same way a near miss on an id is.
const names = (rows: readonly CommandInfo[]): readonly string[] =>
  rows.flatMap((row) => [row.id, ...(row.aliases ?? [])])

// Help lists the rows, so a command any plugin registers is in it.
export const helpText = (rows: readonly CommandInfo[]): string =>
  rows
    .map((row) => {
      const hint = row.argumentHint === undefined ? "" : ` <${row.argumentHint}>`
      return `/${row.id}${hint}  ${row.description}`
    })
    .join("\n")

/**
 * What dispatching a line came to. A Console shows `said` and submits the
 * line as a Prompt on `prompt`; there is no fourth answer, so a surface
 * cannot forget a case.
 */
export type Dispatched =
  // Not a command line at all. What a person typed is a Prompt.
  | { readonly kind: "prompt" }
  | { readonly kind: "ran"; readonly name: string }
  // An answer for the person, and nothing ran.
  | { readonly kind: "said"; readonly text: string }

/**
 * A line, dispatched: parsed, resolved through the rows, run if it resolves,
 * and answered in words if it does not.
 *
 * The parts of this were three exported functions and every Console assembled
 * them itself — which is how the terminal came to say `no such command` with
 * no suggestion while the command line, for its own verbs, named the near
 * miss. The policy is one module now, so the next surface inherits it rather
 * than deriving a second version of it.
 *
 * The `CommandContext` arrives as a function of what was parsed, because the
 * argument comes off the line and everything else on it — the Session, where
 * writing goes — belongs to the surface.
 */
export const dispatch = (
  rows: readonly CommandInfo[],
  line: string,
  context: (parsed: Parsed) => CommandContext,
): Effect.Effect<Dispatched> =>
  Effect.gen(function* () {
    const parsed = parseCommand(line)
    if (parsed === undefined) return { kind: "prompt" } as const

    const row = resolveCommand(rows, parsed.name)
    if (row === undefined) {
      const meant = nearest(parsed.name, names(rows))
      return {
        kind: "said",
        text:
          meant === undefined
            ? `no such command: /${parsed.name}`
            : `no such command: /${parsed.name}, did you mean /${meant}?`,
      } as const
    }

    // A row without `run` names a command the build knows of but cannot
    // execute — the plugin that owns the behaviour did not load.
    if (row.run === undefined) {
      return { kind: "said", text: `/${parsed.name} does nothing in this build` } as const
    }

    yield* row.run(context(parsed))
    return { kind: "ran", name: row.id } as const
  })
