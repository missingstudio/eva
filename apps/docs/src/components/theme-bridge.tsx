import { storeTheme, type Theme } from "@missingstudio/ui"
import { useTheme } from "fumadocs-ui/provider/base"
import { useEffect } from "react"

const isTheme = (value: string | undefined): value is Theme =>
  value === "light" || value === "dark" || value === "system"

/**
 * next-themes keeps the preference in local storage, which is per origin, and
 * this site and the marketing site are two origins. The record they share is a
 * cookie on the parent domain.
 *
 * This mirrors every change next-themes makes back into that cookie. The
 * pre-paint script in the document head reads it on the way in, so a reader
 * who picks dark here arrives at the marketing site in dark, and the other way
 * around.
 */
export function ThemeBridge() {
  const { theme } = useTheme()

  useEffect(() => {
    if (isTheme(theme)) storeTheme(theme)
  }, [theme])

  return null
}
