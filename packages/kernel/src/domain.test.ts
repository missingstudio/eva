import type { Domain, DomainMiss } from "@missingstudio/eva-core"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { batch, makeDomain } from "./domain.js"

interface Row {
  id: string
  weight: number
}

interface Draft {
  add(row: Row): void
  update(id: string, change: (row: Row) => void): void
}

interface Seen {
  finalized: string[][]
  commits: number
  misses: (readonly DomainMiss[])[]
}

// Closing the scope disposes every transform, and each disposal rebuilds, so
// a body reads what it wants to assert before the scope closes.
const withDomain = <A>(
  body: (domain: Domain<Row[], Draft>, scope: Scope.Closeable, seen: Seen) => Effect.Effect<A>,
  options: { finalize?: boolean } = {},
): Promise<A> => {
  const seen: Seen = { finalized: [], commits: 0, misses: [] }
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const domain = yield* makeDomain<Row[], Draft>({
        name: "rows",
        initial: () => [],
        draft: (state, miss) => ({
          add: (row) => void state.push(row),
          update: (id, change) => {
            const found = state.find((row) => row.id === id)
            if (found === undefined) return miss(id)
            change(found)
          },
        }),
        ...(options.finalize === true
          ? {
              finalize: (_draft: Draft, state: Row[]) =>
                void seen.finalized.push(state.map((row) => row.id)),
            }
          : {}),
        onCommit: (_state, missed) =>
          Effect.sync(() => {
            seen.commits += 1
            seen.misses.push(missed)
          }),
      })
      const result = yield* body(domain, scope, seen)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )
}

const add = (domain: Domain<Row[], Draft>, scope: Scope.Closeable, row: Row) =>
  domain.transform((draft) => draft.add(row)).pipe(Effect.provideService(Scope.Scope, scope))

describe("a domain", () => {
  it("replays every transform in registration order", async () => {
    const state = await withDomain((domain, scope) =>
      Effect.gen(function* () {
        yield* add(domain, scope, { id: "a", weight: 1 })
        yield* add(domain, scope, { id: "b", weight: 2 })
        return yield* domain.get
      }),
    )
    expect(state.map((row) => row.id)).toEqual(["a", "b"])
  })

  it("lets a later transform win over an earlier one", async () => {
    const state = await withDomain((domain, scope) =>
      Effect.gen(function* () {
        yield* add(domain, scope, { id: "a", weight: 1 })
        yield* domain
          .transform((draft) => draft.update("a", (row) => void (row.weight = 9)))
          .pipe(Effect.provideService(Scope.Scope, scope))
        return yield* domain.get
      }),
    )
    expect(state[0]?.weight).toBe(9)
  })

  it("rebuilds from fresh state when a transform is disposed", async () => {
    const state = await withDomain((domain, scope) =>
      Effect.gen(function* () {
        const first = yield* add(domain, scope, { id: "a", weight: 1 })
        yield* add(domain, scope, { id: "b", weight: 2 })
        yield* (first as { dispose: Effect.Effect<void> }).dispose
        return yield* domain.get
      }),
    )
    expect(state.map((row) => row.id)).toEqual(["b"])
  })

  it("disposes twice safely", async () => {
    const state = await withDomain((domain, scope) =>
      Effect.gen(function* () {
        const registration = (yield* add(domain, scope, { id: "a", weight: 1 })) as {
          dispose: Effect.Effect<void>
        }
        yield* registration.dispose
        yield* registration.dispose
        return yield* domain.get
      }),
    )
    expect(state).toEqual([])
  })

  it("removes a plugin's transforms when its scope closes", async () => {
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const domain = yield* makeDomain<Row[], Draft>({
          name: "rows",
          initial: () => [],
          draft: (state) => ({
            add: (row) => void state.push(row),
            update: () => {},
          }),
        })
        const scope = yield* Scope.make()
        yield* add(domain, scope, { id: "a", weight: 1 })
        yield* Scope.close(scope, Exit.void)
        return yield* domain.get
      }),
    )
    expect(after).toEqual([])
  })

  // The type is the rule: if these calls ever compile again, the unused
  // expectations below turn into the compile errors that say so.
  it("refuses a transform that returns an Effect", () => {
    const use = (domain: Domain<Row[], Draft>) =>
      // @ts-expect-error a transform is synchronous
      domain.transform(() => Effect.void)
    expect(typeof use).toBe("function")
  })

  it("refuses a transform that returns a promise", () => {
    const use = (domain: Domain<Row[], Draft>) =>
      // @ts-expect-error a transform is synchronous
      domain.transform(async () => {})
    expect(typeof use).toBe("function")
  })

  // The replay loop is a plain loop: a transform is a synchronous draft
  // edit, run once per rebuild and never awaited. Work that awaits belongs
  // in the plugin's effect, once, before the transform is registered.
  it("runs each transform synchronously, once per rebuild", async () => {
    const calls: string[] = []
    const seen = await withDomain((domain, scope) =>
      Effect.gen(function* () {
        yield* domain
          .transform(() => void calls.push("a"))
          .pipe(Effect.provideService(Scope.Scope, scope))
        yield* domain
          .transform(() => void calls.push("b"))
          .pipe(Effect.provideService(Scope.Scope, scope))
        return [...calls]
      }),
    )
    // Registering "a" rebuilds with [a]; registering "b" rebuilds with [a, b].
    expect(seen).toEqual(["a", "a", "b"])
  })

  it("runs the finalizer after every transform and before the state is visible", async () => {
    const result = await withDomain(
      (domain, scope, seen) =>
        Effect.gen(function* () {
          yield* add(domain, scope, { id: "a", weight: 1 })
          return { finalized: seen.finalized.map((ids) => [...ids]), state: yield* domain.get }
        }),
      { finalize: true },
    )
    expect(result.finalized.at(-1)).toEqual(["a"])
    expect(result.state.map((row) => row.id)).toEqual(["a"])
  })
})

describe("boot batching", () => {
  it("rebuilds a domain once for N transforms registered in one batch", async () => {
    const N = 12
    const result = await withDomain((domain, scope, seen) =>
      Effect.gen(function* () {
        const before = seen.commits
        yield* batch(
          Effect.forEach(
            Array.from({ length: N }, (_, index) => index),
            (index) => add(domain, scope, { id: `row_${index}`, weight: index }),
            { discard: true },
          ),
        )
        return { rebuilds: seen.commits - before, state: yield* domain.get }
      }),
    )
    expect(result.state).toHaveLength(N)
    expect(result.rebuilds).toBe(1)
  })

  it("rebuilds once per transform outside a batch", async () => {
    const rebuilds = await withDomain((domain, scope, seen) =>
      Effect.gen(function* () {
        const before = seen.commits
        for (const id of ["a", "b", "c"]) yield* add(domain, scope, { id, weight: 0 })
        return seen.commits - before
      }),
    )
    expect(rebuilds).toBe(3)
  })
})

describe("misses", () => {
  const reach = (domain: Domain<Row[], Draft>, scope: Scope.Closeable, owner: string) =>
    domain
      .transform((draft) => draft.update("ghost", (row) => void (row.weight = 9)), owner)
      .pipe(Effect.provideService(Scope.Scope, scope))

  it("names the owner of the transform that reached", async () => {
    const missed = await withDomain((domain, scope, seen) =>
      Effect.gen(function* () {
        yield* reach(domain, scope, "plug.a")
        return seen.misses.at(-1)
      }),
    )
    expect(missed).toEqual([{ id: "ghost", owner: "plug.a" }])
  })

  it("keeps the owner across replays", async () => {
    const missed = await withDomain((domain, scope, seen) =>
      Effect.gen(function* () {
        yield* reach(domain, scope, "plug.a")
        yield* add(domain, scope, { id: "other", weight: 1 })
        return seen.misses.at(-1)
      }),
    )
    expect(missed).toEqual([{ id: "ghost", owner: "plug.a" }])
  })

  // Misses are collected per rebuild, so a miss the replay no longer makes
  // is absent from the next commit on its own.
  it("clears once the reaching transform is disposed", async () => {
    const missed = await withDomain((domain, scope, seen) =>
      Effect.gen(function* () {
        const registration = yield* reach(domain, scope, "plug.a")
        yield* registration.dispose
        return seen.misses.at(-1)
      }),
    )
    expect(missed).toEqual([])
  })
})
