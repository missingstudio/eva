import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TraceSink } from "@missingstudio/eva-core"
import { eventID, runID, sessionID, type Event, type Payload } from "@missingstudio/eva-schema"
import { trace } from "@missingstudio/eva-trace"
import { makeJsonlSink, traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { traceMemory, type MemorySink } from "@missingstudio/eva-trace-memory"
import { Effect, Exit, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { boot, type Kernel } from "@missingstudio/eva-boot"

const SESSION = sessionID("sess_swap")

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const kinds = (events: readonly Event[]) => events.map((event) => event.payload.kind)

/**
 * Boots a live kernel that loads nothing, because these tests are about the
 * runtime itself: each one adds and removes a different set in its own order,
 * mid-Run. The entries carry the options a hand-added plugin still reads.
 */
const started = <A>(body: (kernel: Kernel, path: string) => Effect.Effect<A>): Promise<A> => {
  const path = join(mkdtempSync(join(tmpdir(), "eva-swap-")), "trace.jsonl")
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: [
          { id: "eva.trace" },
          { id: "eva.trace.jsonl", options: { path } },
          { id: "eva.trace.memory" },
        ],
      })
      const result = yield* body(kernel, path)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )
}

const onDisk = Effect.fn("test.onDisk")(function* (path: string) {
  const reader = yield* makeJsonlSink(path)
  const found = yield* Stream.runCollect(reader.replay(SESSION))
  yield* reader.close
  return [...found]
})

// The architectural bet, settled in one live process.
describe("a slot hot-swaps", () => {
  it("lands the next commit in the new sink, with no restart", async () => {
    const found = await started((kernel, path) =>
      Effect.gen(function* () {
        yield* kernel.runtime.add(trace)
        yield* kernel.runtime.add(traceJsonl)

        const recorder = yield* kernel.slot.recorder.get
        yield* recorder.open(SESSION)
        yield* recorder.commit([text("into the file")])

        // Replace the sink behind the Recorder while the Run is open.
        yield* kernel.runtime.add(traceMemory)
        yield* recorder.commit([text("into memory")])
        yield* recorder.close({ result: "done", summary: "answered" }, "end_turn")

        const memory = (yield* kernel.slot.traceSink.get) as MemorySink
        return { memory: kinds(memory.all()), file: kinds(yield* onDisk(path)) }
      }),
    )

    expect(found.file).toEqual(["text"])
    expect(found.memory).toEqual(["text", "finished"])
  })

  // The swap that replaces one plugin's sink with a second plugin's names
  // what it displaced; a filler whose work goes silent is never unannounced.
  it("names the sink it displaced when a second plugin takes the slot", async () => {
    const found = await started((kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.add(traceJsonl)
        const watching = yield* Effect.forkChild(
          kernel.broadcast.subscribe("slot.filled").pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* kernel.runtime.add(traceMemory)
        return [...(yield* Fiber.join(watching))]
      }),
    )
    expect(found[0]).toEqual({
      slot: "TraceSink",
      by: "eva.trace.memory",
      evicted: "eva.trace.jsonl",
    })
  })

  it("keeps numbering the new sink's records from 1", async () => {
    const seqs = await started((kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.add(trace)
        yield* kernel.runtime.add(traceJsonl)
        const recorder = yield* kernel.slot.recorder.get
        yield* recorder.open(SESSION)
        yield* recorder.commit([text("one")])
        yield* kernel.runtime.add(traceMemory)
        yield* recorder.commit([text("two")])
        const memory = (yield* kernel.slot.traceSink.get) as MemorySink
        return memory.all().map((event) => event.seq)
      }),
    )
    expect(seqs).toEqual([1])
  })
})

// What the architecture forbids, shown failing beside what it requires.
describe("capturing a slot value", () => {
  const record = (value: string): Event => ({
    id: eventID(`evt_${value}`),
    seq: 0,
    at: { wall: "2026-08-15T09:00:00.000Z" },
    run: runID("run_swap"),
    session: SESSION,
    parent: null,
    payload: text(value),
  })

  const write = (sink: TraceSink, value: string) => sink.append([record(value)])

  // The quiet failure: nothing errors, and the two writers diverge.
  it("writes into the sink that was replaced, while a late read follows the swap", async () => {
    const found = await started((kernel, path) =>
      Effect.gen(function* () {
        yield* kernel.runtime.add(traceJsonl)

        // Wrong: the value is read once and held.
        const captured = yield* kernel.slot.traceSink.get

        yield* kernel.runtime.add(traceMemory)

        yield* write(captured, "captured")
        // Correct: the slot is read at the point of use.
        yield* Effect.flatMap(kernel.slot.traceSink.get, (sink) => write(sink, "late"))

        const memory = (yield* kernel.slot.traceSink.get) as MemorySink
        return {
          memory: memory.all().length,
          file: (yield* onDisk(path)).length,
        }
      }),
    )

    expect(found.file).toBe(1)
    expect(found.memory).toBe(1)
  })

  // The loud failure: unload the old plugin and the captured value is dead.
  it("dies on a closed sink once the plugin behind it unloads", async () => {
    const found = await started((kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.add(traceJsonl)
        const captured = yield* kernel.slot.traceSink.get

        yield* kernel.runtime.add(traceMemory)
        yield* kernel.runtime.remove("eva.trace.jsonl")

        const capturedExit = yield* Effect.exit(write(captured, "captured"))
        const lateExit = yield* Effect.exit(
          Effect.flatMap(kernel.slot.traceSink.get, (sink) => write(sink, "late")),
        )
        return { captured: Exit.isFailure(capturedExit), late: Exit.isFailure(lateExit) }
      }),
    )

    expect(found.captured).toBe(true)
    expect(found.late).toBe(false)
  })
})

describe("a missing capability degrades", () => {
  it("runs with no trace storage and says so, rather than pretending to record", async () => {
    const found = await started((kernel) =>
      Effect.gen(function* () {
        // eva.trace loads; nothing fills TraceSink yet.
        yield* kernel.runtime.add(trace)
        const recorder = yield* kernel.slot.recorder.get
        yield* recorder.open(SESSION)
        yield* recorder.commit([text("nowhere to go")])

        yield* kernel.runtime.add(traceMemory)
        yield* recorder.close({ result: "done", summary: "answered" }, "end_turn")

        const memory = (yield* kernel.slot.traceSink.get) as MemorySink
        return memory.all().map((event) => event.payload)
      }),
    )

    // The caveat commits with the claim, and it comes first.
    expect(found[0]).toEqual({ kind: "degraded", missing: ["TraceSink"] })
    expect(found[1]).toMatchObject({ kind: "finished" })
  })

  it("leaves the Recorder slot empty rather than filling it with nothing", async () => {
    const found = await started((kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.add(traceMemory)
        return yield* kernel.slot.recorder.peek
      }),
    )
    expect(found).toBeUndefined()
  })
})
