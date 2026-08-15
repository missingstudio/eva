import { modelRef } from "@missingstudio/eva-core"
import { readShape } from "@missingstudio/eva-sdk"
import { KEYS } from "./keys.js"

export interface Projection {
  readonly model?: { readonly provider: string; readonly model: string }
  readonly agents: readonly { readonly id: string; readonly prompt?: string }[]
  readonly commands: readonly { readonly id: string; readonly description: string }[]
  readonly themes: readonly {
    readonly id: string
    readonly name: string
    readonly colors: Readonly<Record<string, string>>
  }[]
  readonly keymap: readonly {
    readonly id: string
    readonly binding: string
    readonly command: string
  }[]
}

// Inside a declared mapping the keys are the person's own, so these read one
// level down through the same reader the declaration uses.
const mapping = (value: unknown): Record<string, unknown> => readShape(value, "mapping") ?? {}
const text = (value: unknown): string | undefined => readShape(value, "string")

/**
 * Reading config is the kernel's job; this is the interpreting half. It
 * projects the raw mapping into the domains and reads nothing from disk.
 *
 * Every top-level key is read through `KEYS`, so what is projected is exactly
 * what was declared, in the shape it was declared as. Hand-rolled readers
 * here once took a list where the declaration said mapping, and a run then
 * reported the key misshapen and projected it anyway.
 */
export const project = (raw: Record<string, unknown>): Projection => {
  const model = modelRef(KEYS.read(raw, "model", ""))

  const agents = Object.entries(KEYS.read(raw, "agents", {})).map(([id, value]) => {
    const prompt = text(mapping(value)["prompt"])
    return { id, ...(prompt === undefined ? {} : { prompt }) }
  })

  const commands = Object.entries(KEYS.read(raw, "commands", {})).map(([id, value]) => ({
    id,
    description: text(mapping(value)["description"]) ?? id,
  }))

  const keymap = Object.entries(KEYS.read(raw, "keymap", {})).flatMap(([id, value]) => {
    const binding = text(mapping(value)["binding"]) ?? text(value)
    const command = text(mapping(value)["command"]) ?? id
    return binding === undefined ? [] : [{ id, binding, command }]
  })

  // A theme a person writes may fill some keys and not others. A row with a
  // gap is not a theme yet, and the renderer keeps its own default, so a
  // partial theme changes nothing rather than drawing half of one.
  const themes = Object.entries(KEYS.read(raw, "themes", {})).map(([id, value]) => {
    const row = mapping(value)
    const colors = Object.entries(mapping(row["colors"])).flatMap(([key, one]) => {
      const color = text(one)
      return color === undefined ? [] : [[key, color] as const]
    })
    return { id, name: text(row["name"]) ?? id, colors: Object.fromEntries(colors) }
  })

  return {
    ...(model === undefined ? {} : { model }),
    agents,
    commands,
    themes,
    keymap,
  }
}
