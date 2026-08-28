import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { memorySessionAPI, type MemorySession } from "@missingstudio/eva-client-runtime"
import { WATCH_REPLAY_BOUND, type ModelRef } from "@missingstudio/eva-core"
import { SCHEMA_VERSION } from "@missingstudio/eva-schema"
import {
  modelRows,
  type CatalogState,
  type CommandInfo,
  type ModelInfo,
} from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { apiWire, routeFor, watchFor, type WireOptions } from "./routes.js"
import {
  answerPath,
  API_ROOT,
  cancelPath,
  commandPath,
  CURSOR,
  IDEMPOTENCY,
  modelPath,
  MODELS,
  sessionPath,
  SESSIONS,
  watchPath,
} from "./wire.js"

const MODEL: ModelRef = { provider: "wire", model: "one" }

/**
 * A Catalog with models in it, the way a Provider's plugin fills one: one
 * model the build knows a context window for and one it knows a rate for, so
 * a row that says only what is held can be told from a row that guesses.
 */
const CATALOG: CatalogState = {
  providers: new Map(),
  models: new Map<string, Map<string, ModelInfo>>([
    [
      "openai",
      new Map([["gpt-5.6-terra", { id: "gpt-5.6-terra", name: "Terra", contextWindow: 400_000 }]]),
    ],
    [
      "anthropic",
      new Map([
        [
          "claude-opus-5",
          {
            id: "claude-opus-5",
            name: "Opus 5",
            price: { inputTicks: 30_000_000_000, outputTicks: 150_000_000_000 },
          },
        ],
      ]),
    ],
  ]),
}

const held = (): Promise<MemorySession> =>
  Effect.runPromise(memorySessionAPI(() => Effect.void, { model: MODEL }))

/**
 * One wire on a port of its own. A plugin's test may not import another
 * plugin, so the socket here is bare — and what falls past the wire is
 * `eva.web`'s to answer, said in one line so a test can tell that it fell.
 */
const standing = async (memory: MemorySession, serving: WireOptions = {}) => {
  const wire = apiWire(memory.api, serving)
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

  /**
   * The rows a picker draws, and the same ones `/model` picks from: they are
   * `modelRows` and not a second derivation of it, so a page and a terminal
   * against one runtime cannot offer different models. The order is the
   * Catalog's own — provider first, then the models under it — because a
   * listing that reordered itself between two doors is a listing a person
   * reads twice.
   */
  it("answers every model the Catalog knows, as the rows the panel picks from", async () => {
    const memory = await held()
    const served = await standing(memory, { catalog: Effect.succeed(CATALOG) })

    const response = await fetch(`${served.origin}${MODELS}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(modelRows(CATALOG))
    expect(modelRows(CATALOG).map((row) => row.id)).toEqual([
      "openai/gpt-5.6-terra",
      "anthropic/claude-opus-5",
    ])

    await served.close()
  })

  // A build that loaded no Provider knows no model. That is a listing of
  // none and never a miss: the read happened, and nothing is what it found.
  it("answers no rows for a build that knows no model, rather than a miss", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await fetch(`${served.origin}${MODELS}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])

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
  it("carries the listing, one Session's record, its model, and the Catalog's", () => {
    expect(routeFor("GET", SESSIONS)).toBeTypeOf("function")
    expect(routeFor("GET", sessionPath("ses_1"))).toBeTypeOf("function")
    expect(routeFor("GET", modelPath("ses_1"))).toBeTypeOf("function")
    expect(routeFor("GET", MODELS)).toBeTypeOf("function")
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

  // The other half, and the same rule: a method and a path this does not
  // carry is a miss, whatever body arrived with it.
  it("carries the six calls that write, and nothing else", () => {
    expect(routeFor("POST", SESSIONS, {})).toBeTypeOf("function")
    expect(routeFor("POST", sessionPath("ses_1"), { kind: "prompt", text: "ask" })).toBeTypeOf(
      "function",
    )
    expect(routeFor("POST", cancelPath("ses_1"), "user")).toBeTypeOf("function")
    expect(routeFor("POST", commandPath("ses_1"), { line: "/mode" })).toBeTypeOf("function")
    expect(routeFor("PUT", modelPath("ses_1"), MODEL)).toBeTypeOf("function")
    expect(routeFor("PUT", answerPath("call_1"), { kind: "cancelled" })).toBeTypeOf("function")

    expect(routeFor("POST", modelPath("ses_1"), MODEL)).toBeUndefined()
    expect(routeFor("PUT", sessionPath("ses_1"), {})).toBeUndefined()
    expect(routeFor("DELETE", sessionPath("ses_1"), undefined)).toBeUndefined()
    expect(watchFor("POST", watchPath("ses_1"), undefined)).toBeUndefined()
  })

  /**
   * The one body that may be absent. A body that is not JSON reaches this
   * table as nothing, exactly as no body at all does — so a `create` with
   * neither opens a Session where the serving process is, and only a
   * `location` that is there and is not a string is a shape it refuses.
   */
  it("opens a Session from a body it was never given, and refuses one it cannot read", async () => {
    const memory = await held()
    expect(routeFor("POST", SESSIONS, undefined, { directory: () => "/pinned" })).toBeTypeOf(
      "function",
    )

    const refusing = routeFor("POST", SESSIONS, { location: 7 })
    const answer = await Effect.runPromise(refusing?.(memory.api) ?? Effect.succeed(undefined))

    expect(answer).toEqual({ status: 400, body: { error: "the wire cannot read this body" } })
    expect(memory.calls).toEqual([])
  })

  /**
   * A model is picked and never typed. The Catalog holds the rows, and this
   * wire takes a `ModelRef` — so a name a person wrote by hand reaches it as
   * a row that was chosen or it does not reach it at all. Nothing is set on
   * the way past.
   */
  it.each([
    ["a bare name", "anthropic/claude-opus-5"],
    ["half a reference", { model: "claude-opus-5" }],
    ["a row a picker draws", { id: "anthropic/claude-opus-5", label: "anthropic/claude-opus-5" }],
  ])("refuses a model set as %s, and sets none", async (_said, body) => {
    const memory = await held()
    const refusing = routeFor("PUT", modelPath(memory.session), body)
    const answer = await Effect.runPromise(refusing?.(memory.api) ?? Effect.succeed(undefined))

    expect(answer).toEqual({ status: 400, body: { error: "the wire cannot read this body" } })
    expect(memory.calls).toEqual([])
  })

  /**
   * A body the wire cannot read is refused, and the route that refuses it
   * reaches no method. A shape half understood would be a partly applied
   * write, and nothing later would say there had been one.
   */
  it("refuses a body it cannot read, rather than writing part of it", async () => {
    const memory = await held()
    const refusing = routeFor("POST", sessionPath(memory.session), { kind: "prompt" })
    const answer = await Effect.runPromise(refusing?.(memory.api) ?? Effect.succeed(undefined))

    expect(answer).toEqual({ status: 400, body: { error: "the wire cannot read this body" } })
    expect(memory.calls).toEqual([])
  })
})

/**
 * The write half. Each call carries the contract's own shape as its body — a
 * `SubmitInput` *is* the Prompt and a `CancelCause` *is* the cause — so there
 * is nothing to unwrap on either side, and a write answers nothing back.
 */
describe("the write half, over a socket", () => {
  const wrote = (
    origin: string,
    method: string,
    path: string,
    body: unknown,
    key?: string,
  ): Promise<Response> =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(key === undefined ? {} : { [IDEMPOTENCY]: key }),
      },
      body: JSON.stringify(body),
    })

  /**
   * The one write that answers a value. A status alone would not say which
   * Session was opened, and a caller that has to list to find out would not
   * know its own from another door's.
   */
  it("opens a Session, and the listing then holds it", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await wrote(served.origin, "POST", SESSIONS, { location: "/there" })
    const made = await response.json()

    expect(response.status).toBe(200)
    expect(typeof made).toBe("string")
    expect(memory.calls).toEqual([{ method: "create", args: ["/there"] }])

    const listed = (await (await fetch(`${served.origin}${SESSIONS}`)).json()) as {
      readonly id: string
    }[]
    expect(listed.map((row) => row.id)).toContain(made)

    await served.close()
  })

  // A browser holds no honest path, so a caller that names none is answered
  // with the directory the serving process is in.
  it("opens the Session where the serving process is when nobody named a place", async () => {
    const memory = await held()
    const served = await standing(memory, { directory: () => "/pinned" })

    const response = await wrote(served.origin, "POST", SESSIONS, undefined)

    expect(response.status).toBe(200)
    expect(memory.calls).toEqual([{ method: "create", args: ["/pinned"] }])

    await served.close()
  })

  // The same key rule as every other write, and the reason `create` needs it:
  // a caller that asked again would otherwise hold one Session and leave
  // another open behind it.
  it("answers one id for a create asked twice under one key", async () => {
    const memory = await held()
    const served = await standing(memory)

    const first = await wrote(served.origin, "POST", SESSIONS, {}, "key_1")
    const again = await wrote(served.origin, "POST", SESSIONS, {}, "key_1")

    expect(await first.json()).toBe(await again.json())
    expect(memory.calls.filter((one) => one.method === "create")).toHaveLength(1)

    await served.close()
  })

  it("opens a Run from a Prompt, and answers nothing back", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await wrote(served.origin, "POST", sessionPath(memory.session), {
      kind: "prompt",
      text: "ask",
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
    expect(memory.calls).toEqual([
      { method: "submit", args: [memory.session, { kind: "prompt", text: "ask" }] },
    ])

    await served.close()
  })

  it("carries a steer with the target it named", async () => {
    const memory = await held()
    const served = await standing(memory)

    await wrote(served.origin, "POST", sessionPath(memory.session), {
      kind: "steer",
      text: "be brief",
      target: "next-step",
    })

    expect(memory.calls[0]?.args[1]).toEqual({
      kind: "steer",
      text: "be brief",
      target: "next-step",
    })

    await served.close()
  })

  it("stops a Run with the cause the caller named", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await wrote(served.origin, "POST", cancelPath(memory.session), "budget")

    expect(response.status).toBe(200)
    expect(memory.calls).toEqual([{ method: "cancel", args: [memory.session, "budget"] }])

    await served.close()
  })

  // Set over the wire and read back over the wire, which is the whole of what
  // "it takes effect" means from a page.
  it("sets the model, and the read half hands the new one back", async () => {
    const memory = await held()
    const served = await standing(memory)

    const next = { provider: "wire", model: "another" }
    expect((await wrote(served.origin, "PUT", modelPath(memory.session), next)).status).toBe(200)
    expect(await (await fetch(`${served.origin}${modelPath(memory.session)}`)).json()).toEqual(next)

    await served.close()
  })

  /**
   * A model is picked and never typed, and this is the half of that rule the
   * page cannot keep for itself: a picker offers the rows the Catalog holds,
   * and a caller that is not the picker has to be told no.
   *
   * It is this route's refusal and not the contract's. `/model provider/model`
   * at a terminal still runs an unlisted reference, because a Provider answers
   * anything in its namespace — that line reaches the Domains through the
   * command route, which this leaves alone.
   */
  it("refuses a model the Catalog does not hold, and leaves the Session at the one it had", async () => {
    const memory = await held()
    const served = await standing(memory, { catalog: Effect.succeed(CATALOG) })

    const refused = await wrote(served.origin, "PUT", modelPath(memory.session), {
      provider: "openai",
      model: "gpt-nothing",
    })

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      error: "the Catalog does not hold openai/gpt-nothing",
    })
    expect(memory.calls).not.toContainEqual(
      expect.objectContaining({ method: "model.set" as const }),
    )

    const held_ = { provider: "anthropic", model: "claude-opus-5" }
    expect((await wrote(served.origin, "PUT", modelPath(memory.session), held_)).status).toBe(200)
    expect(await (await fetch(`${served.origin}${modelPath(memory.session)}`)).json()).toEqual(
      held_,
    )

    await served.close()
  })

  /**
   * And a build that loaded no Provider refuses none of them. It knows of no
   * model at all, so it can call none of them wrong — the reading the read
   * half already takes, where a listing of none is the truth and never a miss.
   */
  it("refuses no model when the Catalog knows none", async () => {
    const memory = await held()
    const served = await standing(memory)

    const next = { provider: "wire", model: "unlisted" }
    expect((await wrote(served.origin, "PUT", modelPath(memory.session), next)).status).toBe(200)
    expect(await (await fetch(`${served.origin}${modelPath(memory.session)}`)).json()).toEqual(next)

    await served.close()
  })

  // Keyed by the tool call's id and not by a Session, so it is the one write
  // that sits outside the listing.
  it("answers a request by naming it, and not a Session", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await wrote(served.origin, "PUT", answerPath("call_1"), {
      kind: "permission",
      optionId: "allow_once",
    })

    expect(response.status).toBe(200)
    expect(memory.calls).toEqual([
      { method: "answer", args: ["call_1", { kind: "permission", optionId: "allow_once" }] },
    ])

    await served.close()
  })

  it("refuses a body it cannot read with a status, and writes nothing", async () => {
    const memory = await held()
    const served = await standing(memory)

    const response = await wrote(served.origin, "POST", cancelPath(memory.session), "whenever")

    expect(response.status).toBe(400)
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(memory.calls).toEqual([])

    await served.close()
  })

  /**
   * The one thing a write needs that a read does not. A write has no error
   * channel, so a caller that could not reach this side waits and asks again —
   * and a `submit` asked again would open a second Run. The key is what makes
   * asking again safe: the write is answered twice and done once.
   */
  it("answers the same key twice and opens one Run", async () => {
    const memory = await held()
    const served = await standing(memory)

    const prompt = { kind: "prompt", text: "ask" }
    const first = await wrote(served.origin, "POST", sessionPath(memory.session), prompt, "key_1")
    const again = await wrote(served.origin, "POST", sessionPath(memory.session), prompt, "key_1")

    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(memory.calls.filter((one) => one.method === "submit")).toHaveLength(1)

    await served.close()
  })

  it("opens a second Run for a second key", async () => {
    const memory = await held()
    const served = await standing(memory)

    const prompt = { kind: "prompt", text: "ask" }
    await wrote(served.origin, "POST", sessionPath(memory.session), prompt, "key_1")
    await wrote(served.origin, "POST", sessionPath(memory.session), prompt, "key_2")

    expect(memory.calls.filter((one) => one.method === "submit")).toHaveLength(2)

    await served.close()
  })
})

/**
 * A command is not a `SessionAPI` method, and it crosses this wire for the
 * reason the methods do: the rows it resolves through are the serving
 * process's, and so is everything they touch. A door that ran `/mode` for
 * itself would change the approval state of its own process and leave the Run
 * under the mode it already had.
 */
describe("a command, over a socket", () => {
  // What the plugins that own these commands hold. A plugin's test may not
  // import another plugin, so the behaviour `eva.approval` and `eva.tool-edit`
  // register is written here — a mode kept for the process, and a write that
  // can be reversed.
  interface Serving {
    mode: string
    readonly writes: string[]
  }

  const MODES = ["default", "read-only"]

  const rowsOf = (serving: Serving): readonly CommandInfo[] => [
    {
      id: "mode",
      description: "names the permission mode this Session runs under",
      argumentHint: "mode",
      run: (command) =>
        Effect.sync(() => {
          const named = command.argument
          if (named === undefined) {
            command.write(`mode: ${serving.mode}`)
            for (const one of MODES) command.write(`  ${one}`)
            return
          }
          if (!MODES.includes(named)) {
            command.write(`no mode is named ${named}: ${MODES.join(", ")}`)
            return
          }
          serving.mode = named
          command.write(`mode: ${named}`)
        }),
    },
    {
      id: "undo",
      description: "reverses the last write",
      run: (command) =>
        Effect.sync(() => {
          const last = serving.writes.pop()
          command.write(last === undefined ? "nothing to undo" : `undone: ${last}`)
        }),
    },
    {
      // The shape every command that offers a choice has: a panel where the
      // surface draws one, and the same answer in words where it does not.
      id: "model",
      description: "Show or set the session model",
      run: Effect.fn("wire.test.model")(function* (command) {
        const rows = [
          { id: "wire/one", label: "wire/one" },
          { id: "wire/another", label: "wire/another" },
        ]
        if (command.pick === undefined) {
          const current = yield* command.api.model.get(command.session)
          command.write(
            `${current.provider}/${current.model}\n${rows.map((row) => `  ${row.label}`).join("\n")}\n`,
          )
          return
        }
        // Nothing on this door reaches here, and a door that did would wait
        // on the person rather than on the wire.
        yield* command.pick("model", rows)
      }),
    },
    {
      id: "clear",
      description: "Open a new Session",
      run: Effect.fn("wire.test.clear")(function* (command) {
        command.select(yield* command.api.create("/there"))
      }),
    },
  ]

  const ran = (origin: string, session: string, line: unknown): Promise<Response> =>
    fetch(`${origin}${commandPath(session)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ line }),
    })

  const serving = async (mode = "default", writes: string[] = []) => {
    const state: Serving = { mode, writes }
    const memory = await held()
    const served = await standing(memory, { commands: Effect.succeed(rowsOf(state)) })
    return { state, memory, served }
  }

  /**
   * The clause the route exists for. The mode is the serving process's, so a
   * line sent from another door is answered by changing this one — and the
   * next read of it, from anywhere, sees what the line said.
   */
  it("runs the line where the rows are, so the mode a page names is the serving process's", async () => {
    const { state, served } = await serving()

    const response = await ran(served.origin, "ses_1", "/mode read-only")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ wrote: "mode: read-only" })
    expect(state.mode).toBe("read-only")

    // And it stayed changed, which is what "the same runtime" means.
    expect(await (await ran(served.origin, "ses_1", "/mode")).json()).toEqual({
      wrote: "mode: read-only\n  default\n  read-only",
    })

    await served.close()
  })

  it("reverses a write the serving process made", async () => {
    const { state, served } = await serving("default", ["notes.md", "wire.ts"])

    expect(await (await ran(served.origin, "ses_1", "/undo")).json()).toEqual({
      wrote: "undone: wire.ts",
    })
    expect(state.writes).toEqual(["notes.md"])

    await served.close()
  })

  /**
   * `dispatch` has no error channel, so a line no row answers is answered in
   * words. A wire that faulted on a misspelling would make a typing mistake
   * read as a runtime that had gone.
   */
  it("answers a command it does not know in words, and never with a fault", async () => {
    const { state, served } = await serving()

    const missed = await ran(served.origin, "ses_1", "/mdoe read-only")
    expect(missed.status).toBe(200)
    expect(await missed.json()).toEqual({
      wrote: "no such command: /mdoe, did you mean /mode?",
    })

    const nothing = await ran(served.origin, "ses_1", "/nonesuch")
    expect(nothing.status).toBe(200)
    expect(await nothing.json()).toEqual({ wrote: "no such command: /nonesuch" })

    // Nothing ran, so nothing changed.
    expect(state.mode).toBe("default")

    await served.close()
  })

  // A line that names no command is a Prompt, and a Prompt is submitted
  // rather than run. So this route says so instead of opening a Run of its own.
  it("answers a line that names no command, and opens nothing", async () => {
    const { memory, served } = await serving()

    expect(await (await ran(served.origin, "ses_1", "read the trace")).json()).toEqual({
      wrote: "not a command: a line that names none is a Prompt",
    })
    expect(memory.calls).toEqual([])

    await served.close()
  })

  /**
   * `pick` is a capability rather than an obligation, and this door supplies
   * none. So a command that would have asked says its answer in words — which
   * is the contract's own degradation, and needs no work per command.
   */
  it("lists what it would have asked, because this door draws no panel", async () => {
    const { served } = await serving()

    const response = await ran(served.origin, "ses_1", "/model")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      wrote: "wire/one\n  wire/one\n  wire/another\n",
    })

    await served.close()
  })

  // A command that opens a Session says which. A door told only that the line
  // ran would be looking at the Session the person just left.
  it("says which Session a command opened", async () => {
    const { memory, served } = await serving()

    const answered = (await (await ran(served.origin, "ses_1", "/clear")).json()) as {
      readonly wrote: string
      readonly selected?: string
    }

    expect(answered.wrote).toBe("")
    expect(memory.calls).toEqual([{ method: "create", args: ["/there"] }])
    expect(answered.selected).toBe(memory.opened()[0])

    await served.close()
  })

  it("refuses a body that names no line, and runs nothing", async () => {
    const { state, served } = await serving()

    const response = await ran(served.origin, "ses_1", 7)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "the wire cannot read this body" })
    expect(state.mode).toBe("default")

    await served.close()
  })

  // A build that carries no command row still answers. There is nothing for a
  // line to resolve through, which is a thing to say and not a fault.
  it("answers a line against a build that registered no command", async () => {
    const memory = await held()
    const served = await standing(memory)

    expect(await (await ran(served.origin, "ses_1", "/mode")).json()).toEqual({
      wrote: "no such command: /mode",
    })

    await served.close()
  })
})
