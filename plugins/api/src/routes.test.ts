import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { memorySessionAPI, type MemorySession } from "@missingstudio/eva-client-runtime"
import type { ModelRef } from "@missingstudio/eva-core"
import { SCHEMA_VERSION } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { apiWire, routeFor } from "./routes.js"
import { API_ROOT, modelPath, sessionPath, SESSIONS } from "./wire.js"

const MODEL: ModelRef = { provider: "wire", model: "one" }

const held = (): Promise<MemorySession> =>
  Effect.runPromise(memorySessionAPI(() => Effect.void, { model: MODEL }))

/**
 * One wire on a port of its own. A plugin's test may not import another
 * plugin, so the socket here is bare — and what falls past the wire is
 * `eva.web`'s to answer, said in one line so a test can tell that it fell.
 */
const standing = async (memory: MemorySession) => {
  const wire = apiWire(memory.api)
  const server = createServer((request, response) => {
    if (wire(request, response)) return
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    response.end("past the wire\n")
  })

  await new Promise<void>((settle) => void server.listen(0, "127.0.0.1", () => settle()))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((settle) => {
        server.closeAllConnections()
        server.close(() => settle())
      }),
  }
}

describe("the read half, over a socket", () => {
  it("lists the Sessions Eva holds, each with its Header", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "the first ask" }))
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${SESSIONS}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(await response.json()).toEqual([{ id: memory.session, title: "the first ask" }])

    await served.close()
  })

  /**
   * The record, and not a fold of it. A page that was sent messages would
   * have to believe them; a page that is sent the Trace folds it and can be
   * held against the same events by anyone reading the wire.
   */
  it("answers one Session with the record, as the events the Trace holds", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "edit", path: "one.ts", hunks: 2 }))
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${sessionPath(memory.session)}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        id: expect.any(String),
        seq: 1,
        at: { wall: expect.any(String) },
        version: SCHEMA_VERSION,
        kind: "edit",
        run: expect.any(String),
        session: memory.session,
        parent: null,
        payload: { path: "one.ts", hunks: 2 },
      },
    ])

    await served.close()
  })

  it("answers a Session nobody opened with an empty record, rather than a miss", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${sessionPath("sess_nobody_opened")}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])

    await served.close()
  })

  it("answers the model one Session is kept at", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${modelPath(memory.session)}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(MODEL)

    await served.close()
  })

  // A listing held from before the last Run is a listing that is wrong.
  it("lets nothing cache what it answers", async () => {
    const memory = await held()
    const served = await standing(memory)

    expect((await fetch(`${served.origin}${SESSIONS}`)).headers.get("cache-control")).toBe(
      "no-store",
    )
    await served.close()
  })

  /**
   * The page's own server answers an unknown path with the page, so a call
   * that fell through would come back as HTML — and a broken parse is a much
   * worse report than a miss.
   */
  it("refuses a path under the root it does not carry, rather than letting it fall", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${API_ROOT}/nothing`)
    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")

    await served.close()
  })

  it("leaves a path outside the root to whatever serves the page", async () => {
    const memory = await held()
    const served = await standing(memory)

    expect(await (await fetch(`${served.origin}/sessions/019a`)).text()).toBe("past the wire\n")
    await served.close()
  })

  // A request a browser can send may never end a server.
  it("survives a path that is not valid percent-encoding", async () => {
    const memory = await held()
    const served = await standing(memory)

    expect((await fetch(`${served.origin}${SESSIONS}/%/model`)).status).toBe(404)
    expect((await fetch(`${served.origin}${SESSIONS}`)).status).toBe(200)

    await served.close()
  })
})

/**
 * A route is a description, so the table is a pure function: what the wire
 * carries is read here and the socket is only what carries it.
 */
describe("the route table", () => {
  it("carries the listing, one Session's record, and its model, and nothing else", () => {
    expect(routeFor("GET", SESSIONS)).toBeTypeOf("function")
    expect(routeFor("GET", sessionPath("ses_1"))).toBeTypeOf("function")
    expect(routeFor("GET", modelPath("ses_1"))).toBeTypeOf("function")
    expect(routeFor("GET", `${SESSIONS}/ses_1/events`)).toBeUndefined()
  })

  // The write half is stage 2's, against the permission gate that stage
  // builds anyway. Until then a method nothing carries is a miss.
  it("carries no method that writes", () => {
    expect(routeFor("POST", SESSIONS)).toBeUndefined()
    expect(routeFor("PUT", modelPath("ses_1"))).toBeUndefined()
  })
})
