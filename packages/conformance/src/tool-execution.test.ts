import type { Kernel } from "@missingstudio/eva-boot"
import type { FileSystem } from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import type { Payload } from "@missingstudio/eva-schema"
import { define, type BroadcastMap, type Plugin } from "@missingstudio/eva-sdk"
import {
  calling,
  CALLING_SESSION,
  virtualFileSystem,
  withKernel,
  type Calling,
  type Virtual,
} from "@missingstudio/eva-testkit"
import { sched } from "@missingstudio/eva-sched"
import { toolEdit } from "@missingstudio/eva-tool-edit"
import { toolRead } from "@missingstudio/eva-tool-read"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { Deferred, Effect, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The shipped tools through the shipped execution: what schedule a group of
 * them runs under, and what the two boundaries do when a hook dies.
 *
 * `packages/core` holds the same rules against tools it writes for itself, so
 * what is here is the half a unit test cannot state: that `eva.tool.read`
 * really claims a call may run beside another, that `eva.tool.edit` really
 * does not, and that a hook a plugin registered decides or observes by the
 * boundary's kind rather than its own.
 *
 * Nothing here is a timing assertion. Overlap is a counting latch, and the
 * order of a barrier is read off what had committed when each tool started.
 */

// The safety net under every latch. A schedule that is right never waits for
// it, and one that is wrong fails with its own words instead of hanging.
const WAITING = "2 seconds"

const GATED_FS = "test.fs.gated"

const TREE = {
  "a.md": "one\n",
  "b.md": "two\n",
  "c.md": "three\n",
  "fast.md": "quick\n",
  "slow.md": "late\n",
}

/**
 * A `FileSystem` that runs one Effect before every read and is otherwise the
 * map underneath it. The `FileSystem` slot is the only seam the shipped read
 * tools share, so this is where a suite holds them still without writing a
 * tool of its own.
 */
const gatedBy = (virtual: Virtual, gate: (path: string) => Effect.Effect<void>): Plugin =>
  define({
    id: GATED_FS,
    effect: Effect.fn(GATED_FS)(function* (ctx) {
      const files: FileSystem = {
        ...virtual.fs,
        read: (path) => Effect.andThen(gate(path), virtual.fs.read(path)),
      }
      yield* ctx.slot.fileSystem.provide(ctx.id, files)
    }),
  })

/**
 * A gate that counts how many reads are in flight at once. Each one waits for
 * the count to reach `wanted`, and the last to arrive releases the rest — so
 * the highest count is a fact about the schedule and not about a clock.
 */
const counting = (wanted: number) => {
  const full = Effect.runSync(Deferred.make<boolean>())
  const state = { now: 0, most: 0 }
  return {
    state,
    gate: (_path: string) =>
      Effect.gen(function* () {
        state.now += 1
        state.most = Math.max(state.most, state.now)
        if (state.now >= wanted) yield* Deferred.succeed(full, true)
        yield* Deferred.await(full).pipe(
          Effect.timeout(WAITING),
          Effect.orElseSucceed(() => false),
        )
        state.now -= 1
      }),
  }
}

/**
 * A gate that makes one named read answer first and every other read wait for
 * it. It is how the call a group made second finishes first, which is the only
 * way source order can be proven rather than observed.
 */
const after = (first: string) => {
  const done = Effect.runSync(Deferred.make<void>())
  return (path: string) =>
    path === first
      ? Effect.asVoid(Deferred.succeed(done, undefined))
      : Effect.asVoid(
          Deferred.await(done).pipe(
            Effect.timeout(WAITING),
            Effect.orElseSucceed(() => undefined),
          ),
        )
}

// The calls whose result is on the record. A `tool_result` is the last of a
// call's three records, so a call it names has committed whole.
const resultsIn = (log: readonly Payload[]): readonly string[] =>
  log.flatMap((one) => (one.kind === "tool_result" ? [one.id] : []))

/**
 * A gate that writes down, for every read, which calls had already committed.
 * A read that names the call before it did not start until that call was on
 * the record.
 */
const marking = (log: readonly Payload[]) => {
  const marks: { readonly at: string; readonly saw: readonly string[] }[] = []
  return {
    marks,
    saw: (at: string) => marks.find((mark) => mark.at === at)?.saw,
    gate: (path: string) => Effect.sync(() => void marks.push({ at: path, saw: resultsIn(log) })),
  }
}

interface Bench {
  readonly files: Plugin
  readonly riders?: readonly Plugin[]
  // Where every payload the calls make goes, as they are made.
  readonly log?: Payload[]
}

/**
 * The shipped build around the tools under test: the Trace, the applier, the
 * read tool, the write tool, and `eva.sched` over them in the load order the
 * CLI stacks. A Run is open, because the write tool records what it wrote.
 */
const bench = <A>(
  at: Bench,
  body: (calls: Calling, kernel: Kernel, scope: Scope.Scope) => Effect.Effect<A>,
): Promise<A> =>
  withKernel(
    [trace, traceMemory, at.files, diff, toolRead, toolEdit, sched, ...(at.riders ?? [])],
    (kernel, scope) =>
      Effect.gen(function* () {
        const recorder = yield* kernel.slot.recorder.peek
        if (recorder !== undefined) yield* recorder.open(CALLING_SESSION)
        const log = at.log
        const calls = calling(
          kernel,
          log === undefined ? {} : { emit: (payload) => Effect.sync(() => void log.push(payload)) },
        )
        return yield* body(calls, kernel, scope)
      }),
  )

const EDIT = { path: "c.md", hunks: [{ find: "three", replace: "four" }] }

describe("two calls of the shipped read tool", () => {
  /**
   * A latch and not a clock: neither read is released until both have arrived,
   * so an overlap that did not happen cannot pass this. The repeat is what
   * makes it a proof rather than one lucky schedule.
   */
  it("overlap, because the tool claims they may", { repeats: 25 }, async () => {
    const held = counting(2)
    const found = await bench({ files: gatedBy(virtualFileSystem(TREE), held.gate) }, (calls) =>
      calls.group([
        { name: "read", args: { path: "a.md" } },
        { name: "read", args: { path: "b.md" } },
      ]),
    )

    expect(held.state.most).toBe(2)
    expect(found.map((one) => one.disposition)).toEqual(["ok", "ok"])
  })
})

describe("a write between two reads", () => {
  /**
   * The barrier clause, whole, with the shipped tools: the read before it
   * commits before it starts, and its own records commit before the read after
   * it starts. Both halves are read off what each tool saw.
   */
  it("is a barrier: nothing after it starts until it has committed", async () => {
    const log: Payload[] = []
    const seen = marking(log)
    const virtual = virtualFileSystem(TREE)
    const found = await bench({ files: gatedBy(virtual, seen.gate), log }, (calls) =>
      calls.group([
        { name: "read", args: { path: "a.md" } },
        { name: "edit", args: EDIT },
        { name: "read", args: { path: "b.md" } },
      ]),
    )

    expect(found.map((one) => one.disposition)).toEqual(["ok", "ok", "ok"])
    expect(virtual.files()["c.md"]).toBe("four\n")
    // The applier reads the file it is about to change, so the write's first
    // touch of the file system is what says when the barrier started.
    expect(seen.saw("a.md")).toEqual([])
    expect(seen.saw("c.md")).toEqual(["call_1"])
    expect(seen.saw("b.md")).toEqual(["call_1", "call_2"])
    expect(resultsIn(log)).toEqual(["call_1", "call_2", "call_3"])
  })
})

describe("a window whose second call answers first", () => {
  /**
   * Source order, proven rather than observed: the read the group made second
   * is the one that finishes first, and the record still reads in the order
   * the calls were made.
   */
  it("lands its results and its records in source order", async () => {
    const log: Payload[] = []
    const found = await bench(
      { files: gatedBy(virtualFileSystem(TREE), after("fast.md")), log },
      (calls) =>
        calls.group([
          { name: "read", args: { path: "slow.md" } },
          { name: "read", args: { path: "fast.md" } },
        ]),
    )

    expect(found.map((one) => one.content[0])).toEqual([
      { type: "text", text: "late\n" },
      { type: "text", text: "quick\n" },
    ])
    expect(resultsIn(log)).toEqual(["call_1", "call_2"])
  })
})

const BROKEN = "test.hook.broken"

/**
 * One plugin, one hook, one throw. The boundary decides what that means, so
 * the same plugin proves both rules by registering at the other name.
 */
const throwing = (name: "tool.execute.before" | "tool.execute.after"): Plugin =>
  define({
    id: BROKEN,
    effect: Effect.fn(BROKEN)(function* (ctx) {
      yield* ctx.toolHooks[name](() => {
        throw new Error("the hook broke")
      })
    }),
  })

// Every failure the kernel published, as its plugin and the hook it names.
const failures = (kernel: Kernel, scope: Scope.Scope) =>
  Effect.gen(function* () {
    const seen: BroadcastMap["plugin.failed"][] = []
    yield* Effect.forkIn(
      Stream.runForEach(kernel.broadcast.subscribe("plugin.failed"), (payload) =>
        Effect.sync(() => void seen.push(payload)),
      ),
      scope,
    )
    yield* Effect.yieldNow
    return seen
  })

describe("a deciding hook that throws", () => {
  /**
   * `tool.execute.before` is the stage's first deciding boundary. A gate that
   * failed open because a plugin threw is not a gate, so the throw is a
   * denial that names the hook and the plugin it came from.
   */
  it("denies its tool call, and the tool never reads the file", async () => {
    const marks: string[] = []
    const virtual = virtualFileSystem(TREE)
    const found = await bench(
      {
        files: gatedBy(virtual, (path) => Effect.sync(() => void marks.push(path))),
        riders: [throwing("tool.execute.before")],
      },
      (calls) =>
        Effect.map(calls.call("read", { path: "a.md" }), (result) => ({
          result,
          said: calls.said(),
        })),
    )

    expect(found.result.disposition).toBe("denied")
    expect(found.result.content).toEqual([
      { type: "text", text: `the tool.execute.before hook of ${BROKEN} failed` },
    ])
    // Denied is not silent: the call is on the record with the pair that ends it.
    expect(found.said.map((one) => one.kind)).toEqual(["tool_call", "tool_update", "tool_result"])
    expect(marks).toEqual([])
  })
})

describe("an observing hook that throws", () => {
  /**
   * `tool.execute.after` observes. A broken observer must never end a Run, so
   * the tool's own answer stands, the failure is published as its plugin's,
   * and the next call runs.
   */
  it("is reported as its plugin's failure, and the calls go on", async () => {
    const virtual = virtualFileSystem(TREE)
    const found = await bench(
      { files: virtual.plugin, riders: [throwing("tool.execute.after")] },
      (calls, kernel, scope) =>
        Effect.gen(function* () {
          const seen = yield* failures(kernel, scope)
          const first = yield* calls.call("read", { path: "a.md" })
          const second = yield* calls.call("read", { path: "b.md" })
          yield* Effect.yieldNow
          return { first, second, published: [...seen] }
        }),
    )

    expect(found.first).toEqual({ disposition: "ok", content: [{ type: "text", text: "one\n" }] })
    expect(found.second).toEqual({ disposition: "ok", content: [{ type: "text", text: "two\n" }] })
    expect(found.published).toHaveLength(2)
    expect(found.published[0]).toMatchObject({ id: BROKEN, hook: "tool.execute.after" })
    expect(String(found.published[0]?.cause)).toContain("the hook broke")
  })
})
