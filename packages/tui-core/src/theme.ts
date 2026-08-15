/**
 * The colors a Renderer draws, and every one of them is drawn: a color no
 * renderer reads is not carried. A theme row may hold more keys than these;
 * the contract holds exactly these.
 */
export const THEME_KEYS = ["foreground", "muted", "accent", "warning"] as const
export type ThemeColors = { readonly [K in (typeof THEME_KEYS)[number]]: string }

/**
 * The one gate between a theme row's loose colors and the renderer contract.
 * A row missing a key is not a theme yet, and the caller keeps its default —
 * and says so, because a theme dropped in silence reads as a theme applied.
 */
export const themeColors = (colors: Readonly<Record<string, string>>): ThemeColors | undefined => {
  const { foreground, muted, accent, warning } = colors
  if (!foreground || !muted || !accent || !warning) return undefined

  return { foreground, muted, accent, warning }
}
