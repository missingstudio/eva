import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildLine } from "./build.js"
import { Page } from "./page.js"

/**
 * Rendered to a string rather than into a document, because a browser is
 * what the served page is proven against — `plugins/web` opens a socket for
 * that — and this only has to say the page names its build.
 */
describe("the page", () => {
  it("says which build it is", () => {
    expect(renderToStaticMarkup(<Page />)).toContain(buildLine())
  })

  // No wire has landed, so a page that implied one would be lying.
  it("says nothing has reached Eva yet", () => {
    expect(renderToStaticMarkup(<Page />)).toContain("Nothing here reaches Eva yet")
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
