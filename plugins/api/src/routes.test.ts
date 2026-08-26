import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { memorySessionAPI, type MemorySession } from "@missingstudio/eva-client-runtime"
import { WATCH_REPLAY_BOUND, type ModelRef } from "@missingstudio/eva-core"
import { SCHEMA_VERSION } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { apiWire, routeFor, watchFor } from "./routes.js"
import { API_ROOT, CURSOR, modelPath, sessionPath, SESSIONS, watchPath } from "./wire.js"

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

/**
 * A socket is not a function call: the far side subscribes when the request
 * reaches it, and a payload said before then is one the live stream never
 * carried. So a test waits for the subscription it asked for, which is what
 * `open()` counts.
 */
const subscribed = async (memory: MemorySession, count = 1): Promise<void> => {
  while (memory.open() < count) await new Promise((settle) => setTimeout(settle, 1))
}

// And it lets go of it when the reader goes. A wait that never ends here is
// the hang this is written to catch.
const released = async (memory: MemorySession): Promise<void> => {
  while (memory.open() > 0) await new Promise((settle) => setTimeout(settle, 1))
}

/**
 * What the stream has said, once it has said this many frames. The head is
 * held back until the first one, so nothing here waits on a response before
 * there is something for it to carry.
 */
const heard = async (answering: Promise<Response>, frames: number): Promise<string> => {
  const response = await answering
  const body = response.body
  if (body === null) throw new Error("the stream answered no body")

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (text.split("\n\n").length <= frames) {
    const read = await reader.read()
    if (read.done) break
    text += decoder.decode(read.value, { stream: true })
  }
  await reader.cancel()
  return text
}

describe("the read half, over a socket", () => {
  it("lists the Sessions Eva holds, each with its Header", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "the first ask" }))
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${SESSIONS}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(await response.json()).toEqual([
      { id: memory.session, title: "the first ask", updatedAt: "2026-08-25T00:00:00.000Z" },
    ])

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
 * The one method that is one way. `watch` answers frames rather than a body,
 * so it is the one place the wire holds a socket open — and a Cursor rides
 * the request header SSE already has a name for.
 */
describe("the stream, over a socket", () => {
  it("says what a Run says, as an event stream", async () => {
    const memory = await held()
    const served = await standing(memory)

    const answering = fetch(`${served.origin}${watchPath(memory.session)}`)
    await subscribed(memory)
    await Effect.runPromise(memory.say({ kind: "started", intent: "one" }))

    const said = await heard(answering, 1)
    const response = await answering
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8")
    expect(said).toContain(
      `data: {"version":${SCHEMA_VERSION},"kind":"started","payload":{"intent":"one"}}`,
    )

    await served.close()
  })

  /**
   * The position is counted from the Cursor the reader asked with, because
   * that form of the contract guarantees the committed payloads after it, in
   * order, exactly once. So the nth frame really is at `from.seq + n`.
   */
  it("numbers each frame from the Cursor it was asked with", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "before" }))
    const served = await standing(memory)

    const answering = fetch(`${served.origin}${watchPath(memory.session)}`, {
      headers: { [CURSOR]: "1" },
    })
    await subscribed(memory)
    await Effect.runPromise(memory.say({ kind: "edit", path: "one.ts", hunks: 1 }))
    await Effect.runPromise(memory.say({ kind: "edit", path: "two.ts", hunks: 1 }))

    const said = await heard(answering, 2)
    expect(said).toContain("id: 2\n")
    expect(said).toContain("id: 3\n")
    expect(said).not.toContain("id: 1\n")

    await served.close()
  })

  /**
   * And it numbers nothing otherwise. A watch with no Cursor carries the live
   * stream, which is payloads the sink has not numbered — so a position here
   * would be invented, and a reader would resume from it and lose whatever
   * sat between the invention and the truth.
   */
  it("puts no position on a watch that carries no Cursor", async () => {
    const memory = await held()
    const served = await standing(memory)

    const answering = fetch(`${served.origin}${watchPath(memory.session)}`)
    await subscribed(memory)
    await Effect.runPromise(memory.say({ kind: "started", intent: "one" }))

    const said = await heard(answering, 1)
    expect(said).toContain("data: ")
    expect(said).not.toContain("id:")

    await served.close()
  })

  /**
   * Before the stream opens, and as a status. The refusal is decided against
   * the head with nothing said yet, so it is an answer to the request — a
   * frame inside a stream that had already said 200 could not take it back.
   */
  it("refuses a Cursor past the replay bound with a status, and no stream", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "one" }))
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${watchPath(memory.session)}`, {
      headers: { [CURSOR]: String(-WATCH_REPLAY_BOUND - 1) },
    })

    expect(response.status).toBe(409)
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(await response.json()).toEqual({
      from: { session: memory.session, seq: -WATCH_REPLAY_BOUND - 1 },
      head: 1,
    })

    await served.close()
  })

  /**
   * An open stream nobody ends is a `node:http` server that never closes. The
   * reader going is what stops it, so a close that has to wait for a stream
   * is a hang and this is the test that would hang.
   */
  it("lets the server close while a stream is open", async () => {
    const memory = await held()
    const served = await standing(memory)

    const stopping = new AbortController()
    const answering = fetch(`${served.origin}${watchPath(memory.session)}`, {
      signal: stopping.signal,
    })
    await subscribed(memory)

    await served.close()
    stopping.abort()
    await expect(answering).rejects.toThrow()

    await released(memory)
    expect(memory.open()).toBe(0)
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

  // The stream has a table of its own, because it answers frames and not a
  // body. So neither table carries what the other one does.
  it("leaves the stream to the table that can answer one", () => {
    expect(routeFor("GET", watchPath("ses_1"))).toBeUndefined()
    expect(watchFor("GET", watchPath("ses_1"), undefined)).toBeTypeOf("function")
    expect(watchFor("GET", watchPath("ses_1"), 3)).toBeTypeOf("function")
    expect(watchFor("GET", sessionPath("ses_1"), undefined)).toBeUndefined()
  })

  // The write half is stage 2's, against the permission gate that stage
  // builds anyway. Until then a method nothing carries is a miss.
  it("carries no method that writes", () => {
    expect(routeFor("POST", SESSIONS)).toBeUndefined()
    expect(routeFor("PUT", modelPath("ses_1"))).toBeUndefined()
    expect(watchFor("POST", watchPath("ses_1"), undefined)).toBeUndefined()
  })
})
