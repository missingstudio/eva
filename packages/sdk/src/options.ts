/**
 * A config value arrives as unknown, from YAML or from a flag. These read one
 * safely and fall back rather than coercing whatever turned up.
 *
 * There is one reader, and the key sweep asks it the same question a plugin
 * does. A value the sweep passes as fitting a shape is therefore a value the
 * plugin that declared that shape can actually read — which used to hold by
 * convention, in two implementations that had to agree, and did not: the
 * sweep took a mapping the reader beside it then dropped.
 */

/**
 * The shape a config key is read as. `name` takes a bare string or a mapping
 * with an id, because a person may name a thing either way.
 */
export type Shape = "string" | "number" | "boolean" | "list" | "mapping" | "name"

// The keys something reads, and the shape each is read as.
export type Reads = Readonly<Record<string, Shape>>

// What each Shape reads to. A reader answers in this type, and a fallback is
// held to it, so a key declared `number` cannot be read with a string default.
export interface Reading {
  readonly string: string
  readonly number: number
  readonly boolean: boolean
  readonly list: readonly unknown[]
  readonly mapping: Record<string, unknown>
  readonly name: string
}

export type Read<S extends Shape> = Reading[S]

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The `name` shape, read: a bare string, or a mapping with an id. Both spell
 * the same thing, so a plugin that declares `name` and then reads only the
 * string form accepts a value in config and then ignores it — which is the
 * silent failure the key sweep exists to end, one level down.
 */
const readName = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (!isMapping(value)) return undefined
  const id = value["id"]
  return typeof id === "string" ? id : undefined
}

/**
 * One value, read as one shape, or nothing when it is written as another.
 * Everything else here is this function: the readers a plugin reaches, and
 * the check the sweep runs, are the same answer asked two ways.
 */
export const readShape = <S extends Shape>(value: unknown, shape: S): Read<S> | undefined => {
  const read = (): Reading[Shape] | undefined => {
    switch (shape) {
      case "string":
        return typeof value === "string" ? value : undefined
      // A limit of NaN or Infinity would pass every comparison it is used in.
      case "number":
        return typeof value === "number" && Number.isFinite(value) ? value : undefined
      case "boolean":
        return typeof value === "boolean" ? value : undefined
      case "list":
        return Array.isArray(value) ? (value as readonly unknown[]) : undefined
      case "mapping":
        return isMapping(value) ? value : undefined
      case "name":
        return readName(value)
    }
  }
  return read() as Read<S> | undefined
}

/**
 * Whether a key was written in a shape something can read. The sweep asks
 * this, and it is the reader answering, so the sweep cannot pass a value the
 * reader would drop.
 */
export const fitsShape = (value: unknown, shape: Shape): boolean =>
  readShape(value, shape) !== undefined

/**
 * A declaration, and the reader it produces.
 *
 * A key used to be spelled twice — once beside the plugin's id, once at the
 * reader that took it — and nothing held the two together, so a plugin could
 * declare `themes` and read `theme`, or declare `list` and read a string. A
 * key read through its own declaration cannot do either: an undeclared name
 * does not compile, and the shape decides what comes back.
 */
export interface Declaration<R extends Reads> {
  // The declaration itself, to put beside the plugin's id.
  readonly shapes: R
  /**
   * One declared key, out of the mapping it lives in — the top-level config
   * for `reads`, the plugin's own entry options for `takes`. A value written
   * in another shape falls back rather than being coerced, and the sweep has
   * already said so as a Finding.
   */
  readonly read: <K extends keyof R & string>(
    from: Record<string, unknown>,
    key: K,
    fallback: Read<R[K]>,
  ) => Read<R[K]>
}

export const declare = <const R extends Reads>(shapes: R): Declaration<R> => ({
  shapes,
  // `key` is one the declaration holds, which is what its type says and what
  // the index signature cannot: the shape is there, so the read is total.
  read: <K extends keyof R & string>(
    from: Record<string, unknown>,
    key: K,
    fallback: Read<R[K]>,
  ): Read<R[K]> => (readShape(from[key], shapes[key] as R[K]) ?? fallback) as Read<R[K]>,
})

/**
 * One key read as a string, for a name a declaration cannot hold: `eva.auth`
 * reads `<provider>.auth`, and which providers there are is known when it
 * runs rather than when it is written. A fixed key belongs in a declaration.
 */
export const stringOption = (
  options: Record<string, unknown>,
  key: string,
  fallback: string,
): string => readShape(options[key], "string") ?? fallback
