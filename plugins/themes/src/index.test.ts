import type { SessionAPI } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import type { CommandContext, PickRow } from "@missingstudio/eva-sdk"
import { THEME_KEYS, themeColors } from "@missingstudio/eva-tui-core"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { THEMES, themeRow, themes } from "./index.js"

describe("THEMES", () => {
  // A gap leaves the renderer its default; a spare key is carried for nobody.
  it.each(THEMES)("fills exactly the keys the contract names, for $id", (theme) => {
    expect(Object.keys(theme.colors).sort()).toEqual([...THEME_KEYS].sort())
  })

  // The gate is the contract's own; a shipped theme must pass it.
  it.each(THEMES)("passes the contract's gate, for $id", (theme) => {
    expect(themeColors(theme.colors)).toBeDefined()
  })

  it.each(THEMES)("writes every $id color as a hex string", (theme) => {
    for (const color of Object.values(theme.colors)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(THEMES)("gives $id a name", (theme) => {
    expect(theme.name).not.toBe("")
  })

  // The theme domain keys a row by its id, so a repeat would overwrite a row.
  it("holds one theme per id", () => {
    const ids = THEMES.map((theme) => theme.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * Through a live kernel, because the half that matters is the transform: a
 * plugin whose id is right and whose effect writes nothing looks identical
 * from outside until something reads the domain.
 */
describe("the themes plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(themes.id).toBe("eva.themes")
  })

  it("writes every theme into the theme domain", async () => {
    const rows = await withPlugin(themes, (kernel) =>
      Effect.map(kernel.domains.theme.get, (found) => found.map((row) => row.id)),
    )

    expect(rows).toEqual(THEMES.map((theme) => theme.id))
  })

  it("carries each theme's name and colors onto its row", async () => {
    const row = await withPlugin(themes, (kernel) =>
      Effect.map(kernel.domains.theme.get, (found) => found.find((one) => one.id === "mono")),
    )

    expect(row?.name).toBe("Monochrome")
    expect(Object.keys(row?.colors ?? {}).sort()).toEqual([...THEME_KEYS].sort())
  })

  // A transform replays on every rebuild, so one that appended rather than
  // updating would double the rows the second time round.
  it("replays without doubling its rows", async () => {
    const rows = await withPlugin(themes, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.domains.theme.reload
        return (yield* kernel.domains.theme.get).length
      }),
    )

    expect(rows).toBe(THEMES.length)
  })
})

interface Watched {
  readonly ctx: CommandContext
  readonly written: () => string
  readonly painted: () => Record<string, string> | undefined
}

/**
 * A context a test can watch. `pick` and `paint` are what a surface with a
 * screen supplies; a test that takes one away is a surface without it, where
 * the same command has to answer in words.
 */
const watched = (over: Partial<CommandContext> = {}): Watched => {
  const said: string[] = []
  let painted: Record<string, string> | undefined

  return {
    ctx: {
      // Nothing here reaches a Session: a theme is not a fact of one.
      api: {} as SessionAPI,
      session: "sess_test" as SessionID,
      write: (text) => void said.push(text),
      select: () => {},
      paint: (colors) => void (painted = colors),
      ...over,
    },
    written: () => said.join(""),
    painted: () => painted,
  }
}

// The command as this build registers it: the rows it picks from are the
// theme Domain's, so it is only itself once the kernel has built it.
const ran = (ctx: CommandContext, argument?: string) =>
  withPlugin(themes, (kernel) =>
    Effect.gen(function* () {
      const row = (yield* kernel.domains.command.get).find((one) => one.id === "theme")
      if (row?.run === undefined) throw new Error("this build cannot run /theme")
      yield* row.run(argument === undefined ? ctx : { ...ctx, argument })
    }),
  )

describe("/theme", () => {
  it("is a row of the command domain, because the themes are this plugin's", async () => {
    const row = await withPlugin(themes, (kernel) =>
      Effect.map(kernel.domains.command.get, (rows) => rows.find((one) => one.id === "theme")),
    )

    expect(row?.run).toBeTypeOf("function")
    expect(row?.argumentHint).toBe("theme")
  })

  it("paints the theme an argument names, and says so", async () => {
    const seen = watched()
    await ran(seen.ctx, "mono")

    expect(seen.painted()).toEqual(THEMES.find((one) => one.id === "mono")?.colors)
    expect(seen.written()).toContain("theme → Monochrome")
  })

  // A name that is not a theme here is said rather than guessed at.
  it("says so when the name is not a theme here", async () => {
    const seen = watched()
    await ran(seen.ctx, "dusk")

    expect(seen.painted()).toBeUndefined()
    expect(seen.written()).toContain("theme dusk is not a theme here")
  })

  // The rows carry their colors, which is what a surface previews as the
  // selection moves — and what nothing without a screen ever reads.
  it("offers every theme, with the colors it would paint", async () => {
    let offered: readonly PickRow[] = []
    const seen = watched({
      pick: (_title, rows) => {
        offered = rows
        return Effect.succeed(rows.find((row) => row.id === "contrast"))
      },
    })
    await ran(seen.ctx)

    expect(offered.map((row) => row.id)).toEqual(THEMES.map((one) => one.id))
    expect(offered[0]?.colors).toEqual(THEMES[0]?.colors)
    expect(seen.painted()).toEqual(THEMES.find((one) => one.id === "contrast")?.colors)
  })

  it("paints nothing when nobody chooses", async () => {
    const seen = watched({ pick: () => Effect.succeed(undefined) })
    await ran(seen.ctx)

    expect(seen.painted()).toBeUndefined()
    expect(seen.written()).toBe("")
  })

  it("writes the themes where nothing can pick", async () => {
    const seen = watched()
    await ran(seen.ctx)

    for (const theme of THEMES) expect(seen.written()).toContain(theme.name)
  })

  // A surface that draws no colors says so, rather than reporting a theme
  // it did not apply.
  it("says so where nothing paints", async () => {
    const seen = watched()
    const { paint: _paint, ...blind } = seen.ctx
    await ran(blind, "mono")

    expect(seen.painted()).toBeUndefined()
    expect(seen.written()).toContain("this surface draws no colors")
  })
})

describe("a theme as a row", () => {
  it("is named for a reader and identified for the line", () => {
    expect(themeRow(THEMES[1] as (typeof THEMES)[number])).toEqual({
      id: "contrast",
      label: "High contrast",
      detail: "contrast",
      colors: THEMES[1]?.colors,
    })
  })
})
