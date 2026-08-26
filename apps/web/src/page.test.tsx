import { sessionID } from "@missingstudio/eva-schema"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildLine } from "./build.js"
import { Listing, Page } from "./page.js"

/**
 * Rendered to a string rather than into a document, because a browser is what
 * the served page is proven against — `plugins/web` opens a socket for that,
 * and `packages/conformance` reads the wire behind it.
 */
describe("the listing", () => {
  const held = [
    { id: sessionID("ses_one"), title: "the first ask", updatedAt: "2026-08-26T00:00:00.000Z" },
    { id: sessionID("ses_two") },
  ]

  it("names every Session Eva holds, with its Header", () => {
    const drawn = renderToStaticMarkup(<Listing sessions={held} />)

    expect(drawn).toContain("the first ask")
    expect(drawn).toContain("ses_one")
    expect(drawn).toContain("2026-08-26T00:00:00.000Z")
  })

  // A title is what a Run said, so a Session that has heard nothing has none.
  // It is still on the page: one a person cannot see is one they cannot open.
  it("names a Session that has no title yet, rather than leaving it out", () => {
    const drawn = renderToStaticMarkup(<Listing sessions={held} />)

    expect(drawn).toContain("ses_two")
    expect(drawn).toContain("no title yet")
  })

  // A Run's intent is a whole prompt, so a listing that drew every title as
  // the record holds it would be a listing nobody can scan.
  it("draws a whole prompt as one row, and keeps the whole of it on the row", () => {
    const drawn = renderToStaticMarkup(
      <Listing
        sessions={[{ id: sessionID("ses_long"), title: "make it read\nlike a transcript" }]}
      />,
    )

    expect(drawn).toContain("make it read…")
    expect(drawn).toContain('title="make it read')
  })

  // An empty listing and a listing that has not arrived are two different
  // things, and a page that drew them the same way would be lying about one.
  it("says Eva holds none, rather than looking like it is still reading", () => {
    const drawn = renderToStaticMarkup(<Listing sessions={[]} />)

    expect(drawn).toContain("Eva holds no Session yet")
    expect(drawn).not.toContain("Reading")
  })
})

describe("the page", () => {
  it("says which build it is", () => {
    expect(renderToStaticMarkup(<Page />)).toContain(buildLine())
  })

  // Nothing has been read at the first paint. Reading is progressive, so the
  // page says which page it is before it can say what Eva holds.
  it("says it is reading before the wire has answered", () => {
    expect(renderToStaticMarkup(<Page />)).toContain("Reading the Sessions")
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
