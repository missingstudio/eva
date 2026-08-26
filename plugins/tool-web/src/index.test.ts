import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { calling, withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { toolWeb } from "./index.js"

interface Served {
  readonly url: string
  readonly close: () => Promise<void>
}

/**
 * One server on an ephemeral loopback port. The reader the plugin registers
 * really speaks HTTP, so it is exercised over a real socket — and the socket
 * never leaves this machine, so `verify` needs no network.
 */
const serving = async (status: number, body: string): Promise<Served> => {
  const server: Server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "text/plain" })
    response.end(body)
  })
  await new Promise<void>((settle) => void server.listen(0, "127.0.0.1", () => settle()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((settle) => void server.close(() => settle())),
  }
}

const reading = (url: string) =>
  withPlugin(toolWeb, (kernel) => {
    const calls = calling(kernel)
    return Effect.map(calls.call("web", { url }), (result) => ({
      result,
      said: calls.said().map((payload) => payload.kind),
    }))
  })

describe("the web tool plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(toolWeb.id).toBe("eva.tool.web")
  })

  it("registers one row in the tool domain, under the name the model calls", async () => {
    const rows = await withPlugin(toolWeb, (kernel) => kernel.domains.tool.get)

    expect(rows.map((row) => [row.id, row.kind])).toEqual([["web", "fetch"]])
    expect(rows[0]?.execute).toBeTypeOf("function")
  })

  it("reads an address end to end, through the pipeline", async () => {
    const served = await serving(200, "over the wire")
    const ran = await reading(served.url)
    await served.close()

    expect(ran.result).toEqual({
      disposition: "ok",
      content: [{ type: "text", text: "over the wire" }],
    })
    expect(ran.said).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  // Nothing answered is a Disposition and not a throw, so the call is on the
  // record and the model reads why.
  it("reports an address nothing is listening on", async () => {
    const served = await serving(200, "gone")
    await served.close()
    const ran = await reading(served.url)

    expect(ran.result.disposition).toBe("failed")
    expect(ran.said).toEqual(["tool_call", "tool_update", "tool_result"])
  })

  it("takes its row with it when it unloads", async () => {
    const rows = await withPlugin(toolWeb, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.tool.web")
        return yield* kernel.domains.tool.get
      }),
    )

    expect(rows).toEqual([])
  })
})
