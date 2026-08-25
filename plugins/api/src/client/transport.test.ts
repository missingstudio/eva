import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
  memorySessionAPI,
  type MemorySession,
  type TransportHealth,
} from "@missingstudio/eva-client-runtime"
import {
  ResumeTooFarBehind,
  WATCH_REPLAY_BOUND,
  type ModelRef,
  type SessionAPI,
} from "@missingstudio/eva-core"
import {
  encodePayloadLine,
  SCHEMA_VERSION,
  sessionID,
  type Cursor,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Exit, Fiber, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import { apiWire } from "../routes.js"
import { CURSOR, frameOut, modelPath, sessionPath, SESSIONS } from "../wire.js"
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

/**
 * A socket is not a function call: the far side subscribes when the request
 * reaches it, so a payload said before then is one the live stream never
 * carried. `open()` counts the subscriptions that really opened.
 */
const subscribed = async (memory: MemorySession, count = 1): Promise<void> => {
  while (memory.open() < count) await new Promise((settle) => setTimeout(settle, 1))
}

// A stream answered from a string, so a frame this wire would never write can
// still be put on it.
const streaming = (text: string) =>
  new Response(text, { headers: { "content-type": "text/event-stream; charset=utf-8" } })

/**
 * One watch, driven from outside Effect. A suite has to say a payload between
 * opening a stream and reading it, and the socket needs a turn of the loop to
 * carry either — so the stream is forked and read as it fills.
 */
const opened = (api: SessionAPI, session: SessionID, from?: Cursor) => {
  const heard: Payload[] = []
  const watching = Effect.runFork(
    Stream.runForEach(from === undefined ? api.watch(session) : api.watch(session, from), (one) =>
      Effect.sync(() => void heard.push(one)),
    ),
  )

  return {
    until: async (count: number): Promise<readonly Payload[]> => {
      while (heard.length < count) await new Promise((settle) => setTimeout(settle, 1))
      return [...heard]
    },
    stop: () => Effect.runPromise(Fiber.interrupt(watching)),
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
 * The two calls that carry a page. `attach` says where the record ends and
 * `watch` from that position says what came after it, exactly once — so a
 * surface that folded and then subscribed has neither a gap nor a repeat.
 */
describe("the stream, read as a Transport", () => {
  it("follows a Session live, from a watch that carries no Cursor", async () => {
    const memory = await held()
    const served = await standing(memory)
    const transport = await Effect.runPromise(httpTransport({ origin: served.origin }))

    const watching = opened(transport.api, memory.session)
    await subscribed(memory)
    await Effect.runPromise(memory.say({ kind: "started", intent: "one" }))
    await Effect.runPromise(memory.say({ kind: "edit", path: "one.ts", hunks: 2 }))

    expect(await watching.until(2)).toEqual([
      { kind: "started", intent: "one" },
      { kind: "edit", path: "one.ts", hunks: 2 },
    ])

    await watching.stop()
    await served.close()
  })

  /**
   * The criterion, and the race it is about. A payload that commits between
   * the fold and the subscription is the one a page would lose, and the one it
   * would show twice if the position were read the other way — so it is
   * committed there on purpose.
   */
  it("misses nothing between the two calls, and says nothing folded twice", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "folded" }))
    const served = await standing(memory)
    const transport = await Effect.runPromise(httpTransport({ origin: served.origin }))

    const record = await Effect.runPromise(Effect.scoped(transport.api.attach(memory.session)))
    // Committed after the fold read the record and before anything subscribed.
    await Effect.runPromise(memory.say({ kind: "edit", path: "between.ts", hunks: 1 }))

    const watching = opened(transport.api, memory.session, record.at)
    await subscribed(memory)
    await Effect.runPromise(memory.say({ kind: "edit", path: "after.ts", hunks: 1 }))

    const heard = await watching.until(2)
    expect(heard).toEqual([
      { kind: "edit", path: "between.ts", hunks: 1 },
      { kind: "edit", path: "after.ts", hunks: 1 },
    ])
    // What the fold already returned is never handed back by the watch.
    expect(heard.some((one) => one.kind === "started")).toBe(false)

    await watching.stop()
    await served.close()
  })

  /**
   * In the same shape the local filler fails with. A generic HTTP fault would
   * not be one: a caller catches the tag, and 007 answers it by folding fresh.
   */
  it("hands back a refused Cursor as the tagged error it is", async () => {
    const memory = await held()
    await Effect.runPromise(memory.say({ kind: "started", intent: "one" }))
    const served = await standing(memory)

    const failed = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin }), (transport) =>
        Effect.exit(
          Stream.runDrain(
            transport.api.watch(memory.session, {
              session: memory.session,
              seq: -WATCH_REPLAY_BOUND - 1,
            }),
          ),
        ),
      ),
    )

    expect(Exit.isFailure(failed)).toBe(true)
    expect(String(failed)).toContain(ResumeTooFarBehind.name)

    await served.close()
  })

  // A watch with no Cursor is not behind anything, so the refusal it cannot
  // meet is not on the wire for it either.
  it("asks for no position when it carries no Cursor", async () => {
    const asked: (string | undefined)[] = []
    const request = ((_url: string, init?: RequestInit) => {
      asked.push(new Headers(init?.headers).get(CURSOR) ?? undefined)
      return Promise.resolve(streaming(""))
    }) as Request

    const transport = await Effect.runPromise(httpTransport({ request }))
    const watching = opened(transport.api, sessionID("ses_1"))
    while (asked.length === 0) await new Promise((settle) => setTimeout(settle, 1))
    await watching.stop()

    expect(asked).toEqual([undefined])
  })
})

/**
 * The degradation rule, on the stream. A Surface may know less than the one
 * that wrote the record; it may never pretend the record said less. So a kind
 * this side does not know arrives as the kind it was, and what follows it
 * still arrives.
 */
describe("a payload kind this side does not know", () => {
  it("arrives as unknown, and the stream carries on", async () => {
    const request = (() =>
      Promise.resolve(
        streaming(
          `${frameOut({ data: JSON.stringify({ version: SCHEMA_VERSION, kind: "acp/party_mode", payload: { confetti: true } }) })}${frameOut({ data: encodePayloadLine({ kind: "started", intent: "after" }) })}`,
        ),
      )) as Request

    const transport = await Effect.runPromise(httpTransport({ request }))
    const watching = opened(transport.api, sessionID("ses_1"))

    expect(await watching.until(2)).toEqual([
      { kind: "unknown", originalKind: "acp/party_mode", raw: { confetti: true } },
      { kind: "started", intent: "after" },
    ])

    await watching.stop()
  })

  /**
   * A shape it cannot read at all is another matter. That is the far side
   * saying something this side cannot read, which is the same fact as a pipe
   * that dropped — so it is said through `health` and the watch ends.
   */
  it("ends the watch on a frame that is not a payload, and says the pipe is down", async () => {
    const request = (() =>
      Promise.resolve(streaming(frameOut({ data: "{not a payload" })))) as Request

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ request })
        const heard = yield* Stream.runCollect(transport.api.watch(sessionID("ses_1")))
        return { heard, health: yield* SubscriptionRef.get(transport.health) }
      }),
    )

    expect(found.heard).toEqual([])
    expect(found.health).toBe("disconnected")
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

  // The read half is whole: `list`, `attach`, `watch` and `model.get` are
  // what W1 carries, and every one of them is on the wire.
  it("carries every read the page makes", async () => {
    const found = await Effect.runPromise(
      Effect.flatMap(transport, (one) =>
        Effect.exit(Stream.runCollect(one.api.watch(sessionID("ses_1")))),
      ),
    )

    expect(String(found)).not.toContain("NotOnTheWire")
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
