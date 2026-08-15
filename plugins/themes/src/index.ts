import { define, type CommandContext, type PickRow, type ThemeInfo } from "@missingstudio/eva-sdk"
import { themeColors } from "@missingstudio/eva-tui-core"
import { Effect } from "effect"

/**
 * Every theme fills every key the renderer contract names — `THEME_KEYS` in
 * tui-core — and no more: a color no renderer reads is not carried, and the
 * contract's own test welds the key set to the gate that demands it.
 */
export const THEMES: readonly ThemeInfo[] = [
  {
    id: "default",
    name: "Default",
    colors: {
      foreground: "#e6e6e6",
      muted: "#8a8a94",
      accent: "#7aa2f7",
      warning: "#e0af68",
    },
  },
  {
    id: "contrast",
    name: "High contrast",
    colors: {
      foreground: "#ffffff",
      muted: "#c0c0c0",
      accent: "#00ffff",
      warning: "#ffff00",
    },
  },
  {
    id: "mono",
    name: "Monochrome",
    colors: {
      foreground: "#e8e8e8",
      muted: "#7d7d7d",
      accent: "#e8e8e8",
      warning: "#b8b8b8",
    },
  },
]

/**
 * A theme as a row of a choice. It carries its colors, so a surface that
 * paints can show what the theme looks like while it is under the selection
 * — the whole of live preview, and nothing a surface without colors reads.
 */
export const themeRow = (theme: ThemeInfo): PickRow => ({
  id: theme.id,
  label: theme.name,
  detail: theme.id,
  colors: theme.colors,
})

/**
 * A theme, applied. The contract's own gate says which rows are themes: one
 * missing a color the renderer names is not one yet, and saying so is
 * better than painting half of it.
 */
const apply = (ctx: CommandContext, theme: ThemeInfo): void => {
  if (themeColors(theme.colors) === undefined) {
    ctx.write(`theme ${theme.id} misses a color this build draws\n`)
    return
  }
  if (ctx.paint === undefined) {
    ctx.write(`this surface draws no colors\n`)
    return
  }
  ctx.paint(theme.colors)
  // The outcome is said in words as well as drawn, so a reader scrolling
  // back knows what happened and not only what it looked like.
  ctx.write(`theme → ${theme.name}\n`)
}

/**
 * `/theme`: an argument applies one, and no argument asks. What the panel
 * paints while a row is under the selection is the surface's — a look, not
 * a decision — and this is where the decision is made.
 */
const chooseTheme = (rows: Effect.Effect<readonly ThemeInfo[]>) =>
  Effect.fn("eva.themes.choose")(function* (ctx: CommandContext) {
    const themes = yield* rows
    const named = (id: string | undefined): ThemeInfo | undefined =>
      themes.find((one) => one.id === id)

    if (ctx.argument !== undefined) {
      const wanted = named(ctx.argument)
      // A name that is not a theme here is said rather than guessed at.
      if (wanted === undefined) {
        ctx.write(`theme ${ctx.argument} is not a theme here\n`)
        return
      }
      apply(ctx, wanted)
      return
    }

    if (ctx.pick === undefined) {
      ctx.write(`${themes.map((one) => `${one.id}  ${one.name}`).join("\n")}\n`)
      return
    }

    const chosen = named((yield* ctx.pick("theme", themes.map(themeRow)))?.id)
    if (chosen !== undefined) apply(ctx, chosen)
  })

export const themes = define({
  id: "eva.themes",
  effect: Effect.fn("eva.themes")(function* (ctx) {
    yield* ctx.theme.transform((draft) => {
      for (const theme of THEMES) draft.set(theme)
    })

    // The command belongs here, because the rows it picks from do: a build
    // without this plugin has no themes to choose between and no `/theme`
    // that pretends otherwise.
    yield* ctx.command.transform((draft) => {
      draft.set({
        id: "theme",
        description: "Choose the screen's colors",
        argumentHint: "theme",
        run: chooseTheme(ctx.theme.get),
      })
    })
  }),
})
