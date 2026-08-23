/**
 * The reference language `with` speaks, whole. A reference is one of exactly
 * three shapes: `input` for the Prompt text, `<stepID>.output` for an earlier
 * Step's Output, and `<stepID>.output.<dotted.path>` for one field of it.
 * No expressions, no filters, no conditions, no literals, and no forward
 * references.
 */
export type Reference =
  | { readonly kind: "input" }
  | { readonly kind: "output"; readonly step: string; readonly path: readonly string[] }

// What resolving came to. `missing` names the hole in the caller's words.
export type Resolved =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing"; readonly why: string }

// One written reference, read, or nothing when it is none of the three shapes.
export const readReference = (written: string): Reference | undefined => {
  if (written === "input") return { kind: "input" }
  const [step, output, ...path] = written.split(".")
  if (step === undefined || step === "" || output !== "output") return undefined
  if (path.some((segment) => segment === "")) return undefined
  return { kind: "output", step, path }
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * One reference, resolved against the Prompt and the Outputs so far.
 *
 * A resolved value is always text, because `Variables` is
 * `Record<string, string>`: a value that is not text is stringified here,
 * once, and nowhere else. This reads no clock, no environment and no file,
 * which is what makes a Workflow reproducible.
 */
export const resolveReference = (
  reference: Reference,
  input: string,
  outputs: ReadonlyMap<string, unknown>,
): Resolved => {
  if (reference.kind === "input") return { kind: "text", text: input }
  if (!outputs.has(reference.step)) {
    return { kind: "missing", why: `step ${reference.step} has not run` }
  }

  let value = outputs.get(reference.step)
  let walked = `${reference.step}.output`
  for (const segment of reference.path) {
    if (typeof value === "string") {
      return { kind: "missing", why: `${walked} is text and holds no ${segment}` }
    }
    if (!isMapping(value) || !(segment in value)) {
      return { kind: "missing", why: `${walked} holds no ${segment}` }
    }
    value = value[segment]
    walked = `${walked}.${segment}`
  }
  return { kind: "text", text: typeof value === "string" ? value : JSON.stringify(value) }
}
