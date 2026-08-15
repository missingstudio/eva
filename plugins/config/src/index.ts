import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { KEYS } from "./keys.js"
import { project } from "./project.js"

export * from "./findings.js"
export * from "./keys.js"
export * from "./project.js"

export const config = define({
  id: "eva.config",
  reads: KEYS.shapes,
  effect: Effect.fn("eva.config")(function* (ctx) {
    const raw = yield* ctx.config
    const projected = project(raw)

    // Config transforms register last, so a later entry wins over the
    // defaults a base plugin seeded.
    yield* ctx.catalog.transform((catalog) => {
      if (projected.model !== undefined) catalog.model.default.set(projected.model)
    })

    /**
     * Config writes rows a base plugin may already have registered, so each
     * one is read back and registered whole. What config does not say is
     * carried over rather than dropped: a `/model` described in config keeps
     * the `run` that `eva.commands` supplied.
     */
    if (projected.agents.length > 0) {
      yield* ctx.agent.transform((draft) => {
        for (const agent of projected.agents) {
          draft.set({
            ...draft.get(agent.id),
            id: agent.id,
            ...(agent.prompt === undefined ? {} : { prompt: agent.prompt }),
          })
        }
      })
    }

    // A theme a person writes may fill some keys and not others, so the
    // colours merge onto the ones the theme already had.
    if (projected.themes.length > 0) {
      yield* ctx.theme.transform((draft) => {
        for (const theme of projected.themes) {
          const found = draft.get(theme.id)
          draft.set({
            id: theme.id,
            name: theme.name,
            colors: { ...found?.colors, ...theme.colors },
          })
        }
      })
    }

    if (projected.commands.length > 0) {
      yield* ctx.command.transform((draft) => {
        for (const command of projected.commands) {
          draft.set({ ...draft.get(command.id), id: command.id, description: command.description })
        }
      })
    }

    if (projected.keymap.length > 0) {
      yield* ctx.keymap.transform((draft) => {
        for (const binding of projected.keymap) {
          draft.set({
            ...draft.get(binding.id),
            id: binding.id,
            binding: binding.binding,
            command: binding.command,
          })
        }
      })
    }
  }),
})
