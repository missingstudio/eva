import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Wrote } from "./command.js"

/**
 * Rendered to a string rather than into a document, as every drawing on this
 * page is: a browser is what the served page is proven against, and the route
 * a line travels is proven in `plugins/api` against a real socket.
 */
describe("what a command wrote", () => {
  /**
   * What a command wrote is the whole of its answer. A `/mode` that listed the
   * modes it knows, because this door draws no panel, is a listing that has to
   * arrive somewhere — and nothing else on the page would carry it.
   */
  it("shows what the last line wrote", () => {
    const drawn = renderToStaticMarkup(<Wrote text={"mode: read-only\n  default\n  read-only"} />)

    expect(drawn).toContain("mode: read-only")
    expect(drawn).toContain("panel-terminal")
  })

  // Nothing has been run yet, so there is nothing to say it wrote. A command
  // that ran and wrote nothing says nothing either.
  it("says nothing before a line has run, and nothing for a line that wrote none", () => {
    expect(renderToStaticMarkup(<Wrote />)).toBe("")
    expect(renderToStaticMarkup(<Wrote text="" />)).toBe("")
  })
})
