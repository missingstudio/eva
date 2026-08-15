import { declare, fitsShape, nearest, type Reads, type Shape } from "@missingstudio/eva-sdk"

/**
 * The keys this plugin reads, and the reader they produce. Every other plugin
 * declares its own beside its id, and the kernel declares `plugins`, so a
 * plugin option stops being a change to this file.
 *
 * `project` reads through this rather than beside it: a key spelled here and
 * misspelled there was a key config accepted and then ignored.
 */
export const KEYS = declare({
  model: "string",
  agents: "mapping",
  commands: "mapping",
  keymap: "mapping",
  themes: "mapping",
})

/**
 * Keys nobody declared. The kernel carries every key through, because
 * refusing one would make each new plugin option a kernel change; naming the
 * ones that reached nothing is the interpreting half's job instead.
 */
export const unreadKeys = (raw: Record<string, unknown>, reads: Reads): readonly string[] =>
  Object.keys(raw)
    .filter((key) => reads[key] === undefined)
    .sort()

// The declared key a typo most likely meant.
export const suggestKey = (key: string, reads: Reads): string | undefined =>
  nearest(key, Object.keys(reads))

const WANTED: Readonly<Record<Shape, string>> = {
  string: "a string",
  number: "a number",
  boolean: "true or false",
  list: "a list",
  mapping: "a mapping",
  name: "a name, or a mapping with an id",
}

export interface Misshapen {
  readonly key: string
  readonly wanted: string
  // The key that would have read this value, when one is a near miss.
  readonly meant?: string
}

/**
 * Keys something reads, written in a shape it cannot read. The suggestion is
 * the near key that would have taken the value as written, which is how
 * `themes: dusk` learns to say `theme`.
 */
export const misshapenKeys = (raw: Record<string, unknown>, reads: Reads): readonly Misshapen[] =>
  Object.entries(raw).flatMap(([key, value]) => {
    const shape = reads[key]
    if (shape === undefined || fitsShape(value, shape)) return []
    const takes = Object.keys(reads).filter((one) => {
      const other = reads[one]
      return one !== key && other !== undefined && fitsShape(value, other)
    })
    const meant = nearest(key, takes)
    return [{ key, wanted: WANTED[shape], ...(meant === undefined ? {} : { meant }) }]
  })
