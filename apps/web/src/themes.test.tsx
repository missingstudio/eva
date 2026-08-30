// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { paint, themed, ThemePicker, THEMES } from "./themes.js"

/**
 * The three rows this page draws, and the one command that draws them.
 *
 * That the rows are the theme domain's own is welded in
 * `packages/conformance`, where one suite may hold the page and the plugin at
 * once. What is held here is what this page does with them.
 */

const themeFor = (id: string) => THEMES.find((one) => one.id === id)

describe("the theme rows", () => {
  it("offers the default, the high contrast row and the monochrome one", () => {
    expect(THEMES.map((one) => one.id)).toEqual(["default", "contrast", "mono"])
  })

  it("writes a row onto the tokens every rule on the page reads", () => {
    const root = document.createElement("html")
    const mono = themeFor("mono")

    if (mono !== undefined) paint(mono, root)

    expect(root.style.getPropertyValue("--ink")).toBe("#e8e8e8")
    expect(root.style.getPropertyValue("--ink-3")).toBe("#7d7d7d")
    expect(root.style.getPropertyValue("--accent")).toBe("#e8e8e8")
    expect(root.style.getPropertyValue("--run")).toBe("#b8b8b8")
  })
})

/**
 * `/theme` is answered on the page, because painting is a capability of the
 * surface that draws and this wire carries none. The words are the theme
 * command's own, so a person who has read them at the terminal reads the same
 * ones here.
 */
describe("a `/theme` line", () => {
  it("draws the theme it names, and says which one it drew", () => {
    expect(themed("/theme contrast")).toBe("theme → High contrast")
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#00ffff")
  })

  it("lists the rows when it names none", () => {
    const listed = themed("/theme")

    expect(listed).toContain("default  Default")
    expect(listed).toContain("contrast  High contrast")
    expect(listed).toContain("mono  Monochrome")
  })

  // A name that is not a row here is said rather than guessed at, and nothing
  // is drawn for it.
  it("says a name that is not a theme here", () => {
    expect(themed("/theme nope")).toBe("theme nope is not a theme here")
  })

  /**
   * And answers no other line. Every other command reaches the Domains, which
   * are in the serving process — a `/mode` answered here would move the
   * approval state of the process nobody is talking to.
   */
  it("answers nothing for a line that names another command", () => {
    expect(themed("/mode read-only")).toBeUndefined()
    expect(themed("/themes")).toBeUndefined()
    expect(themed("say something")).toBeUndefined()
  })
})

/**
 * The control, in a document. A listbox draws its rows only while it is open,
 * so a rendered string holds the trigger and nothing else — the same reason
 * the model picker is read here rather than in a string.
 */
describe("the theme control", () => {
  let mounted: Root | undefined

  afterEach(() => {
    act(() => mounted?.unmount())
    mounted = undefined
    document.body.replaceChildren()
  })

  const opened = async (): Promise<readonly string[]> => {
    const host = document.createElement("div")
    document.body.append(host)
    mounted = createRoot(host)

    await act(async () => mounted?.render(<ThemePicker />))
    const trigger = document.querySelector<HTMLElement>('[aria-label="theme"]')
    await act(async () => trigger?.click())

    return [...document.querySelectorAll('[role="option"]')].map((one) => one.textContent ?? "")
  }

  it("offers every row, by the name the row carries", async () => {
    const drawn = await opened()

    expect(drawn).toHaveLength(THEMES.length)
    for (const one of THEMES) expect(drawn.join(" ")).toContain(one.name)
  })
})
