import { PluginCycleError } from "@missingstudio/eva-core"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makePluginRuntime, type PluginEntry, type PluginRuntime } from "./plugin.js"

interface Recording {
  readonly loads: string[]
  readonly unloads: string[]
  readonly failures: { id: string; cause: unknown }[]
}

const record = (): Recording => ({ loads: [], unloads: [], failures: [] })

// The runtime scope closes after the body returns, which appends more
// unloads, so a body that inspects the log copies it first.
const snapshot = (log: Recording): Recording => ({
  loads: [...log.loads],
  unloads: [...log.unloads],
  failures: [...log.failures],
})

// Runs `body` against a fresh runtime inside a scope that always closes.
const withRuntime = <A>(
  body: (runtime: PluginRuntime<Recording>, log: Recording) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const log = record()
      const runtime = yield* makePluginRuntime(scope, () => log, {
        added: () => Effect.void,
        removed: () => Effect.void,
        failed: (id, cause) => Effect.sync(() => void log.failures.push({ id, cause })),
      })
      const result = yield* body(runtime, log)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

// A plugin that records its load and registers an unload finalizer, so a
// leaked scope shows up as a missing unload.
const plugin = (id: string, mark = id): PluginEntry<Recording> => ({
  id,
  effect: (log) =>
    Effect.gen(function* () {
      log.loads.push(mark)
      const scope = yield* Effect.scope
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => void log.unloads.push(mark)),
      )
    }),
})

describe("the plugin runtime", () => {
  it("loads in order and lists what is loaded", async () => {
    const listed = await withRuntime((runtime) =>
      Effect.gen(function* () {
        yield* runtime.add(plugin("a"))
        yield* runtime.add(plugin("b"))
        yield* runtime.add(plugin("c"))
        return yield* runtime.list
      }),
    )
    expect(listed).toEqual(["a", "b", "c"])
  })

  it("unloads a plugin and runs every finalizer it registered", async () => {
    const log = await withRuntime((runtime, log) =>
      Effect.gen(function* () {
        yield* runtime.add(plugin("a"))
        yield* runtime.add(plugin("b"))
        yield* runtime.remove("a")
        return snapshot(log)
      }),
    )
    expect(log.unloads).toEqual(["a"])
  })

  it("drops a removed plugin from the list", async () => {
    const listed = await withRuntime((runtime) =>
      Effect.gen(function* () {
        yield* runtime.add(plugin("a"))
        yield* runtime.add(plugin("b"))
        yield* runtime.remove("a")
        return yield* runtime.list
      }),
    )
    expect(listed).toEqual(["b"])
  })

  // Eva's own rule. OpenCode re-appends on replace, which silently changes
  // which transform wins.
  it("keeps the order position when a known id is replaced", async () => {
    const result = await withRuntime((runtime, log) =>
      Effect.gen(function* () {
        yield* runtime.add(plugin("a"))
        yield* runtime.add(plugin("b"))
        yield* runtime.add(plugin("c"))
        yield* runtime.add(plugin("b", "b2"))
        return { listed: yield* runtime.list, log: snapshot(log) }
      }),
    )
    expect(result.listed).toEqual(["a", "b", "c"])
    expect(result.log.loads).toEqual(["a", "b", "c", "b2"])
    expect(result.log.unloads).toEqual(["b"])
  })

  it("waits until a plugin has finished loading", async () => {
    const loaded = await withRuntime((runtime, log) =>
      Effect.gen(function* () {
        yield* runtime.add(plugin("a"))
        yield* runtime.wait("a")
        return [...log.loads]
      }),
    )
    expect(loaded).toEqual(["a"])
  })

  it("reports a failing plugin and keeps running", async () => {
    const result = await withRuntime((runtime, log) =>
      Effect.gen(function* () {
        yield* runtime.add({ id: "bad", effect: () => Effect.die(new Error("boom")) })
        yield* runtime.add(plugin("good"))
        return { listed: yield* runtime.list, log: snapshot(log) }
      }),
    )
    expect(result.log.failures).toHaveLength(1)
    expect(result.log.loads).toEqual(["good"])
    expect(result.listed).toContain("good")
  })

  it("names the cycle when a plugin adds itself", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const log = record()
        const runtime = yield* makePluginRuntime(scope, () => log)
        const recursive: PluginEntry<Recording> = {
          id: "loop",
          effect: () => runtime.add(recursive),
        }
        yield* runtime.add(recursive)
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    const cause = String(exit)
    expect(cause).toContain("loop → loop")
  })

  it("names a cycle that runs through a second plugin", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const log = record()
        const runtime = yield* makePluginRuntime(scope, () => log)
        const first: PluginEntry<Recording> = {
          id: "first",
          effect: () => runtime.add(second),
        }
        const second: PluginEntry<Recording> = {
          id: "second",
          effect: () => runtime.add(first),
        }
        yield* runtime.add(first)
      }),
    )
    expect(String(exit)).toContain("first → second → first")
  })
})

describe("reload", () => {
  it("unloads and reloads every plugin in one process, leaking no scope", async () => {
    const ids = ["a", "b", "c", "d"]
    const result = await withRuntime((runtime, log) =>
      Effect.gen(function* () {
        for (const id of ids) yield* runtime.add(plugin(id))
        for (const id of ids) yield* runtime.remove(id)
        for (const id of ids) yield* runtime.add(plugin(id, `${id}2`))
        return { listed: yield* runtime.list, log: snapshot(log) }
      }),
    )

    expect(result.log.loads).toEqual(["a", "b", "c", "d", "a2", "b2", "c2", "d2"])
    expect(result.log.unloads).toEqual(["a", "b", "c", "d"])
    expect(result.listed).toEqual(ids)
  })

  it("keeps every replaced plugin at its position across a reload round", async () => {
    const listed = await withRuntime((runtime) =>
      Effect.gen(function* () {
        for (const id of ["a", "b", "c"]) yield* runtime.add(plugin(id))
        yield* runtime.add(plugin("b", "b2"))
        yield* runtime.add(plugin("a", "a2"))
        return yield* runtime.list
      }),
    )
    expect(listed).toEqual(["a", "b", "c"])
  })

  it("closes every plugin scope when the runtime scope closes", async () => {
    const log = record()
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const runtime = yield* makePluginRuntime(scope, () => log)
        for (const id of ["a", "b"]) yield* runtime.add(plugin(id))
        yield* Scope.close(scope, Exit.void)
      }),
    )
    expect(log.unloads.sort()).toEqual(["a", "b"])
  })
})

describe("PluginCycleError", () => {
  it("reads as the chain it found", () => {
    expect(new PluginCycleError(["a", "b", "a"]).message).toBe("plugin load cycle: a → b → a")
  })
})
