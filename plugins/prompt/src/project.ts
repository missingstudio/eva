import { readShape, type PromptInfo } from "@missingstudio/eva-sdk"

/**
 * The pure projection from the raw `prompts` mapping to rows. It drops a row
 * rather than coercing one: an entry that is not a mapping, a `text` written
 * as a number or a list, and a `text` of nothing are not Templates, so the
 * row does not exist and the point of use says so with a `template` Gap.
 */
export const project = (raw: Record<string, unknown>): readonly PromptInfo[] =>
  Object.entries(raw).flatMap(([id, value]) => {
    const row = readShape(value, "mapping")
    const text = row === undefined ? undefined : readShape(row["text"], "string")
    return text === undefined || text === "" ? [] : [{ id, text }]
  })
