import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildLine } from "./build.js"
import { Page } from "./page.js"

/**
 * Rendered to a string rather than into a document, because a browser is what
 * the served page is proven against — `plugins/web` opens a socket for that,
 * and `packages/conformance` reads the wire behind it.
 */
describe("the index pane", () => {
  it("says which build it is", () => {
    expect(renderToStaticMarkup(<Page />)).toContain(buildLine())
  })

  /**
   * The listing is not here any more: it is on the rail, which the shell keeps
   * across both routes. `shell.test.tsx` holds it. What is left is the pane a
   * reader sees with no Session open, and it reads nothing — so it says
   * nothing about what Eva holds.
   */
  it("reads nothing, and so says nothing about what Eva holds", () => {
    const drawn = renderToStaticMarkup(<Page />)

    expect(drawn).not.toContain("Reading the Sessions")
    expect(drawn).not.toContain("Eva holds no Session yet")
  })

  it("names the page and points at the rail", () => {
    expect(renderToStaticMarkup(<Page />)).toContain("the page that prompts")
  })

  /**
   * The design system's own rule for an empty state: say what is missing, and
   * how to fill it. A pane that said neither left a first visitor with a
   * title, a build string, and nothing to press.
   */
  it("says no Session is open, and offers the one thing that opens one", () => {
    const drawn = renderToStaticMarkup(<Page />)

    expect(drawn).toContain("No Session is open.")
    expect(drawn).toContain("Start a Session")
  })

  // And names the other way to the same place. The rail is behind a trigger
  // at the widths where it has no column, so it is named as the listing
  // rather than as a direction to look in.
  it("names the listing as the other way in", () => {
    expect(renderToStaticMarkup(<Page />)).toContain("or open one from the listing")
  })

  /**
   * The gesture, taught where a first visitor is. The terminal prints its
   * doors where a person first looks, and this pane says the one the field
   * has — a door nobody names is a door nobody finds.
   */
  it("teaches the one gesture the field has", () => {
    const drawn = renderToStaticMarkup(<Page />)

    expect(drawn).toContain("In a Session, type")
    expect(drawn).toContain("<code>/</code>")
    expect(drawn).toContain("for commands")
  })

  /**
   * One landmark and one heading, on whichever route is drawn. A page with no
   * `main` is a page a screen reader has no way into past the rail, and a page
   * with no `h1` is one that never says which page it is.
   */
  it("draws one main landmark and one heading", () => {
    const drawn = renderToStaticMarkup(<Page />)

    expect(drawn.match(/<main/g)).toHaveLength(1)
    expect(drawn.match(/<h1/g)).toHaveLength(1)
  })
})

describe("the build line", () => {
  it("names the version and the stamp, in that order", () => {
    expect(buildLine("0.2.0", "2026-08-25T09:00:00")).toBe("0.2.0 · 2026-08-25T09:00:00")
  })

  // Read from source, or read from a build the toolchain did not define
  // into. Either is a page nobody built, and it says so rather than
  // naming a version it does not have.
  it("says it is unbuilt when the build defined nothing", () => {
    expect(buildLine()).toBe("unbuilt · unbuilt")
  })
})
