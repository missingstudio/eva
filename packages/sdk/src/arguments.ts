import { toolText, type ToolResult } from "@missingstudio/eva-core"
import { readShape } from "./options.js"

/**
 * What a tool's arguments are, declared once for both audiences.
 *
 * A tool used to state its arguments twice: once as the JSON Schema a model is
 * shown, and once at the reader that took them — with the key spelled in both
 * and the sentence for a missing one written by hand. Nothing held the three
 * together, so a tool could show `pattern` and read `patern`, or show a
 * required argument and read it as optional.
 *
 * This is `declare` for a tool's arguments, and for the same reason: the
 * schema, the reader and the refusal all come out of one statement, so a key
 * is declared and read in one place.
 *
 * What is not here is which argument names a file. The deterministic gate
 * reads a call's `path` to find the write it would judge, and it is handed the
 * arguments rather than the row — so the declaration cannot yet tell it. A
 * write tool that named its file something else would escape that check, which
 * is a gap this closes no part of.
 */

/**
 * One argument. The shape decides three things at once: what the model is
 * shown, what a reader gives back, and what the model is told when it wrote
 * something else.
 *
 * `words` is a non-empty list of strings, which is the shape a tool that runs
 * a program takes. `shaped` is the escape for an argument richer than the
 * rest — the schema is stated and the reading is the caller's, because a
 * shape this general has no one reading.
 */
export type Argument =
  | { readonly shape: "string"; readonly description: string; readonly optional?: true }
  | { readonly shape: "number"; readonly description: string; readonly optional?: true }
  | { readonly shape: "boolean"; readonly description: string; readonly optional?: true }
  | { readonly shape: "words"; readonly description: string; readonly optional?: true }
  | {
      readonly shape: "shaped"
      readonly schema: Record<string, unknown>
      readonly description: string
      readonly optional?: true
    }

type Value<A extends Argument> = A["shape"] extends "string"
  ? string
  : A["shape"] extends "number"
    ? number
    : A["shape"] extends "boolean"
      ? boolean
      : A["shape"] extends "words"
        ? readonly string[]
        : unknown

// What one call's arguments came to: a required one absent is not a partial
// read, so an optional one is the only thing that can be missing here.
type Bound<A extends Record<string, Argument>> = {
  readonly [K in keyof A]: A[K] extends { readonly optional: true }
    ? Value<A[K]> | undefined
    : Value<A[K]>
}

/**
 * What reading one call's arguments came to. There is no third answer, so a
 * caller cannot forget a case, and the refusal is a `ToolResult` because every
 * ending of a tool call is a result the model can act on.
 */
export type Taken<A extends Record<string, Argument>> =
  | { readonly kind: "read"; readonly args: Bound<A> }
  | { readonly kind: "refused"; readonly result: ToolResult }

const SCHEMAS: Record<Argument["shape"], Record<string, unknown>> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  words: { type: "array", minItems: 1, items: { type: "string" } },
  shaped: {},
}

// What the model is told it wrote wrong, in the words of the shape it owed.
const WANTS: Record<Argument["shape"], string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  words: "list of words",
  shaped: "argument",
}

const wordsIn = (value: unknown): readonly string[] | undefined => {
  const listed = readShape(value, "list")
  return listed !== undefined && listed.length > 0 && listed.every((one) => typeof one === "string")
    ? (listed as readonly string[])
    : undefined
}

/**
 * One argument, read out of the call. Nothing is coerced: a model that wrote
 * a number where a string was asked for wrote no string.
 *
 * An empty string is nothing, which is the rule `textIn` already followed: a
 * tool asked for a path and handed `""` was handed no path.
 */
const valueOf = (found: Record<string, unknown>, key: string, one: Argument): unknown => {
  switch (one.shape) {
    case "string": {
      const asked = readShape(found[key], "string")
      return asked === undefined || asked === "" ? undefined : asked
    }
    case "number":
      return readShape(found[key], "number")
    case "boolean":
      return readShape(found[key], "boolean")
    case "words":
      return wordsIn(found[key])
    case "shaped":
      return found[key]
  }
}

export interface Arguments<A extends Record<string, Argument>> {
  // The JSON Schema the model is shown, built from the declaration.
  readonly schema: Record<string, unknown>
  /**
   * Every argument, read, or the refusal a call gets when one the tool
   * requires is absent or was written in another shape. `id` is the tool's
   * name, because the sentence a model reads names the tool that refused.
   */
  readonly of: (id: string, input: unknown) => Taken<A>
}

export const takes = <const A extends Record<string, Argument>>(args: A): Arguments<A> => {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, one] of Object.entries(args)) {
    properties[key] = {
      ...(one.shape === "shaped" ? one.schema : SCHEMAS[one.shape]),
      description: one.description,
    }
    if (one.optional !== true) required.push(key)
  }

  return {
    schema: { type: "object", properties, required, additionalProperties: false },

    of: (id, input) => {
      /**
       * Arguments that are not a mapping hold none of them, so the refusal
       * names the first one the tool wanted rather than the shape of the whole.
       * A model that sent nothing reads the same sentence as one that sent a
       * mapping missing the same argument, which is the one it can act on.
       */
      const found = readShape(input, "mapping") ?? {}

      const bound: Record<string, unknown> = {}
      for (const [key, one] of Object.entries(args)) {
        const value = valueOf(found, key, one)
        if (value === undefined && one.optional !== true) {
          return {
            kind: "refused",
            result: toolText("failed", `${id} wants a \`${key}\` ${WANTS[one.shape]}`),
          }
        }
        bound[key] = value
      }
      return { kind: "read", args: bound as Bound<A> }
    },
  }
}
