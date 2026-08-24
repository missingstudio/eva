import { EmptySlotError } from "@missingstudio/eva-core"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makeSlot } from "./slot.js"

interface Sink {
  readonly id: string
}

const events = () => {
  const filled: string[] = []
  const emptied: string[] = []
  const evictions: (string | undefined)[] = []
  return {
    filled,
    emptied,
    evictions,
    handlers: {
      filled: (slot: string, by: string, evicted?: string) =>
        Effect.sync(() => {
          filled.push(`${slot}:${by}`)
          evictions.push(evicted)
        }),
      emptied: (slot: string) => Effect.sync(() => void emptied.push(slot)),
    },
  }
}

describe("a slot", () => {
  it("reads undefined and defects while it is empty", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const slot = yield* makeSlot<Sink>("TraceSink")
        const peeked = yield* slot.peek
        expect(peeked).toBeUndefined()
        return yield* slot.get
      }),
    )
    expect(Exit.isFailure(result)).toBe(true)
    expect(String(result)).toContain("the TraceSink slot is empty")
  })

  it("hands out the implementation that fills it", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const slot = yield* makeSlot<Sink>("TraceSink")
        yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        return yield* slot.get
      }),
    )
    expect(found.id).toBe("jsonl")
  })

  // The architectural bet, at the slot level: the next read sees the swap.
  it("gives the next read the replacement, not the old implementation", async () => {
    const reads = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const slot = yield* makeSlot<Sink>("TraceSink")
        yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        const before = yield* slot.get
        yield* slot
          .provide("eva.trace.memory", { id: "memory" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        const after = yield* slot.get
        return [before.id, after.id]
      }),
    )
    expect(reads).toEqual(["jsonl", "memory"])
  })

  it("empties when the filling plugin's scope closes", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const slot = yield* makeSlot<Sink>("TraceSink")
        const scope = yield* Scope.make()
        yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* Scope.close(scope, Exit.void)
        return yield* slot.peek
      }),
    )
    expect(found).toBeUndefined()
  })

  // A replaced provider's finalizer must not empty the slot the new one
  // fills — and the fill that displaced it names what it displaced.
  it("leaves the slot alone when a replaced provider is disposed", async () => {
    const log = events()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const slot = yield* makeSlot<Sink>("TraceSink", log.handlers)
        const first = yield* Scope.make()
        const second = yield* Scope.make()
        yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, first))
        yield* slot
          .provide("eva.trace.memory", { id: "memory" })
          .pipe(Effect.provideService(Scope.Scope, second))
        yield* Scope.close(first, Exit.void)
        return yield* slot.peek
      }),
    )
    expect(found?.id).toBe("memory")
    expect(log.evictions).toEqual([undefined, "eva.trace.jsonl"])
  })

  // Last-writer-wins stays — a bundle overlay must be able to replace a
  // default sink. What changes is the silence: the eviction is named.
  it("names the displaced holder when a different plugin takes a live slot", async () => {
    const log = events()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const slot = yield* makeSlot<Sink>("TraceSink", log.handlers)
        yield* slot
          .provide("eva.trace.memory", { id: "memory" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        return yield* slot.get
      }),
    )
    expect(found.id).toBe("jsonl")
    expect(log.evictions).toEqual([undefined, "eva.trace.memory"])
  })

  // Hot replacement of a plugin's own implementation, exactly as today.
  it("carries no eviction on a same-id re-provide", async () => {
    const log = events()
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const slot = yield* makeSlot<Sink>("TraceSink", log.handlers)
        yield* slot
          .provide("eva.trace.jsonl", { id: "one" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* slot
          .provide("eva.trace.jsonl", { id: "two" })
          .pipe(Effect.provideService(Scope.Scope, scope))
      }),
    )
    expect(log.evictions).toEqual([undefined, undefined])
  })

  it("broadcasts filled and emptied", async () => {
    const log = events()
    await Effect.runPromise(
      Effect.gen(function* () {
        const slot = yield* makeSlot<Sink>("TraceSink", log.handlers)
        const scope = yield* Scope.make()
        yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* Scope.close(scope, Exit.void)
      }),
    )
    expect(log.filled).toEqual(["TraceSink:eva.trace.jsonl"])
    expect(log.emptied).toEqual(["TraceSink"])
  })

  it("disposes twice safely", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const slot = yield* makeSlot<Sink>("TraceSink")
        const registration = yield* slot
          .provide("eva.trace.jsonl", { id: "jsonl" })
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* registration.dispose
        yield* registration.dispose
        return yield* slot.peek
      }),
    )
    expect(found).toBeUndefined()
  })
})

describe("EmptySlotError", () => {
  it("names the slot it found empty", () => {
    expect(new EmptySlotError("Recorder").slot).toBe("Recorder")
  })
})
