/**
 * One chord: which key, and which modifiers were held. It is what a binding
 * spells and what a keymap looks up, so it carries nothing about how the
 * press arrived.
 */
export interface Chord {
  readonly key: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
}

/**
 * One press, as a surface reads it: a chord, and whether the key half is a
 * character somebody typed or the name of a key. What counts as one typed
 * character is decided where a press is normalized and nowhere else — a line
 * editor that asks a string for its length counts UTF-16 units, and drops
 * every character outside the basic plane.
 */
export interface KeyPress extends Chord {
  readonly glyph: boolean
}

/**
 * The terminal says "return"; bindings say "enter". The + key is spelled
 * "plus", because + is what joins a chord and the joiner cannot also be a
 * key. One word leaves here — and one case: a press carries the typed glyph
 * ("A" for shift+a), while a chord names the key, so the key half is named
 * in lowercase.
 */
const NAMED: Readonly<Record<string, string>> = { return: "enter", "+": "plus" }

export const formatKey = (key: Chord): string => {
  const named = key.key.toLowerCase()
  return [
    key.ctrl ? "ctrl" : "",
    key.meta ? "meta" : "",
    key.shift ? "shift" : "",
    NAMED[named] ?? named,
  ]
    .filter((part) => part !== "")
    .join("+")
}

const MODIFIERS: readonly string[] = ["ctrl", "meta", "shift"]

/**
 * One spelling for a binding, whatever order or case it was written in:
 * `Shift+Ctrl+K` and `ctrl+shift+k` both come back as `ctrl+shift+k`. A
 * string that names no key — a bare modifier, a modifier nobody has, a
 * modifier twice — is not a binding, and the answer is nothing rather than
 * a guess. The binding grammar lives here and nowhere else; everything that
 * authors or reads a binding asks this.
 */
export const canonical = (binding: string): string | undefined => {
  const parts = binding.trim().toLowerCase().split("+")
  const key = parts[parts.length - 1] ?? ""
  const modifiers = parts.slice(0, -1)
  if (key === "" || MODIFIERS.includes(key)) return undefined
  if (modifiers.some((one) => !MODIFIERS.includes(one))) return undefined
  if (new Set(modifiers).size !== modifiers.length) return undefined

  return formatKey({
    key,
    ctrl: modifiers.includes("ctrl"),
    meta: modifiers.includes("meta"),
    shift: modifiers.includes("shift"),
  })
}

export interface Keymap {
  readonly lookup: (key: Chord) => string | undefined
}

// A binding is held in its one spelling, so `shift+ctrl+k` written in config
// still meets the key it names. A string that is not a binding holds nothing.
export const makeKeymap = (bindings: ReadonlyMap<string, string>): Keymap => {
  const rows = new Map<string, string>()
  for (const [binding, command] of bindings) {
    const spelling = canonical(binding)
    if (spelling !== undefined) rows.set(spelling, command)
  }
  return { lookup: (key) => rows.get(formatKey(key)) }
}

/**
 * One row of the keymap Domain, as this package needs to read it. The sdk's
 * `KeymapInfo` satisfies it structurally; naming the shape here keeps the
 * contract package below the sdk.
 */
export interface BindingRow {
  readonly id: string
  readonly binding: string
  readonly command: string
  readonly surface?: string
}

export interface Conflict {
  readonly surface: string
  readonly binding: string
  readonly ids: readonly string[]
}

/**
 * Two bindings collide only when they share a surface, because only one
 * surface has focus. They collide in their one spelling, so `ctrl+c` and
 * `C+ctrl` are the same key bound twice. A row that names no key is left
 * out: it is reported as naming no key, and one mistake is said once.
 */
export const conflicts = (rows: readonly BindingRow[]): readonly Conflict[] => {
  const seen = new Map<string, { surface: string; binding: string; ids: string[] }>()
  for (const row of rows) {
    const binding = canonical(row.binding)
    if (binding === undefined) continue

    const key = `${row.surface ?? ""} ${binding}`
    const found = seen.get(key) ?? { surface: row.surface ?? "", binding, ids: [] }
    found.ids.push(row.id)
    seen.set(key, found)
  }
  return [...seen.values()].filter((one) => one.ids.length > 1)
}
