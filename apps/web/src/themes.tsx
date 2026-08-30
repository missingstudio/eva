import type { ThemeInfo } from "@missingstudio/eva-sdk"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@missingstudio/ui/components/select"
import { useEffect, useState } from "react"

/**
 * Eva's theme rows, on the page.
 *
 * The rows are the theme domain's — `plugins/themes` registers these three and
 * the terminal maps them — and they are said again here because a page may
 * import no plugin: the rows travel with the renderer contract the terminal
 * draws through, which is not a package a browser bundle may pull. So the two
 * lists are welded rather than shared, in `packages/conformance`, where one
 * suite may hold both doors to one answer.
 *
 * The page is dark only, as every Eva surface is, so a row is not a light
 * scheme and a dark scheme: it is which colors this one panel draws.
 */
export const THEMES: readonly ThemeInfo[] = [
  {
    id: "default",
    name: "Default",
    colors: {
      foreground: "#e5e5e6",
      muted: "#8a8f98",
      accent: "#ee6018",
      warning: "#02b8cc",
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
 * Which token each color the contract names paints.
 *
 * The default row is the proof of the mapping: every value in it is the value
 * the stylesheet already holds for the token it is written onto, so drawing
 * the default theme changes nothing. A key this page has no token for would
 * be a color nothing draws, and there is none — the contract names four.
 */
const PAINTS: Readonly<Record<string, string>> = {
  foreground: "--ink",
  muted: "--ink-3",
  accent: "--accent",
  warning: "--run",
}

/**
 * A theme, drawn. The values land on the root as the tokens every rule on
 * this page reads, so one write reskins all of it — the same trick the two
 * skins were built on, and the reason no rule here names a colour.
 */
export const paint = (theme: ThemeInfo, root: HTMLElement): void => {
  for (const [key, token] of Object.entries(PAINTS)) {
    const value = theme.colors[key]
    if (value !== undefined) root.style.setProperty(token, value)
  }
}

/**
 * The theme this page draws, and everything drawing it. One page, one answer:
 * the control on the rail and a `/theme` line are two ways to the same
 * choice, and two copies of it would be a control that says one thing while
 * the page shows another.
 */
let held: ThemeInfo = THEMES[0] as ThemeInfo
const readers = new Set<(theme: ThemeInfo) => void>()

// A row, by the name a person types or picks. Nothing for a name that is not
// a row here, which is said rather than guessed at.
export const themeFor = (id: string | undefined): ThemeInfo | undefined =>
  THEMES.find((one) => one.id === id)

export const choose = (theme: ThemeInfo): void => {
  held = theme
  paint(theme, document.documentElement)
  for (const wake of readers) wake(theme)
}

export const useTheme = (): ThemeInfo => {
  const [shown, setShown] = useState(held)

  useEffect(() => {
    readers.add(setShown)
    setShown(held)
    return () => void readers.delete(setShown)
  }, [])

  return shown
}

/**
 * `/theme`, answered on this page rather than where the Domains are.
 *
 * Every other command runs on the far side, because a command reaches Domains
 * and a `/mode` run here would move the approval state of the process nobody
 * is talking to. Painting is the exception: it is a capability of the surface
 * that draws, and this wire carries none — the request that runs a line
 * supplies no `paint`, so the command correctly reports that the surface it
 * can see draws no colors. Answering it here is what makes the sentence a
 * person reads true.
 *
 * The words are the theme command's own, so a person who has read them at one
 * door reads the same ones at the other.
 *
 * Nothing for a line that names another command: that line goes over the wire
 * as every other does.
 */
export const themed = (line: string): string | undefined => {
  const said = line.trim()
  if (said !== "/theme" && !said.startsWith("/theme ")) return undefined

  const argument = said.slice("/theme".length).trim()
  if (argument === "") return THEMES.map((one) => `${one.id}  ${one.name}`).join("\n")

  const wanted = themeFor(argument)
  if (wanted === undefined) return `theme ${argument} is not a theme here`

  choose(wanted)
  return `theme → ${wanted.name}`
}

/**
 * The control, on the rail beside the build line: the same three rows, for a
 * person who would rather pick than type. It reads nothing over the wire — a
 * theme is what this one surface draws and no other surface hears about it.
 */
export const ThemePicker = () => {
  const theme = useTheme()

  return (
    <Select
      onValueChange={(value) => {
        const wanted = themeFor(String(value))
        if (wanted !== undefined) choose(wanted)
      }}
      value={theme.id}
    >
      <SelectTrigger aria-label="theme" className="side-theme" size="sm">
        {/* The name and never the id. A person picked a row by its name, and
            the control that reports the choice says the same word back. */}
        <SelectValue>{(value: unknown) => themeFor(String(value))?.name ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((one) => (
          <SelectItem key={one.id} value={one.id}>
            {one.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
