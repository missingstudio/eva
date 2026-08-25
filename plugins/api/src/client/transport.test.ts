import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
  memorySessionAPI,
  type MemorySession,
  type TransportHealth,
} from "@missingstudio/eva-client-runtime"
import type { ModelRef } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import { Effect, Exit, Fiber, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import { apiWire } from "../routes.js"
import { modelPath, sessionPath, SESSIONS } from "../wire.js"
import { httpTransport, type Request } from "./transport.js"

const MODEL: ModelRef = { provider: "wire", model: "one" }

const held = (): Promise<MemorySession> =>
  Effect.runPromise(memorySessionAPI(() => Effect.void, { model: MODEL }))

// The wire on a port, and nothing else on it. Only the wire's own paths are
// asked for here, so what would fall past it never comes up.
const standing = async (memory: MemorySession) => {
  const wire = apiWire(memory.api)
  const server = createServer((request, response) => void wire(request, response))

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

// Every value `health` took while the body ran. `changes` replays the value
// the ref holds, so the first entry is where it started.
const watching = <A>(
  health: SubscriptionRef.SubscriptionRef<TransportHealth>,
  body: Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const seen: TransportHealth[] = []
    const heard = yield* Effect.forkChild(
      Stream.runForEach(SubscriptionRef.changes(health), (one) =>
        Effect.sync(() => seen.push(one)),
      ),
    )
    const found = yield* body
    yield* Fiber.interrupt(heard)
    return { found, seen }
  })

/**
 * The seam's second filler, against the routes it reads. What the runtime
 * gets back is the contract's own shapes, so nothing above it learns that
 * this answer crossed a socket.
 */
describe("the wire, read as a Transport", () => {
  it("lists the Sessions, each with its Header", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "the first ask" }))
    const served = await standing(memory)

    const rows = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin }), (transport) => transport.api.list),
    )

    expect(rows).toEqual([{ id: memory.session, title: "the first ask" }])
    await served.close()
  })

  it("answers the model a Session is kept at", async () => {
    const memory = await held()
    const served = await standing(memory)

    const found = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin }), (transport) =>
        transport.api.model.get(memory.session),
      ),
    )

    expect(found).toEqual(MODEL)
    await served.close()
  })

  /**
   * The fold happens on this side, from the record the wire sent. So the
   * Cursor is not read off the wire either: this fold ends where the far
   * side's ended, because both read the same events.
   */
  it("folds a Session from the record, and ends where the record ends", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "change it" }))
    await Effect.runPromise(memory.say({ kind: "edit", path: "one.ts", hunks: 2 }))
    const served = await standing(memory)

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ origin: served.origin })
        const record = yield* Effect.scoped(transport.api.attach(memory.session))
        return { at: record.at, messages: record.messages(), cost: record.cost() }
      }),
    )

    expect(found.at).toEqual({ session: memory.session, seq: 2 })
    expect(found.messages).toEqual([
      {
        author: "human",
        blocks: [{ type: "content", block: 0, content: { type: "text", text: "change it" } }],
      },
      { author: "agent", blocks: [{ type: "edit", path: "one.ts", hunks: 2 }] },
    ])
    // Nothing on this side holds a Catalog, so nothing here prices anything.
    expect(found.cost.estimatedCostTicks).toBeNull()

    await served.close()
  })

  it("is ready before anything has been asked", async () => {
    const transport = await Effect.runPromise(httpTransport({ origin: "http://eva.invalid" }))
    expect(await Effect.runPromise(SubscriptionRef.get(transport.health))).toBe("ready")
  })
})

/**
 * The rule `droppableTransport`'s own header states, kept by the filler that
 * really has a pipe: a drop says what it has to say through `health`, and a
 * call made while the pipe is down is slower, never differently typed.
 */
describe("a pipe that is down", () => {
  // The counter is what says it asked again. A timing assertion would say the
  // same thing and say it differently on a loaded machine.
  const flaky = (
    times: number,
    answer: () => Response,
  ): { request: Request; asked: () => number } => {
    let asked = 0
    return {
      request: (() => {
        asked += 1
        return asked <= times
          ? Promise.reject(new Error("connect ECONNREFUSED"))
          : Promise.resolve(answer())
      }) as Request,
      asked: () => asked,
    }
  }

  const json = (body: unknown) => () =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json; charset=utf-8" },
    })

  it("waits and asks again, and the answer is the one the wire carries", async () => {
    const pipe = flaky(2, json([{ id: "ses_1", title: "held" }]))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ gap: 1, request: pipe.request })
        return yield* watching(transport.health, transport.api.list)
      }),
    )

    expect(found.found).toEqual([{ id: "ses_1", title: "held" }])
    expect(pipe.asked()).toBe(3)
  })

  it("says so through health while it is down, and says it is back", async () => {
    const pipe = flaky(1, json([]))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ gap: 1, request: pipe.request })
        return yield* watching(transport.health, transport.api.list)
      }),
    )

    expect(found.seen).toContain("disconnected")
    expect(found.seen.at(-1)).toBe("ready")
  })

  /**
   * A build that carries no `eva.api` serves the page and answers no call, so
   * the page's own server answers the call with the page. HTML is not this
   * wire answering, which is the same fact as a pipe that is down.
   */
  it("reads the page's own answer as a pipe that is not answering", async () => {
    let asked = 0
    const request = (() => {
      asked += 1
      return Promise.resolve(
        asked === 1
          ? new Response("<!doctype html><div id=page></div>", {
              headers: { "content-type": "text/html; charset=utf-8" },
            })
          : new Response("[]", { headers: { "content-type": "application/json" } }),
      )
    }) as Request

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ gap: 1, request })
        return yield* watching(transport.health, transport.api.list)
      }),
    )

    expect(found.seen).toContain("disconnected")
    expect(found.found).toEqual([])
  })
})

/**
 * `SessionAPI` is one interface and a filler answers all of it. A method the
 * read half has not reached is a defect where it is called, so a caller that
 * reached for one hears about it instead of waiting on a stream that never
 * opens.
 */
describe("what the wire does not carry yet", () => {
  const transport = httpTransport({ origin: "http://eva.invalid" })

  it("makes a write a defect rather than a wait", async () => {
    const failed = await Effect.runPromise(
      Effect.flatMap(transport, (one) =>
        Effect.exit(one.api.submit(sessionID("ses_1"), { kind: "prompt", text: "ask" })),
      ),
    )

    expect(Exit.isFailure(failed)).toBe(true)
    expect(String(failed)).toContain("NotOnTheWire")
  })

  // 006 takes `watch`, with the page code that follows a Session live.
  it("says the same of the read method no caller has arrived for", async () => {
    const found = await Effect.runPromise(
      Effect.flatMap(transport, (one) =>
        Effect.exit(Stream.runDrain(one.api.watch(sessionID("ses_1")))),
      ),
    )

    expect(String(found)).toContain("NotOnTheWire")
  })
})

describe("the paths the two halves agree on", () => {
  it("names one Session under the listing it came from, and its model under it", () => {
    expect(sessionPath("ses_1")).toBe(`${SESSIONS}/ses_1`)
    expect(modelPath("ses_1")).toBe(`${SESSIONS}/ses_1/model`)
  })

  // A page asks the host that served it, so nothing here is absolute.
  it("is rooted, so no address is built into the page", () => {
    expect(SESSIONS.startsWith("/")).toBe(true)
    expect(modelPath("ses_1")).not.toContain("://")
  })
})
