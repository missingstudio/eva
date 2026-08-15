import type { ChosenRenderer, Renderer, ThemeColors } from "@missingstudio/eva-tui-core"
import { makeStreamRenderer } from "./stream.js"

export * from "./frame.js"
export * from "./keys.js"
export * from "./palette.js"
export * from "./stream.js"

export interface Capable {
  // OpenTUI's renderer is native code reached over Bun's FFI. Nothing else
  // can load it, so it is never named until it is wanted.
  readonly ffi: boolean
  // A rich renderer takes over the screen, which needs a screen to take
  // over. Piped output gets the plain one, so `eva < script` stays readable.
  readonly tty: boolean
}

export const capabilities = (): Capable => ({
  ffi: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined",
  tty: process.stdout.isTTY === true,
})

export interface StartOptions {
  /**
   * The theme the configuration chose. The renderer is not built with it —
   * colors are a fact of the Frame, so the surface carries them down on
   * every draw. It is named here for the one thing choosing a renderer has
   * to say about it: a plain renderer draws none of them.
   */
  readonly theme?: ThemeColors
}

export const canDrawRich = (found: Capable = capabilities()): boolean => found.ffi && found.tty

// The module the rich renderer lives in, as the one shape `start` asks of
// it. A test hands in a module of its own, so the failing path is a case
// rather than a runtime accident.
type RichModule = {
  readonly makeOpenTuiRenderer: () => Promise<Renderer>
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// What choosing the plain renderer leaves unsaid, said. A pipe stays quiet —
// plain output is what a pipe asked for, not a degradation.
const plainNotices = (options: StartOptions, why: readonly string[]): readonly string[] => [
  ...why,
  ...(options.theme === undefined
    ? []
    : ["a theme is set, and the plain renderer draws no colors"]),
]

/**
 * The terminal, whichever one this runtime can give. OpenTUI draws where
 * there is FFI and a real screen; the stream renderer draws everywhere
 * else, so the binary stays interactive on Node rather than refusing — and
 * says why, because a renderer dropped in silence reads as a renderer
 * chosen.
 */
export const start = async (
  options: StartOptions = {},
  found: Capable = capabilities(),
  loadRich: () => Promise<RichModule> = () => import("./renderer.js"),
): Promise<ChosenRenderer> => {
  if (canDrawRich(found)) {
    try {
      const { makeOpenTuiRenderer } = await loadRich()
      return { renderer: await makeOpenTuiRenderer(), notices: [] }
    } catch (error) {
      // A terminal that cannot take the rich renderer still gets a usable one.
      return {
        renderer: makeStreamRenderer(),
        notices: plainNotices(options, [
          `the rich renderer failed to start: ${reason(error)}; the plain one is drawn`,
        ]),
      }
    }
  }
  return {
    renderer: makeStreamRenderer(),
    notices: found.tty
      ? plainNotices(options, ["the rich renderer needs Bun; the plain one is drawn"])
      : [],
  }
}
