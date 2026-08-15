import type {
  Budget,
  CredentialStore,
  Recorder,
  SessionStore,
  TraceSink,
} from "@missingstudio/eva-core"
import type { Plugin, Slots } from "@missingstudio/eva-sdk"
import { Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf } from "./boot.js"

// Every Slot the kernel holds, with the name it publishes under.
const SLOTS: readonly [keyof Slots, string, unknown][] = [
  ["recorder", "Recorder", {} as Recorder],
  ["traceSink", "TraceSink", {} as TraceSink],
  ["sessionStore", "SessionStore", {} as SessionStore],
  ["credentialStore", "CredentialStore", {} as CredentialStore],
  ["budget", "Budget", {} as Budget],
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
 * The row Draft's own rules — a row is copied in, a replace keeps its
 * position, an unknown id is left alone — moved to the kernel with the
 * implementation, and are asserted against `makeRowDomain` directly in
 * `packages/kernel/src/row.test.ts`. They needed a whole kernel to reach
 * while they lived here; they need none now.
 *
 * What boot still decides is above: that a Slot says when it is filled, and
 * that the resolved list loads once, in order, in one batch.
 */
