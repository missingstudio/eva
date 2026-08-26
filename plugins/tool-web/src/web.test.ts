import type { ToolResult } from "@missingstudio/eva-core"
import { CALLING_CONTEXT } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { WebError, webTool, type Reading } from "./web.js"

const said = (result: ToolResult): string => {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

const running = (get: Reading, input: unknown) => {
  const execute = webTool({ get }).execute
  if (execute === undefined) throw new Error("the web row carries no implementation")
  return Effect.runPromise(execute(input, CALLING_CONTEXT))
}

const answering =
  (status: number, body: string): Reading =>
  () =>
    Effect.succeed({ status, body })

const unreachable: Reading = () => Effect.fail(new WebError({ message: "nothing answered" }))

describe("the web tool", () => {
  it("answers what the address held", async () => {
    const result = await running(answering(200, "<h1>hello</h1>"), { url: "https://eva.test/one" })

    expect(result.disposition).toBe("ok")
    expect(said(result)).toBe("<h1>hello</h1>")
  })

  // The model recovers from the number, not from a body a server wrote for a
  // browser.
  it("reports a status outside 2xx, with the status", async () => {
    const result = await running(answering(404, "Not found"), { url: "https://eva.test/gone" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toBe("https://eva.test/gone answered 404")
  })

  it("reports an address nothing answered", async () => {
    const result = await running(unreachable, { url: "https://eva.test/one" })

    expect(result.disposition).toBe("failed")
    expect(said(result)).toBe("nothing answered")
  })

  /**
   * This is the one tool that leaves the machine, so the schemes it reads are
   * the two it declares. `file:` and `data:` reach past the workspace, and
   * the `FileSystem` slot is the only way to a file.
   */
  it("refuses anything that is not an http or https address", async () => {
    for (const input of [
      undefined,
      {},
      { url: 5 },
      { url: "one.md" },
      { url: "file:///etc/hosts" },
      { url: "data:text/plain,hello" },
    ]) {
      const result = await running(answering(200, "reached"), input)
      expect(result.disposition).toBe("failed")
      expect(said(result)).toBe("web wants an http or https `url`")
    }
  })
})
