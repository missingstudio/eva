import { modelRef, type ModelRef } from "@missingstudio/eva-core"
import { readShape } from "@missingstudio/eva-sdk"
import { readReference, type Reference } from "./reference.js"

export interface Step {
  readonly id: string
  // A row in the prompt domain. The key is `template`, not `prompt`, because
  // the row is a Template and a Prompt is what a person asks.
  readonly template: string
  readonly model?: ModelRef
  readonly with: Readonly<Record<string, Reference>>
  // A JSON Schema, inline, judged by the Validator slot at the point of use.
  readonly schema?: unknown
  // A per-Step ceiling on Repairs, a whole number of zero or more, over the
  // plugin's `repairs` option.
  readonly repairs?: number
}

export interface Workflow {
  readonly id: string
  readonly name: string
  readonly model?: ModelRef
  readonly steps: readonly Step[]
}

/**
 * The load-time pass, from the document alone. A document with problems still
 * names a row: the Workflow registers with `open` either way, and a run of a
 * broken one refuses at its first Prompt with every problem named — a person
 * fixing a file wants the list, not the first entry.
 */
export interface ReadWorkflow {
  readonly id: string
  readonly name: string
  // Present exactly when `problems` is empty.
  readonly workflow?: Workflow
  readonly problems: readonly string[]
}

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

// A blank string is no value: an id and a template must say something.
const worded = (value: unknown): string | undefined => {
  const text = readShape(value, "string")
  return text === "" ? undefined : text
}

export const readWorkflow = (id: string, raw: unknown): ReadWorkflow => {
  const document = readShape(raw, "mapping")
  if (document === undefined) {
    return { id, name: id, problems: ["the document is not a mapping"] }
  }

  const name = readShape(document["name"], "string") ?? id
  const problems: string[] = []

  const modelOf = (value: unknown, where: string): ModelRef | undefined => {
    if (value === undefined) return undefined
    const written = readShape(value, "string")
    const parsed = written === undefined ? undefined : modelRef(written)
    if (parsed === undefined) {
      const said = written ?? JSON.stringify(value)
      problems.push(`${where}model ${said} does not parse as provider/model`)
    }
    return parsed
  }

  const model = modelOf(document["model"], "")

  const list = readShape(document["steps"], "list")
  if (list === undefined) {
    problems.push("steps is not a list")
    return { id, name, problems }
  }
  if (list.length === 0) {
    problems.push("steps is empty")
    return { id, name, problems }
  }

  const steps: Step[] = []
  // A Step may only name a Step declared before it, so the file is the
  // execution order and the order is acyclic by construction.
  const earlier = new Set<string>()

  list.forEach((entry, index) => {
    const step = readShape(entry, "mapping")
    if (step === undefined) {
      problems.push(`step ${index + 1} is not a mapping`)
      return
    }

    const stepID = worded(step["id"])
    if (stepID === undefined) {
      problems.push(`step ${index + 1} has no id`)
    } else if (earlier.has(stepID)) {
      problems.push(`two steps hold the id ${stepID}`)
    }
    const at = stepID ?? `${index + 1}`

    const template = worded(step["template"])
    if (template === undefined) {
      problems.push(`step ${at} has no template`)
    }

    const stepModel = modelOf(step["model"], `step ${at}: `)

    let repairs: number | undefined
    if (step["repairs"] !== undefined) {
      repairs = readShape(step["repairs"], "number")
      if (repairs === undefined) {
        problems.push(`step ${at}: repairs is not a number`)
      } else if (!Number.isInteger(repairs) || repairs < 0) {
        problems.push(`step ${at}: repairs is ${repairs}, not a whole number of zero or more`)
      }
    }

    const binds: Record<string, Reference> = {}
    if (step["with"] !== undefined) {
      const bound = readShape(step["with"], "mapping")
      if (bound === undefined) {
        problems.push(`step ${at}: with is not a mapping`)
      } else {
        for (const [key, value] of Object.entries(bound)) {
          if (!NAME.test(key)) problems.push(`step ${at}: ${key} is not a name`)
          const written = readShape(value, "string")
          const reference = written === undefined ? undefined : readReference(written)
          if (reference === undefined) {
            const said = written ?? JSON.stringify(value)
            problems.push(`step ${at}: ${said} is not input, <step>.output or <step>.output.<path>`)
            continue
          }
          if (reference.kind === "output" && !earlier.has(reference.step)) {
            problems.push(`step ${at}: ${written} names no earlier step`)
            continue
          }
          binds[key] = reference
        }
      }
    }

    if (stepID !== undefined) earlier.add(stepID)
    if (stepID !== undefined && template !== undefined) {
      steps.push({
        id: stepID,
        template,
        with: binds,
        ...(stepModel === undefined ? {} : { model: stepModel }),
        ...(step["schema"] === undefined ? {} : { schema: step["schema"] }),
        ...(repairs === undefined ? {} : { repairs }),
      })
    }
  })

  if (problems.length > 0) return { id, name, problems }
  return {
    id,
    name,
    workflow: { id, name, ...(model === undefined ? {} : { model }), steps },
    problems: [],
  }
}
