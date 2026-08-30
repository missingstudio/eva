import { ValidatorError, type Judged, type Validator } from "@missingstudio/eva-core"
import type { Fault } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { compileSchema, draft2020, type JsonError, type JsonSchema } from "json-schema-library"
import { remotes } from "json-schema-library/remotes"

const DIALECT = "https://json-schema.org/draft/2020-12/schema"

/**
 * The library's own copy of the 2020-12 meta-schema, compiled once. The root
 * `$vocabulary` key makes json-schema-library skip validation of the whole
 * document, so it is dropped before compiling.
 */
let compiledMeta: ReturnType<typeof compileSchema> | undefined
const metaSchema = () => {
  if (compiledMeta === undefined) {
    const family = remotes.filter((remote) =>
      String(remote["$id"] ?? "").startsWith("https://json-schema.org/draft/2020-12/"),
    )
    const root = family.find((remote) => remote["$id"] === DIALECT) as JsonSchema
    const { $vocabulary: _vocabulary, ...meta } = root
    compiledMeta = compileSchema(meta, {
      remotes: family.filter((remote) => remote["$id"] !== DIALECT),
      drafts: [draft2020],
    })
  }
  return compiledMeta
}

/**
 * Why a schema cannot be read, or nothing when it can. One rule feeds both
 * methods, so `accepts` and `check` cannot disagree about the same schema.
 */
const unreadable = (schema: unknown): string | undefined => {
  if (typeof schema === "boolean") return undefined
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return "a JSON Schema is an object or a boolean"
  }
  const dialect = (schema as Record<string, unknown>)["$schema"]
  if (dialect !== undefined && dialect !== DIALECT) {
    return `this Validator speaks ${DIALECT} and the schema declares ${named(dialect)}`
  }
  const { valid, errors } = metaSchema().validate(schema)
  if (!valid) {
    const fault = faultsOf(errors)[0]
    return fault === undefined
      ? "the JSON Schema does not conform to its dialect"
      : `the JSON Schema wants ${fault.wanted} at ${rooted(fault.at)}`
  }
  return undefined
}

// The fixed extraction rule. It is behaviour, not config, so the measured
// number means the same thing across Runs and across Workflows.
const FENCE = /```[^\n]*\n([\s\S]*?)```/g

const extract = (text: string): string => {
  const fences = [...text.matchAll(FENCE)]
  const body = fences.length === 1 ? fences[0]?.[1] : undefined
  if (body !== undefined) return body
  return longestRun(text) ?? text
}

// The longest balanced `{...}` or `[...]` run, skipping brackets inside
// JSON strings. Nothing balanced answers nothing.
const longestRun = (text: string): string | undefined => {
  let best: string | undefined
  let closers: string[] = []
  let start = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"' && closers.length > 0) {
      inString = true
    } else if (char === "{" || char === "[") {
      if (closers.length === 0) start = i
      closers.push(char === "{" ? "}" : "]")
    } else if (char === "}" || char === "]") {
      if (closers.length === 0) continue
      if (closers[closers.length - 1] !== char) {
        closers = []
        continue
      }
      closers.pop()
      if (closers.length === 0) {
        const run = text.slice(start, i + 1)
        if (best === undefined || run.length > best.length) best = run
      }
    }
  }
  return best
}

// A pointer arrives as a URI fragment; "" is the root the contract names.
const atOf = (error: JsonError): string =>
  error.data.pointer === "#" ? "" : error.data.pointer.replace(/^#/, "")

// "" is the root; a message says so in words.
const rooted = (at: string): string => (at === "" ? "the root" : at)

// The library types a code as `ErrorConfig | string`; at run time it is text.
const codeOf = (error: JsonError): string => (typeof error.code === "string" ? error.code : "")

const ARTICLED: Record<string, string> = {
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "a boolean",
  object: "an object",
  array: "an array",
  null: "null",
}

const typeName = (type: unknown): string => {
  const name = typeof type === "string" ? type : "value"
  return ARTICLED[name] ?? `a ${name}`
}

const named = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value)

// A keyword's own parameter, as text. The library types them loosely.
const param = (data: Record<string, unknown>, key: string): string => {
  const found = data[key]
  return typeof found === "string" || typeof found === "number" ? String(found) : "?"
}

/**
 * One short clause in Eva's words, never the library's message. A vendor's
 * prose would land on the Trace, which nothing rewrites, and a second
 * Validator plugin could not fill it.
 */
const wantedOf = (error: JsonError): string => {
  const data: Record<string, unknown> = error.data
  switch (codeOf(error)) {
    case "type-error":
      return Array.isArray(data["expected"])
        ? data["expected"].map(typeName).join(" or ")
        : typeName(data["expected"])
    case "enum-error": {
      const values = Array.isArray(data["values"]) ? data["values"] : []
      return `one of ${values.map(named).join(", ")}`
    }
    case "const-error":
      return `exactly ${JSON.stringify(data["expected"])}`
    case "required-property-error":
      return `a property named ${param(data, "key")}`
    case "min-length-error":
    case "min-length-one-error":
      return `at least ${param(data, "minLength")} characters`
    case "max-length-error":
      return `at most ${param(data, "maxLength")} characters`
    case "minimum-error":
      return `at least ${param(data, "minimum")}`
    case "exclusive-minimum-error":
      return `more than ${param(data, "minimum")}`
    case "maximum-error":
      return `at most ${param(data, "maximum")}`
    case "exclusive-maximum-error":
      return `less than ${param(data, "maximum")}`
    case "multiple-of-error":
      return `a multiple of ${param(data, "multipleOf")}`
    case "pattern-error":
      return `text matching ${param(data, "pattern")}`
    case "min-items-error":
    case "min-items-one-error":
      return `at least ${param(data, "minItems")} items`
    case "max-items-error":
      return `at most ${param(data, "maxItems")} items`
    case "unique-items-error":
      return "no repeated items"
    case "min-properties-error":
      return `at least ${param(data, "minProperties")} properties`
    case "max-properties-error":
      return `at most ${param(data, "maxProperties")} properties`
    case "no-additional-properties-error":
    case "unevaluated-property-error":
    case "forbidden-property-error":
    case "unknown-property-error":
      return "no such property"
    case "additional-items-error":
    case "unevaluated-items-error":
      return "no such item"
    case "invalid-property-name-error":
      return "a property name the schema allows"
    case "any-of-error": {
      const branches = Array.isArray(data["anyOf"]) ? data["anyOf"] : []
      const types = branches.map((branch) =>
        typeof branch === "object" && branch !== null
          ? (branch as Record<string, unknown>)["type"]
          : undefined,
      )
      return types.length > 0 && types.every((type) => typeof type === "string")
        ? types.map(typeName).join(" or ")
        : "a value in one of the allowed shapes"
    }
    case "one-of-error":
    case "multiple-one-of-error":
    case "one-of-property-error":
    case "missing-one-of-property-error":
    case "missing-one-of-declarator-error":
      return "a value in exactly one of the allowed shapes"
    case "all-of-error":
      return "a value in all of the required shapes"
    case "not-error":
      return "a value outside the disallowed shape"
    case "contains-error":
    case "contains-any-error":
    case "contains-array-error":
    case "contains-min-error":
    case "contains-max-error":
      return "an item of the required shape"
    case "invalid-data-error":
      return "no value at all"
    default:
      return "a value the schema allows"
  }
}

// These codes fault the schema, not the Candidate. A dangling $ref only
// surfaces once a judgement walks the branch, so `check` maps them to the
// same failure `accepts` gives an unreadable schema. The words are Eva's
// own; the library's code names stay out of the message.
const UNREADABLE_CODES = new Map([
  ["ref-error", "a $ref in the JSON Schema resolves to nothing"],
  ["schema-error", "the JSON Schema cannot be read"],
])

/**
 * One Fault per instance location, after reduction — the contract's rule.
 * Two clauses at one location join into one Fault, so two required misses
 * on one object are one Fault naming both properties.
 */
const faultsOf = (errors: readonly JsonError[]): Fault[] => {
  const clauses = new Map<string, string[]>()
  for (const error of errors) {
    const at = atOf(error)
    const wanted = wantedOf(error)
    const found = clauses.get(at) ?? []
    if (!found.includes(wanted)) found.push(wanted)
    clauses.set(at, found)
  }
  return [...clauses].map(([at, wants]) => ({ at, wanted: wants.join(" and ") }))
}

const NOT_JSON: Judged = { verdict: "invalid", faults: [{ at: "", wanted: "one JSON value" }] }

export const accepts: Validator["accepts"] = (schema) =>
  Effect.suspend(() => {
    const why = unreadable(schema)
    return why === undefined ? Effect.void : Effect.fail(new ValidatorError({ message: why }))
  })

export const check: Validator["check"] = (schema, candidate) =>
  Effect.suspend(() => {
    const why = unreadable(schema)
    if (why !== undefined) return Effect.fail(new ValidatorError({ message: why }))
    let value: unknown
    try {
      value = JSON.parse(extract(candidate))
    } catch {
      return Effect.succeed(NOT_JSON)
    }
    const { valid, errors } = compileSchema(schema as JsonSchema, {
      drafts: [draft2020],
    }).validate(value)
    const broken = errors.find((error) => UNREADABLE_CODES.has(codeOf(error)))
    if (broken !== undefined) {
      const what = UNREADABLE_CODES.get(codeOf(broken)) ?? "the JSON Schema cannot be read"
      return Effect.fail(new ValidatorError({ message: `${what} at ${rooted(atOf(broken))}` }))
    }
    return Effect.succeed<Judged>(
      valid ? { verdict: "valid", value } : { verdict: "invalid", faults: faultsOf(errors) },
    )
  })
