import type {
  Budget,
  CredentialStore,
  DiffApplier,
  Recorder,
  SessionStore,
  TraceSink,
  Validator,
} from "@missingstudio/eva-core"
import type { BroadcastMap, Plugin, Slots } from "@missingstudio/eva-sdk"
import type { Payload } from "@missingstudio/eva-schema"
import { Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf } from "./boot.js"
import { runDeps } from "./deps.js"

// Every Slot the kernel holds, with the name it publishes under.
const SLOTS: readonly [keyof Slots, string, unknown][] = [
  ["recorder", "Recorder", {} as Recorder],
  ["traceSink", "TraceSink", {} as TraceSink],
  ["sessionStore", "SessionStore", {} as SessionStore],
  ["credentialStore", "CredentialStore", {} as CredentialStore],
  ["budget", "Budget", {} as Budget],
  ["validator", "Validator", {} as Validator],
  ["diffApplier", "DiffApplier", {} as DiffApplier],
]

/**
 * Two of the five Slots used to publish and three said nothing, so a surface
 * watching the traffic saw two of five swaps. One rule fills them all.
 */
describe("every Slot", () => {
  it.each(SLOTS)("says when %s is filled and when it empties", async (key, name, filling) => {
    const [filled, emptied] = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({ scope, resolved: [] })

        const watching = yield* Effect.forkChild(
          kernel.broadcast.subscribe("slot.filled").pipe(Stream.take(1), Stream.runCollect),
        )
        const emptying = yield* Effect.forkChild(
          kernel.broadcast.subscribe("slot.emptied").pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow

        const held = yield* Scope.make()
        yield* Effect.provideService(
          kernel.slot[key].provide("acme.plugin", filling as never),
          Scope.Scope,
          held,
        )
        yield* Scope.close(held, Exit.void)

        const said = [...(yield* Fiber.join(watching))]
        const gone = [...(yield* Fiber.join(emptying))]
        yield* Scope.close(scope, Exit.void)
        return [said[0], gone[0]] as const
      }),
    )

    expect(filled).toEqual({ slot: name, by: "acme.plugin" })
    expect(emptied).toEqual({ slot: name })
  })
})

// Registers a command row, and records every replay of its transform.
const commandPlugin = (id: string, replays: string[]): Plugin => ({
  id,
  effect: Effect.fn(function* (ctx) {
    const suffix = ctx.options["suffix"]
    const named = typeof suffix === "string" ? `${id}${suffix}` : id
    yield* ctx.command.transform((draft) => {
      replays.push(id)
      draft.set({ id: named, description: id })
    })
  }),
})

/**
 * Loading used to live in the composition root, so every caller repeated the
 * batch rule and the lookup. These hold what moved.
 */
describe("boot loads what the config resolved to", () => {
  const loaded = ({
    replays = [],
    carries = [],
    ...options
  }: {
    resolved: readonly { id: string; options?: Record<string, unknown> }[]
    carries?: readonly Plugin[]
    replays?: string[]
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({ ...options, scope, build: buildOf(carries) })
        const commands = (yield* kernel.domains.command.get).map((row) => row.id)
        const list = yield* kernel.runtime.list
        // Read before the scope closes: disposing a transform rebuilds the
        // domain as well, so a later read counts the teardown too.
        const replayed = [...replays]
        yield* Scope.close(scope, Exit.void)
        return { commands, list, missing: kernel.missing, replays: replayed }
      }),
    )

  it("loads every resolved entry this build carries", async () => {
    const replays: string[] = []
    const found = await loaded({
      resolved: [{ id: "acme.one" }, { id: "acme.two" }],
      carries: [commandPlugin("acme.one", replays), commandPlugin("acme.two", replays)],
    })

    expect(found.list).toEqual(["acme.one", "acme.two"])
    expect(found.commands).toEqual(["acme.one", "acme.two"])
  })

  /**
   * The rule the composition root used to carry: without it the first
   * transform replays again for every plugin that loads after it.
   */
  it("loads in one batch, so each domain rebuilds once", async () => {
    const replays: string[] = []
    const found = await loaded({
      resolved: [{ id: "acme.one" }, { id: "acme.two" }],
      carries: [commandPlugin("acme.one", replays), commandPlugin("acme.two", replays)],
      replays,
    })

    // Loaded one at a time the first transform replays again for the second,
    // which is the cost the batch exists to avoid.
    expect(found.replays).toEqual(["acme.one", "acme.two"])
  })

  it("hands each plugin the options its entry carries", async () => {
    const replays: string[] = []
    const found = await loaded({
      resolved: [{ id: "acme.one", options: { suffix: ".suffixed" } }],
      carries: [commandPlugin("acme.one", replays)],
    })

    expect(found.commands).toEqual(["acme.one.suffixed"])
  })

  // A config may name a plugin nobody has, and silence looks like success.
  it("names a resolved id this build has no implementation for", async () => {
    const found = await loaded({ resolved: [{ id: "acme.nobody" }] })

    expect(found.missing).toEqual(["acme.nobody"])
    expect(found.list).toEqual([])
  })

  it("has nothing missing when every entry loaded", async () => {
    const replays: string[] = []
    const found = await loaded({
      resolved: [{ id: "acme.one" }],
      carries: [commandPlugin("acme.one", replays)],
    })

    expect(found.missing).toEqual([])
  })
})

/**
 * An edit that reached no row rides the `.updated` payload, naming the
 * plugin whose transform reached — boot stamps each context's domains with
 * the plugin's own id. A Broadcast has no replay, so the subscriber arrives
 * through `observe`, the seam between assembly and the load batch.
 */
describe("an edit that reached no row is published", () => {
  it("names the id and the owning plugin in the topic payload", async () => {
    const writer: Plugin = {
      id: "acme.writer",
      effect: Effect.fn(function* (ctx) {
        yield* ctx.command.transform((draft) =>
          draft.update("ghost", (row) => void (row.description = "edited")),
        )
      }),
    }

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const seen: BroadcastMap["command.updated"][] = []
        yield* boot({
          scope,
          resolved: [{ id: "acme.writer" }],
          build: buildOf([writer]),
          observe: (kernel) =>
            Effect.gen(function* () {
              yield* Effect.forkIn(
                Stream.runForEach(kernel.broadcast.subscribe("command.updated"), (payload) =>
                  Effect.sync(() => void seen.push(payload)),
                ),
                scope,
              )
              yield* Effect.yieldNow
            }),
        })
        // Let the subscriber drain what the batch published, and read before
        // the scope closes: the teardown disposes the transform and rebuilds.
        yield* Effect.yieldNow
        const published = [...seen]
        yield* Scope.close(scope, Exit.void)
        return published
      }),
    )

    expect(found.at(-1)).toEqual({ count: 0, missed: [{ id: "ghost", owner: "acme.writer" }] })
  })
})

/**
 * The row Draft's own rules — a row is copied in, a replace keeps its
 * position, an unknown id is left alone — moved to the kernel with the
 * implementation, and are asserted against `makeRowDomain` directly in
 * `packages/kernel/src/row.test.ts`. They needed a whole kernel to reach
 * while they lived here; they need none now.
 *
 * What boot still decides is above: that a Slot says when it is filled, and
 * that the resolved list loads once, in order, in one batch.
 */

/**
 * A provider boundary observes: none of its hooks decides whether the call
 * proceeds, so one that throws is reported and the Run goes on with what the
 * hook left behind. Boot is where a boundary's kind and a hook's owner are
 * stamped, so the pair is pinned here.
 */
describe("an observing provider hook that throws", () => {
  const group: readonly Payload[] = [
    { kind: "text", block: 0, content: { type: "text", text: "hi" } },
  ]

  it("is published as its plugin's failure, and the payloads survive", async () => {
    const observer: Plugin = {
      id: "acme.broken",
      effect: Effect.fn(function* (ctx) {
        yield* ctx.providerHooks["provider.response.after"](() => {
          throw new Error("the observer broke")
        })
      }),
    }

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const seen: BroadcastMap["plugin.failed"][] = []
        const kernel = yield* boot({
          scope,
          resolved: [{ id: observer.id }],
          build: buildOf([observer]),
        })
        yield* Effect.forkIn(
          Stream.runForEach(kernel.broadcast.subscribe("plugin.failed"), (payload) =>
            Effect.sync(() => void seen.push(payload)),
          ),
          scope,
        )
        yield* Effect.yieldNow

        const afterResponse = runDeps(kernel, () => Effect.void).afterResponse
        if (afterResponse === undefined) return yield* Effect.die("boot wired no afterResponse")
        const kept = yield* afterResponse(group)

        yield* Effect.yieldNow
        const published = [...seen]
        yield* Scope.close(scope, Exit.void)
        return { kept, published }
      }),
    )

    // The Run continued: the group reached the commit unchanged.
    expect(found.kept).toEqual(group)
    expect(found.published).toHaveLength(1)
    expect(found.published[0]).toMatchObject({
      id: "acme.broken",
      hook: "provider.response.after",
    })
    expect(String(found.published[0]?.cause)).toContain("the observer broke")
  })
})
