import type { Renderer } from "@missingstudio/eva-tui-core"
import { describe, expect, it } from "vitest"
import { canDrawRich, capabilities, start, type Capable } from "./index.js"

const both: Capable = { ffi: true, tty: true }

const rich: Renderer = {
  draw: () => {},
  draws: { panels: true, colors: true },
  onKey: () => () => {},
  onPaste: () => () => {},
  onEnd: () => () => {},
  stop: () => {},
}

const THEME = { foreground: "#fff", muted: "#888", accent: "#7aa", warning: "#e0a" }

describe("choosing a renderer", () => {
  it("draws rich when there is FFI and a screen", () => {
    expect(canDrawRich(both)).toBe(true)
  })

  // A rich renderer takes over the screen, so it needs one to take over.
  it("refuses the rich one when output is piped", () => {
    expect(canDrawRich({ ffi: true, tty: false })).toBe(false)
  })

  it("refuses the rich one where there is no FFI", () => {
    expect(canDrawRich({ ffi: false, tty: true })).toBe(false)
  })
})

describe("capabilities", () => {
  it("reports both as booleans, whatever this runtime is", () => {
    const found = capabilities()
    expect(typeof found.ffi).toBe("boolean")
    expect(typeof found.tty).toBe("boolean")
  })
})

describe("start", () => {
  it("gives the rich renderer where it can, with nothing to say", async () => {
    const chosen = await start({}, both, async () => ({
      makeOpenTuiRenderer: async () => rich,
    }))

    expect(chosen.renderer).toBe(rich)
    expect(chosen.notices).toEqual([])
  })

  // A renderer dropped in silence reads as a renderer chosen: the fallback
  // still happens, and the reason rides along for the surface to show.
  it("falls back with the reason when the rich renderer fails to start", async () => {
    const chosen = await start({}, both, async () => {
      throw new Error("no libffi here")
    })

    expect(typeof chosen.renderer.draw).toBe("function")
    expect(chosen.notices).toEqual([
      "the rich renderer failed to start: no libffi here; the plain one is drawn",
    ])
    chosen.renderer.stop()
  })

  it("says the rich renderer needs Bun on a screen without FFI", async () => {
    const chosen = await start({}, { ffi: false, tty: true })
    expect(chosen.notices).toEqual(["the rich renderer needs Bun; the plain one is drawn"])
    chosen.renderer.stop()
  })

  // Plain output is what a pipe asked for, not a degradation.
  it("stays quiet when output is piped", async () => {
    const chosen = await start({ theme: THEME }, { ffi: true, tty: false })
    expect(chosen.notices).toEqual([])
    chosen.renderer.stop()
  })

  // The theme gate said a theme dropped in silence reads as a theme applied.
  // The same holds one call later, where the plain renderer paints nothing.
  it("says a theme has nothing to paint it on a plain screen", async () => {
    const chosen = await start({ theme: THEME }, { ffi: false, tty: true })
    expect(chosen.notices).toContain("a theme is set, and the plain renderer draws no colors")
    chosen.renderer.stop()
  })

  it("gives a working renderer whatever this runtime can do", async () => {
    const chosen = await start()
    expect(typeof chosen.renderer.draw).toBe("function")
    expect(typeof chosen.renderer.onKey).toBe("function")
    chosen.renderer.stop()
  })
})
