import type { Domain, DomainMiss, Row } from "@missingstudio/eva-core"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makeRowDomain } from "./row.js"

interface TestInfo {
  id: string
  description: string
}

/**
 * A row used to be created by `update`, which minted `{ id }` and typed it as
 * a whole Info. Every other field the type declares was undefined, so a
 * surface row with no `interactive` read as one that is not interactive, and
 * every row-writing plugin carried a mirror type and a copier to compensate.
 *
 * These rules belong to a Domain of rows, so they are asserted against one —
 * not through a kernel a composition root assembled.
 */
describe("a row arrives whole", () => {
  const rows = (write: (draft: Row<TestInfo>) => void) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const domain = yield* makeRowDomain<TestInfo>("test", () => Effect.void)
        yield* Effect.provideService(domain.transform(write), Scope.Scope, scope)
        const found = yield* domain.get
        yield* Scope.close(scope, Exit.void)
        return found
      }),
    )

  it("registers the whole Info", async () => {
    expect(await rows((draft) => draft.set({ id: "cost", description: "Show the spend" }))).toEqual(
      [{ id: "cost", description: "Show the spend" }],
    )
  })

  it("leaves an id nothing registered alone, rather than minting a part of one", async () => {
    expect(
      await rows((draft) => draft.update("cost", (row) => void (row.description = "no"))),
    ).toEqual([])
  })

  // Replay order decides which transform wins, so a replace that re-appends
  // silently changes precedence — the rule a plugin replace already holds.
  it("keeps the position of the row it replaces", async () => {
    const found = await rows((draft) => {
      draft.set({ id: "one", description: "first" })
      draft.set({ id: "two", description: "second" })
      draft.set({ id: "one", description: "replaced" })
    })

    expect(found.map((row) => row.id)).toEqual(["one", "two"])
    expect(found[0]?.description).toBe("replaced")
  })

  // A plugin registers a constant it holds, and a later transform edits the
  // row. Without the copy, editing the row edits the plugin's own table.
  it("copies the Info in, so a later edit does not reach the caller's own", async () => {
    const held: TestInfo = { id: "cost", description: "Show the spend" }
    await rows((draft) => {
      draft.set(held)
      draft.update("cost", (row) => void (row.description = "edited"))
    })

    expect(held.description).toBe("Show the spend")
  })

  it("reads back what a transform removed", async () => {
    const found = await rows((draft) => {
      draft.set({ id: "one", description: "first" })
      draft.set({ id: "two", description: "second" })
      draft.remove("one")
    })

    expect(found.map((row) => row.id)).toEqual(["two"])
  })

  // The count a surface watches is the committed one, so the assembler can
  // wire a topic to it and trust what it says.
  it("publishes the committed count", async () => {
    const counts: number[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const domain = yield* makeRowDomain<TestInfo>("test", (count) =>
          Effect.sync(() => void counts.push(count)),
        )
        yield* Effect.provideService(
          domain.transform((draft) => draft.set({ id: "one", description: "first" })),
          Scope.Scope,
          scope,
        )
        yield* Scope.close(scope, Exit.void)
      }),
    )

    // The first build commits an empty domain, then the transform commits one
    // row, then disposing it rebuilds back to none.
    expect(counts).toEqual([0, 1, 0])
  })
})

/**
 * An `update` that ran before its row's `set` used to no-op in silence, on
 * every rebuild, forever. The row is still left alone — upserting a fragment
 * is the defect the decision log retired — but the miss is counted and
 * published with the commit, naming the plugin that reached.
 */
describe("an edit that reached no row is reported", () => {
  interface Published {
    count: number
    missed: readonly DomainMiss[]
  }

  const watched = <A>(
    body: (
      domain: Domain<readonly TestInfo[], Row<TestInfo>>,
      scope: Scope.Closeable,
      published: Published[],
    ) => Effect.Effect<A>,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const published: Published[] = []
        const domain = yield* makeRowDomain<TestInfo>("test", (count, missed) =>
          Effect.sync(() => void published.push({ count, missed })),
        )
        const result = yield* body(domain, scope, published)
        yield* Scope.close(scope, Exit.void)
        return result
      }),
    )

  const write = (
    domain: Domain<readonly TestInfo[], Row<TestInfo>>,
    scope: Scope.Closeable,
    owner: string,
    edit: (draft: Row<TestInfo>) => void,
  ) => domain.transform(edit, owner).pipe(Effect.provideService(Scope.Scope, scope))

  it("reports an update before its set, and the row does not carry the edit", async () => {
    const result = await watched((domain, scope, published) =>
      Effect.gen(function* () {
        yield* write(domain, scope, "eva.print", (draft) =>
          draft.update("cost", (row) => void (row.description = "edited")),
        )
        yield* write(domain, scope, "eva.commands", (draft) =>
          draft.set({ id: "cost", description: "described" }),
        )
        return { rows: yield* domain.get, last: published.at(-1) }
      }),
    )

    // Registration order replays the update first, so the miss persists and
    // the row keeps the describer's words: the report makes the defect
    // visible, it does not repair it.
    expect(result.last?.missed).toEqual([{ id: "cost", owner: "eva.print" }])
    expect(result.rows).toEqual([{ id: "cost", description: "described" }])
  })

  it("reports nothing for an update after its set", async () => {
    const last = await watched((domain, scope, published) =>
      Effect.gen(function* () {
        yield* write(domain, scope, "eva.commands", (draft) =>
          draft.set({ id: "cost", description: "described" }),
        )
        yield* write(domain, scope, "eva.print", (draft) =>
          draft.update("cost", (row) => void (row.description = "edited")),
        )
        return published.at(-1)
      }),
    )

    expect(last?.missed).toEqual([])
    expect(last?.count).toBe(1)
  })

  it("reports the miss on every rebuild while the id never arrives", async () => {
    const reported = await watched((domain, scope, published) =>
      Effect.gen(function* () {
        yield* write(domain, scope, "eva.print", (draft) =>
          draft.update("ghost", (row) => void (row.description = "edited")),
        )
        yield* write(domain, scope, "eva.commands", (draft) =>
          draft.set({ id: "other", description: "unrelated" }),
        )
        return published.map((entry) => entry.missed)
      }),
    )

    // The first build has no transforms; each registration rebuilds, and the
    // miss is in every rebuild that replays the reaching transform.
    expect(reported).toEqual([
      [],
      [{ id: "ghost", owner: "eva.print" }],
      [{ id: "ghost", owner: "eva.print" }],
    ])
  })

  it("reports nothing for a remove of an absent id", async () => {
    const last = await watched((domain, scope, published) =>
      Effect.gen(function* () {
        yield* write(domain, scope, "eva.print", (draft) => draft.remove("ghost"))
        return published.at(-1)
      }),
    )

    expect(last?.missed).toEqual([])
  })
})
