import { declare, define, type Plugin, type Running } from "@missingstudio/eva-sdk"
import { themeColors, type ChosenRenderer, type ThemeColors } from "@missingstudio/eva-tui-core"
import { Effect } from "effect"
import { makeSurface, TUI_SURFACE, type Where } from "./surface.js"

export * from "./banner.js"
export * from "./console.js"
export * from "./line.js"
export * from "./surface.js"

/**
 * `theme` selects one theme; `themes` holds the themes there are, and belongs
 * to the plugin that projects them.
 */
const KEYS = declare({ theme: "name" })

export interface TuiOptions {
  /**
   * Built when the surface starts, so a `--print` run never opens a terminal
   * and never loads a renderer this runtime may not support. What the
   * factory decided quietly comes back beside the Renderer, as notices this
   * surface shows.
   *
   * The theme is named for what choosing a renderer has to say about it —
   * a plain one draws no colors — and not to build one with: colors reach a
   * renderer as a fact of every Frame.
   */
  readonly renderer: (theme?: ThemeColors) => Promise<ChosenRenderer>
  /**
   * Where the work happens. This process's own directory by default, which is
   * what an in-process door knows; `eva attach` names the runtime it dialled,
   * because the work is then on another machine.
   */
  readonly where?: () => Where
  // How a line runs, when it does not run in this process. Absent is the
  // local dispatch.
  readonly run?: Running
  // The banner names the build, and the app is what holds the manifest.
  readonly version: string
}

/**
 * The terminal surface. It takes its Renderer from the composition root
 * because a plugin may not import an app, and takes it lazily so a
 * non-interactive run never touches the terminal.
 */
export const makeTui = (options: TuiOptions): Plugin =>
  define({
    id: TUI_SURFACE,
    reads: KEYS.shapes,
    effect: Effect.fn(TUI_SURFACE)(function* (ctx) {
      // Config names the theme; the theme Domain holds it. Read when the
      // surface starts, so the chosen theme is the one the rebuilt rows hold.
      const theme = Effect.gen(function* () {
        // Read through the declaration, so it is read as the shape it was
        // declared as: `theme: mono` and `theme: { id: mono }` both name the
        // same theme, and reading only the first accepted the second in
        // config and then ignored it.
        const wanted = KEYS.read(yield* ctx.config, "theme", "default")
        const row = (yield* ctx.theme.get).find((one) => one.id === wanted)
        const colors = row === undefined ? undefined : themeColors(row.colors)
        // A theme that named no row, or a row that is not a theme yet, keeps
        // the default — and says so, because a theme dropped in silence
        // reads as a theme applied.
        const notices =
          colors === undefined && wanted !== "default"
            ? [`theme ${wanted} is not a theme here; the default is drawn instead`]
            : []
        return { colors, notices }
      })

      yield* ctx.surface.transform((draft) => {
        draft.set({
          id: TUI_SURFACE,
          interactive: true,
          streaming: true,
          images: false,
          start: (client) =>
            Effect.gen(function* () {
              const chosen = yield* theme
              const picked = yield* Effect.promise(() => options.renderer(chosen.colors))
              return yield* makeSurface({
                client,
                renderer: picked.renderer,
                commands: ctx.command.get,
                keymap: ctx.keymap.get,
                where: (
                  options.where ?? (() => ({ kind: "directory", path: process.cwd() }) as const)
                )(),
                ...(options.run === undefined ? {} : { run: options.run }),
                version: options.version,
                ...(chosen.colors === undefined ? {} : { theme: chosen.colors }),
                notices: [...chosen.notices, ...picked.notices],
              })
            }),
        })
      })
    }),
  })
