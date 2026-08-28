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
  type CancelCause,
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
import { modelRows, type CatalogState, type CommandInfo } from "@missingstudio/eva-sdk"
import { Effect, Exit, Fiber, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import { apiWire } from "../routes.js"
import { commandPath, CURSOR, frameOut, modelPath, MODELS, sessionPath, SESSIONS } from "../wire.js"
import { httpTransport, readModels, type Request } from "./transport.js"

const MODEL: ModelRef = { provider: "wire", model: "one" }

const held = (): Promise<MemorySession> =>
  Effect.runPromise(memorySessionAPI(() => Effect.void, { model: MODEL }))

// A Catalog with a model in it, so the read half of one has a row to answer.
// The Catalog holds neither a context window nor a rate for it, so the row
// says its name and leaves the rest unsaid.
const CATALOG: CatalogState = {
  providers: new Map(),
  models: new Map([
    ["anthropic", new Map([["claude-opus-5", { id: "claude-opus-5", name: "Opus 5" }]])],
  ]),
}

// The wire on a port, and nothing else on it. Only the wire's own paths are
// asked for here, so what would fall past it never comes up.
const standing = async (
  memory: MemorySession,
  directory?: () => string,
  commands?: Effect.Effect<readonly CommandInfo[]>,
  catalog?: CatalogState,
) => {
  const wire = apiWire(
    memory.api,
    directory,
    commands,
    catalog === undefined ? undefined : Effect.succeed(catalog),
  )
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

    expect(rows).toEqual([
      { id: memory.session, title: "the first ask", updatedAt: "2026-08-25T00:00:00.000Z" },
    ])
    await served.close()
  })

  // The one call that writes and answers a value. What comes back is the
  // Session itself, so the listing after it holds the id the caller holds.
  it("opens a Session, and the listing after it holds the one it handed back", async () => {
    const memory = await held()
    const served = await standing(memory)

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ origin: served.origin })
        const made = yield* transport.api.create("/there")
        return { made, listed: (yield* transport.api.list).map((row) => row.id) }
      }),
    )

    expect(found.listed).toContain(found.made)
    expect(memory.calls).toContainEqual({ method: "create", args: ["/there"] })

    await served.close()
  })

  // A browser holds no honest path, so the page names none and the serving
  // process answers in the directory it is in.
  it("opens a Session where the process is when the caller names no directory", async () => {
    const memory = await held()
    const served = await standing(memory, () => "/pinned")

    const made = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin }), (transport) =>
        transport.api.create(),
      ),
    )

    expect(made).toBeTypeOf("string")
    expect(memory.calls).toContainEqual({ method: "create", args: ["/pinned"] })

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

  // A write keeps the same rule as a read: it waits and asks again, and
  // nothing about its type says the pipe was down.
  it("waits and asks again for a write, then lands it", async () => {
    const memory = await held()
    const served = await standing(memory)

    let asked = 0
    const request = ((...given: Parameters<Request>) => {
      asked += 1
      return asked <= 2 ? Promise.reject(new Error("connect ECONNREFUSED")) : fetch(...given)
    }) as Request

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* httpTransport({ origin: served.origin, gap: 1, request })
        return yield* watching(
          transport.health,
          transport.api.model.set(memory.session, { provider: "wire", model: "later" }),
        )
      }),
    )

    expect(found.seen).toContain("disconnected")
    expect(found.seen.at(-1)).toBe("ready")
    expect(memory.calls).toEqual([
      { method: "model.set", args: [memory.session, { provider: "wire", model: "later" }] },
    ])

    await served.close()
  })

  /**
   * The case the idempotency key is for, end to end. The request lands and the
   * answer is lost, which no caller can tell from a request that never left —
   * so the write is asked again, and the far side answers it from the write it
   * already made rather than opening a second Run.
   */
  it("opens one Run when a write lands and its answer is lost", async () => {
    const memory = await held()
    const served = await standing(memory)

    let asked = 0
    const request = (async (...given: Parameters<Request>) => {
      asked += 1
      const answered = await fetch(...given)
      // The first answer is dropped after the far side wrote it, which is what
      // a connection that died between the two looks like from here.
      if (asked === 1) throw new Error("socket hang up")
      return answered
    }) as Request

    await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin, gap: 1, request }), (transport) =>
        transport.api.submit(memory.session, { kind: "prompt", text: "ask" }),
      ),
    )

    expect(asked).toBe(2)
    expect(memory.calls.filter((one) => one.method === "submit")).toHaveLength(1)

    await served.close()
  })

  /**
   * The same rule, for the one write that answers a value. A second Session
   * would be worse than a second Run: the caller holds one id and the other
   * is open where nobody is looking at it.
   */
  it("opens one Session when a create lands and its answer is lost", async () => {
    const memory = await held()
    const served = await standing(memory)

    let asked = 0
    const request = (async (...given: Parameters<Request>) => {
      asked += 1
      const answered = await fetch(...given)
      if (asked === 1) throw new Error("socket hang up")
      return answered
    }) as Request

    const made = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin, gap: 1, request }), (transport) =>
        transport.api.create("/there"),
      ),
    )

    expect(asked).toBe(2)
    expect(memory.calls.filter((one) => one.method === "create")).toHaveLength(1)
    expect(memory.opened()).toEqual([made])

    await served.close()
  })

  /**
   * And the other side of that rule. A write the far side read and refused is
   * a shape the two halves disagree about, so asking again forever would be a
   * hang where a report belongs.
   */
  it("makes a refused shape a defect rather than an endless ask", async () => {
    const memory = await held()
    const served = await standing(memory)

    // A body the wire cannot read, which the contract's own types would never
    // produce — so the cast is what stands in for two halves that disagree.
    const failed = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin, gap: 1 }), (transport) =>
        Effect.exit(transport.api.cancel(memory.session, "whenever" as CancelCause)),
      ),
    )

    expect(Exit.isFailure(failed)).toBe(true)
    expect(String(failed)).toContain("Refused")
    expect(memory.calls).toEqual([])

    await served.close()
  })
})

/**
 * The one thing beside the contract that crosses this wire. A command reaches
 * Domains rather than a Session, and the Domains are the serving process's —
 * so the line travels and the answer is what the command wrote.
 */
describe("a command, read as a Transport", () => {
  const MODES = ["default", "read-only"]

  // The rows a serving process holds. `plugins/api` may not import the plugin
  // that owns `/mode`, so what it does is written here.
  const rowsOf = (serving: { mode: string }): readonly CommandInfo[] => [
    {
      id: "mode",
      description: "names the permission mode this Session runs under",
      run: (command) =>
        Effect.sync(() => {
          const named = command.argument
          if (named === undefined || !MODES.includes(named)) {
            command.write(`mode: ${serving.mode}`)
            return
          }
          serving.mode = named
          command.write(`mode: ${named}`)
        }),
    },
  ]

  it("runs a line where the rows are, and hands back what it wrote", async () => {
    const memory = await held()
    const state = { mode: "default" }
    const served = await standing(memory, undefined, Effect.succeed(rowsOf(state)))

    const answered = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin, gap: 1 }), (transport) =>
        transport.command(memory.session, "/mode read-only"),
      ),
    )

    expect(answered).toEqual({ wrote: "mode: read-only" })
    expect(state.mode).toBe("read-only")

    await served.close()
  })

  /**
   * A command is a write, so it carries a key and asking again is safe. A
   * `/mode` whose answer was lost would otherwise be a second Run recorded
   * for a mode that was already set.
   */
  it("asks again for a line the pipe lost, and runs it once", async () => {
    const memory = await held()
    let ran = 0
    const served = await standing(
      memory,
      undefined,
      Effect.succeed([
        {
          id: "undo",
          description: "reverses the last write",
          run: (command) =>
            Effect.sync(() => {
              ran += 1
              command.write(`undone: ${ran}`)
            }),
        },
      ]),
    )

    let asked = 0
    const request = (async (...given: Parameters<Request>) => {
      asked += 1
      const answered = await fetch(...given)
      if (asked === 1) throw new Error("socket hang up")
      return answered
    }) as Request

    const answered = await Effect.runPromise(
      Effect.flatMap(httpTransport({ origin: served.origin, gap: 1, request }), (transport) =>
        transport.command(memory.session, "/undo"),
      ),
    )

    expect(asked).toBe(2)
    expect(ran).toBe(1)
    expect(answered).toEqual({ wrote: "undone: 1" })

    await served.close()
  })
})

/**
 * `SessionAPI` is one interface and a filler answers all of it. This one
 * reaches every method, so a call made against a pipe that is down waits for
 * it — and no call is answered at once with a defect saying it was not wired.
 */
describe("what the wire carries", () => {
  const transport = httpTransport({ origin: "http://eva.invalid", gap: 1 })

  /**
   * A call that has to wait for a pipe that is down is not a defect, so a
   * write is given a moment and then dropped. What is asserted is that it
   * travelled at all — a method nobody wired would say so at once.
   */
  const tried = <A>(call: Effect.Effect<A>): Effect.Effect<string> =>
    Effect.race(Effect.map(Effect.exit(call), String), Effect.as(Effect.sleep(5), "still waiting"))

  it("carries every call the page makes", async () => {
    const found = await Effect.runPromise(
      Effect.flatMap(transport, (one) =>
        Effect.all([
          tried(Stream.runCollect(one.api.watch(sessionID("ses_1")))),
          tried(one.api.list),
          tried(one.api.create("/here")),
          tried(Effect.scoped(one.api.attach(sessionID("ses_1")))),
          tried(one.api.model.get(sessionID("ses_1"))),
          tried(one.api.model.set(sessionID("ses_1"), MODEL)),
          tried(one.api.submit(sessionID("ses_1"), { kind: "prompt", text: "ask" })),
          tried(one.api.cancel(sessionID("ses_1"), "user")),
          tried(one.api.answer("call_1", { kind: "cancelled" })),
          tried(one.command(sessionID("ses_1"), "/mode")),
        ]),
      ),
    )

    expect(found.join("\n")).not.toContain("Failure")
  })
})

/**
 * The one read on this wire that is not a `SessionAPI` call. A Catalog is a
 * fact of the build and not of a Session, so it is read beside the Transport
 * — and a picker that was answered nothing shows nothing rather than a list
 * it invented.
 */
describe("the models, read beside the Transport", () => {
  it("reads every model the Catalog behind the wire knows", async () => {
    const memory = await held()
    const served = await standing(memory, undefined, undefined, CATALOG)

    const rows = await Effect.runPromise(readModels({ origin: served.origin }))

    expect(rows).toEqual(modelRows(CATALOG))
    expect(rows?.map((row) => row.label)).toEqual(["anthropic/claude-opus-5"])

    await served.close()
  })

  // A build that loaded no Provider knows no model, and that is rows and not
  // nothing: the read happened, and the listing it found is empty.
  it("reads no rows from a build that knows no model, which is not nothing", async () => {
    const memory = await held()
    const served = await standing(memory)

    expect(await Effect.runPromise(readModels({ origin: served.origin }))).toEqual([])

    await served.close()
  })

  /**
   * And a wire that did not answer is nothing rather than a wait. A picker is
   * drawn or it is not, so this read says which — unlike a Session API call,
   * which has no error channel and waits until the pipe is back.
   */
  it("answers nothing when nothing on the far side answered rows", async () => {
    expect(await Effect.runPromise(readModels({ origin: "http://eva.invalid" }))).toBeUndefined()
  })

  it("answers nothing when the far side answered the page instead of the wire", async () => {
    const request = (async () =>
      new Response("<!doctype html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as Request

    expect(await Effect.runPromise(readModels({ request }))).toBeUndefined()
  })
})

describe("the paths the two halves agree on", () => {
  it("names one Session under the listing it came from, and its model under it", () => {
    expect(sessionPath("ses_1")).toBe(`${SESSIONS}/ses_1`)
    expect(modelPath("ses_1")).toBe(`${SESSIONS}/ses_1/model`)
    expect(commandPath("ses_1")).toBe(`${SESSIONS}/ses_1/command`)
  })

  // A model is a fact of the build and not of a Session, so it is the one
  // path here that names none.
  it("names the Catalog's rows outside the listing, because they are the build's", () => {
    expect(MODELS).toBe("/api/models")
    expect(MODELS).not.toContain(SESSIONS)
  })

  // A page asks the host that served it, so nothing here is absolute.
  it("is rooted, so no address is built into the page", () => {
    expect(SESSIONS.startsWith("/")).toBe(true)
    expect(modelPath("ses_1")).not.toContain("://")
  })
})
