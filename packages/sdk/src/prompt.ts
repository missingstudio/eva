import type { PromptInfo } from "./domains.js"
import { nearest } from "./suggest.js"

/**
 * What a caller binds to a Template's holes. Text only: an Instruction is
 * text, and formatting a number or a list is the caller's decision and not
 * the filler's.
 */
export type Variables = Readonly<Record<string, string>>

/**
 * A hole nothing filled, as data rather than a line of text — so the terminal,
 * a failed Claim's summary, and a surface across a socket all say the same
 * thing. `variable` is a name no binding held, `template` is an id that names
 * no row, `cycle` is a Template that includes itself through some path.
 */
export interface Gap {
  readonly kind: "variable" | "template" | "cycle"
  readonly name: string
  // The row this name is a near miss for, from `nearest`.
  readonly meant?: string
}

/**
 * What asking for an Instruction came to. There is no third answer, so a
 * caller cannot forget a case. No throw and no error channel: the caller owns
 * the Run and is the only thing that can decide what a refusal is recorded as.
 */
export type Instructed =
  | { readonly kind: "ready"; readonly text: string }
  | { readonly kind: "refused"; readonly gaps: readonly Gap[] }

// A marker is `{{...}}`. The inside is trimmed and then judged: a leading `>`
// is an include, anything else is a Variable name — so `{{foo bar}}` is a
// missing Variable rather than text a person never sees.
const MARKER = /\{\{([^{}]*)\}\}/g

// The one Gap that carries a near miss: an id that names no row.
const templateGap = (name: string, texts: ReadonlyMap<string, string>): Gap => {
  const meant = nearest(name, [...texts.keys()])
  return { kind: "template", name, ...(meant === undefined ? {} : { meant }) }
}

/**
 * Step one — compose. Every `{{> other}}` becomes that row's text, depth
 * first, carrying the path. A name that names no row is a `template` Gap, a
 * name already on the path is a `cycle` Gap, and a gapped marker becomes
 * nothing, so one call names every Gap it can see rather than only the first.
 */
const compose = (
  texts: ReadonlyMap<string, string>,
  id: string,
  path: readonly string[],
  gaps: Gap[],
): string =>
  (texts.get(id) ?? "").replace(MARKER, (marker, inside: string) => {
    const name = inside.trim()
    if (!name.startsWith(">")) return marker
    const included = name.slice(1).trim()
    if (path.includes(included)) {
      gaps.push({ kind: "cycle", name: included })
      return ""
    }
    if (!texts.has(included)) {
      gaps.push(templateGap(included, texts))
      return ""
    }
    return compose(texts, included, [...path, included], gaps)
  })

// Step two — fill. A name the mapping does not hold is a `variable` Gap.
const fill = (composed: string, variables: Variables, gaps: Gap[]): string =>
  composed.replace(MARKER, (_, inside: string) => {
    const name = inside.trim()
    if (!Object.hasOwn(variables, name)) {
      gaps.push({ kind: "variable", name })
      return ""
    }
    return variables[name] ?? ""
  })

// One report per hole: a Variable missed through two includes is one Gap.
const dedup = (gaps: readonly Gap[]): readonly Gap[] => {
  const seen = new Set<string>()
  return gaps.filter((gap) => {
    const key = `${gap.kind} ${gap.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The Instruction the row named `id` fills to, or the Gaps that refuse it.
 *
 * Compose runs before fill, and an inserted value is never scanned again:
 * only Template text — from a plugin, from config, or from a trusted `.eva` —
 * is ever scanned, so a bound value containing `{{secret}}` is text and not a
 * Template. Gaps come deduplicated by kind and name, in document order,
 * includes before variables.
 *
 * This reads no clock, no environment and no file. The same rows, id and
 * Variables give the same text, which is what lets a test pin a filled
 * Instruction as a golden.
 */
export const instructionOf = (
  rows: readonly PromptInfo[],
  id: string,
  variables: Variables,
): Instructed => {
  const texts = new Map(rows.map((one) => [one.id, one.text]))
  if (!texts.has(id)) return { kind: "refused", gaps: [templateGap(id, texts)] }

  const gaps: Gap[] = []
  const text = fill(compose(texts, id, [id], gaps), variables, gaps)
  return gaps.length === 0 ? { kind: "ready", text } : { kind: "refused", gaps: dedup(gaps) }
}
