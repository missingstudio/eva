import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CommandLine } from "./command.js"
import { Session } from "./session.js"

/**
 * Rendered to a string rather than into a document, as every drawing on this
 * page is: a browser is what the served page is proven against, and the route
 * a line travels is proven in `plugins/api` against a real socket.
 */
describe("the command line", () => {
  it("offers a field for the line and a control that runs it", () => {
    const drawn = renderToStaticMarkup(<CommandLine run={() => undefined} />)

    expect(drawn).toContain("command line")
    expect(drawn).toContain("Run")
  })

  /**
   * A control that looks live and reaches nothing is worse than one that says
   * it is not. This page draws the line whether or not the pipe answered, so
   * it says which of the two it is.
   */
  it("says it reaches nothing when it has nowhere to send", () => {
    expect(renderToStaticMarkup(<CommandLine />)).toContain("disabled")
  })

  /**
   * What a command wrote is the whole of its answer. A `/mode` that listed the
   * modes it knows, because this door draws no panel, is a listing that has to
   * arrive somewhere — and nothing else on the page would carry it.
   */
  it("shows what the last line wrote", () => {
    const drawn = renderToStaticMarkup(
      <CommandLine run={() => undefined} wrote={"mode: read-only\n  default\n  read-only"} />,
    )

    expect(drawn).toContain("mode: read-only")
    expect(drawn).toContain("read-only")
  })

  // Nothing has been run yet, so there is nothing to say it wrote.
  it("says nothing before a line has run", () => {
    const drawn = renderToStaticMarkup(<CommandLine run={() => undefined} />)

    expect(drawn).not.toContain("panel-terminal")
  })

  /**
   * The Session page draws what it is handed and reads nothing itself, so a
   * page mounted without a command line has none. That is what keeps the page
   * provable without a socket standing behind it.
   */
  it("is the Session page's to mount, and absent when nobody mounted one", () => {
    const reading = { folded: { kind: "folding" }, said: "", running: false } as const
    const without = renderToStaticMarkup(
      <Session
        header={undefined}
        pipe={{ at: "ready", dropped: false }}
        reading={reading}
        session="ses_1"
      />,
    )
    const with_ = renderToStaticMarkup(
      <Session
        command={<CommandLine run={() => undefined} />}
        header={undefined}
        pipe={{ at: "ready", dropped: false }}
        reading={reading}
        session="ses_1"
      />,
    )

    expect(without).not.toContain("command line")
    expect(with_).toContain("command line")
  })
})
