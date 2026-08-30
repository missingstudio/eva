import { describe, expect, it } from "vitest"
import { PREFIX, reasonOf, say, sayEvicted, sayMiss, speak } from "./report.js"

/**
 * The voice is one prefix and one shape. A person reads every refusal, fault
 * and notice this app writes in it, so they can tell Eva speaking from a
 * crash without reading the words.
 */
describe("the one voice", () => {
  it("carries the prefix on what happened", () => {
    expect(speak({ what: "nothing is registered" })).toBe("eva: nothing is registered")
  })

  // One message, however many sentences it takes: the lines after the first
  // are indented under the prefix rather than repeating it.
  it("indents why and the next step under the prefix", () => {
    expect(speak({ what: "one input only", why: "it got two", next: "name one" })).toBe(
      ["eva: one input only", "     it got two", "     name one"].join("\n"),
    )
  })

  it("says only what happened when there is no why and no next step", () => {
    expect(speak({ what: "no such plugin" })).not.toContain("\n")
  })

  // A message that already carries lines of its own keeps them under the
  // prefix, so a suggestion is part of the same message.
  it("indents a what that arrives on several lines", () => {
    expect(speak({ what: "unknown option '--webb'\n(Did you mean --web?)" })).toBe(
      ["eva: unknown option '--webb'", "     (Did you mean --web?)"].join("\n"),
    )
  })

  it("is the prefix every other writer here goes through", () => {
    const written = [
      say({ kind: "ignored", path: "/work/.eva" }),
      say({ kind: "untrusted", directory: "/work" }),
      say({ kind: "uncarried", id: "eva.nothing" }),
      say({ kind: "unread", key: "modle" }),
      sayMiss("theme", { id: "dusk", owner: "eva.themes" }),
      sayEvicted("credentialStore", "eva.auth", "eva.other"),
    ]
    for (const line of written) {
      expect(line.startsWith(PREFIX)).toBe(true)
      expect(line.endsWith("\n")).toBe(true)
    }
  })
})

// A stringified Error carries its class name, which is ours. A reader needs
// the sentence and can act on nothing else.
describe("what a thrown value says", () => {
  it("takes the message off an Error and leaves the class behind", () => {
    class NoSurfaceError extends Error {
      override readonly name = "NoSurfaceError"
    }
    expect(reasonOf(new NoSurfaceError("no surface is registered"))).toBe(
      "no surface is registered",
    )
  })

  it("says a thrown value that is not an Error as it reads", () => {
    expect(reasonOf("the wire closed")).toBe("the wire closed")
  })
})
