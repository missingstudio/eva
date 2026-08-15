import type { ThemeColors } from "@missingstudio/eva-tui-core"

export interface Palette {
  readonly human: string
  readonly agent: string
  readonly thought: string
  readonly tool: string
  readonly muted: string
  readonly accent: string
}

export const DEFAULT_PALETTE: Palette = {
  // A person's words are bold, and the accent is the bar beside them. The
  // words themselves stay the reading colour.
  human: "#e6e6e6",
  agent: "#e6e6e6",
  thought: "#8a8a94",
  tool: "#e0af68",
  muted: "#8a8a94",
  accent: "#7aa2f7",
}

// How a theme paints the transcript. Every color the contract names is read
// here, so the contract carries nothing a renderer does not draw. The default
// theme maps exactly onto DEFAULT_PALETTE — the conformance suite holds the
// two to it, because this package may not import the plugin that ships it.
export const paletteFrom = (colors: ThemeColors): Palette => ({
  human: colors.foreground,
  agent: colors.foreground,
  thought: colors.muted,
  tool: colors.warning,
  muted: colors.muted,
  accent: colors.accent,
})
