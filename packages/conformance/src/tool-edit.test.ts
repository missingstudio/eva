import { makeSessionAPI, type Kernel } from "@missingstudio/eva-boot"
import type { ModelRef } from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import { type Payload, sessionID } from "@missingstudio/eva-schema"
import type { CommandContext, Plugin } from "@missingstudio/eva-sdk"
import {
  calling,
  committed,
  virtualFileSystem,
  withKernel,
  type Calling,
} from "@missingstudio/eva-testkit"
import { makeEditTool, toolEdit, UNDO_COMMAND, type EditTool } from "@missingstudio/eva-tool-edit"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

const SESSION = sessionID("sess_tool_edit")

// The command context wants one, and no Provider is reached here.
const MODEL: ModelRef = { provider: "anthropic", model: "claude-sonnet-4-5" }

// The ground under the tool, in load order: the sink, the Recorder over it,
// and the applier. A test that leaves one out is testing the empty slot.
const GROUND: readonly Plugin[] = [traceMemory, trace, diff]

// Bytes an editor is careless with: a byte-order mark, a CRLF line ending, a
// tab, a combining accent, text outside the basic plane, and no last newline.
const AWKWARD = "﻿one\r\n\tzwei é \u{1F600}\nthree"

interface Bench {
  readonly tool: EditTool
  // Every file the virtual FileSystem holds, so a test reads what was written.
  readonly held: () => Readonly<Record<string, string>>
  // A write by somebody else, so a preview or an apply can go stale.
  readonly write: (path: string, content: string) => Effect.Effect<void>
  readonly payloads: Effect.Effect<readonly Payload[]>
}

/**
 * The tool over a live kernel: the real applier from `eva.diff`, the real
 * Recorder from `eva.trace` over an in-memory sink, and the testkit's virtual
 * `FileSystem`. Nothing here touches a disk, so the whole contract runs in
 * `verify` with nothing to clean up.
 *
 * A plugin may not import another plugin, which is why this suite lives here
 * and not beside the tool: holding one plugin to another's contract is the job
 * this package exists for.
 */
const bench = <A>(
  seed: Readonly<Record<string, string>>,
  body: (found: Bench, kernel: Kernel) => Effect.Effect<A>,
  ground: readonly Plugin[] = GROUND,
): Promise<A> => {
  const virtual = virtualFileSystem(seed)

  return withKernel([...ground, virtual.plugin], (kernel) =>
    Effect.gen(function* () {
      const recorder = yield* kernel.slot.recorder.peek
      if (recorder !== undefined) yield* recorder.open(SESSION)

      const tool = makeEditTool({
        files: kernel.slot.fileSystem.peek,
        applier: kernel.slot.diffApplier.peek,
        recorder: kernel.slot.recorder.peek,
      })

      return yield* body(
        {
          tool,
          held: virtual.files,
          write: (path, content) => Effect.orDie(virtual.fs.write(path, content)),
          payloads: Effect.map(committed(kernel), (events) => events.map((event) => event.payload)),
        },
        kernel,
      )
    }),
  )
}

const hunks = (...pairs: readonly [string, string][]) =>
  pairs.map(([find, replace]) => ({ find, replace }))

describe("a write the edit tool makes", () => {
  it("is previewed, and the preview writes nothing", async () => {
    const found = await bench({ "a.ts": "one\ntwo\n" }, (it) =>
      Effect.gen(function* () {
        const outcome = yield* it.tool.execute({
          path: "a.ts",
          hunks: hunks(["two", "TWO"]),
          dryRun: true,
        })
        return { outcome, held: it.held(), payloads: yield* it.payloads }
      }),
    )

    expect(found.outcome).toEqual({
      kind: "previewed",
      path: "a.ts",
      hunks: 1,
      after: "one\nTWO\n",
    })
    expect(found.held).toEqual({ "a.ts": "one\ntwo\n" })
    expect(found.payloads).toEqual([])
  })

  // The dry run and the apply resolve the same Edit, so what a person is
  // shown is what lands.
  it("lands exactly what the dry run answered", async () => {
    const found = await bench({ "a.ts": "one\ntwo\n" }, (it) =>
      Effect.gen(function* () {
        const edit = { path: "a.ts", hunks: hunks(["two", "TWO"]) }
        const previewed = yield* it.tool.execute({ ...edit, dryRun: true })
        const applied = yield* it.tool.execute(edit)
        return { previewed, applied, held: it.held() }
      }),
    )

    expect(found.previewed.kind).toBe("previewed")
    expect(found.applied.kind).toBe("applied")
    expect(found.held["a.ts"]).toBe("one\nTWO\n")
  })

  it("lands every hunk in one write, each counted against the last", async () => {
    const found = await bench({ "a.ts": "alpha beta gamma" }, (it) =>
      Effect.gen(function* () {
        const outcome = yield* it.tool.execute({
          path: "a.ts",
          hunks: hunks(["alpha", "beta"], ["beta beta", "one"]),
        })
        return { outcome, held: it.held() }
      }),
    )

    expect(found.outcome).toMatchObject({ kind: "applied", hunks: 2, after: "one gamma" })
    expect(found.held["a.ts"]).toBe("one gamma")
  })
})

describe("an applied write", () => {
  it("is undone byte for byte", async () => {
    const found = await bench({ "a.ts": AWKWARD }, (it) =>
      Effect.gen(function* () {
        const applied = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["zwei", "two"]) })
        if (applied.kind !== "applied") return { applied, undone: undefined, held: it.held() }

        const undone = yield* it.tool.undo(applied.undo)
        return { applied, undone, held: it.held() }
      }),
    )

    expect(found.undone).toEqual({ kind: "undone", path: "a.ts", undo: "1" })
    expect(found.held["a.ts"]).toBe(AWKWARD)
  })

  /**
   * One token names one write and reverses it whichever way it stands, so an
   * undo is itself undoable — the reverse of a reverse is the apply again.
   */
  it("is put back when it is undone twice", async () => {
    const found = await bench({ "a.ts": "one\n" }, (it) =>
      Effect.gen(function* () {
        const applied = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["one", "two"]) })
        if (applied.kind !== "applied") return { held: it.held() }

        yield* it.tool.undo(applied.undo)
        yield* it.tool.undo(applied.undo)
        return { held: it.held() }
      }),
    )

    expect(found.held["a.ts"]).toBe("two\n")
  })

  // Somebody else wrote after the apply, so the undo would throw their work
  // away. It refuses instead, and says the record is stale.
  it("refuses an undo whose file moved, and leaves the file alone", async () => {
    const found = await bench({ "a.ts": "one\n" }, (it) =>
      Effect.gen(function* () {
        const applied = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["one", "two"]) })
        if (applied.kind !== "applied") return { undone: applied, held: it.held() }

        yield* it.write("a.ts", "somebody else\n")
        const undone = yield* it.tool.undo(applied.undo)
        return { undone, held: it.held() }
      }),
    )

    expect(found.undone).toMatchObject({ kind: "refused", path: "a.ts", reason: "stale" })
    expect(found.held["a.ts"]).toBe("somebody else\n")
  })

  it("is not undone by a token nothing issued", async () => {
    const found = await bench({ "a.ts": "one\n" }, (it) =>
      Effect.gen(function* () {
        const undone = yield* it.tool.undo("7")
        return { undone, held: it.held() }
      }),
    )

    expect(found.undone).toEqual({ kind: "unknown", undo: "7" })
    expect(found.held["a.ts"]).toBe("one\n")
  })
})

describe("the trace, and not the tool's word", () => {
  it("carries an edit payload naming the path and the hunk count", async () => {
    const found = await bench({ "a.ts": "one\ntwo\n" }, (it) =>
      Effect.gen(function* () {
        yield* it.tool.execute({ path: "a.ts", hunks: hunks(["one", "ONE"], ["two", "TWO"]) })
        return yield* it.payloads
      }),
    )

    expect(found).toEqual([{ kind: "edit", path: "a.ts", hunks: 2 }])
  })

  /**
   * An undo writes a whole content and lands no Hunk, so it counts zero: the
   * Trace says the file changed, and the count says the change was not a set
   * of Hunks.
   */
  it("carries an edit payload with no hunks for an undo", async () => {
    const found = await bench({ "a.ts": "one\n" }, (it) =>
      Effect.gen(function* () {
        const applied = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["one", "two"]) })
        if (applied.kind === "applied") yield* it.tool.undo(applied.undo)
        return yield* it.payloads
      }),
    )

    expect(found).toEqual([
      { kind: "edit", path: "a.ts", hunks: 1 },
      { kind: "edit", path: "a.ts", hunks: 0 },
    ])
  })
})

describe("a path the file system refuses", () => {
  it("is a refusal naming outside_root, and nothing is written", async () => {
    const found = await bench({ "a.ts": "one\n" }, (it) =>
      Effect.gen(function* () {
        const outcome = yield* it.tool.execute({
          path: "../secrets.txt",
          hunks: hunks(["one", "two"]),
        })
        return { outcome, held: it.held(), payloads: yield* it.payloads }
      }),
    )

    expect(found.outcome).toMatchObject({ kind: "refused", reason: "outside_root" })
    expect(found.held).toEqual({ "a.ts": "one\n" })
    expect(found.payloads).toEqual([])
  })

  /**
   * An edit changes a file that is there. It creates none: an undo of a
   * create is a delete, and a `FileSystem` cannot delete — so a create whose
   * undo left an empty file behind would break the one promise this tool
   * makes.
   */
  it("is a refusal naming not_found rather than a file it created", async () => {
    const found = await bench({ "a.ts": "one\n" }, (it) =>
      Effect.gen(function* () {
        const outcome = yield* it.tool.execute({ path: "b.ts", hunks: hunks(["one", "two"]) })
        return { outcome, held: it.held() }
      }),
    )

    expect(found.outcome).toMatchObject({ kind: "refused", path: "b.ts", reason: "not_found" })
    expect(found.held).toEqual({ "a.ts": "one\n" })
  })
})

describe("a hunk that cannot land", () => {
  it("refuses the whole edit when it is not in the file", async () => {
    const found = await bench({ "a.ts": "one\ntwo\n" }, (it) =>
      Effect.gen(function* () {
        const outcome = yield* it.tool.execute({
          path: "a.ts",
          hunks: hunks(["one", "ONE"], ["four", "FOUR"]),
        })
        return { outcome, held: it.held(), payloads: yield* it.payloads }
      }),
    )

    expect(found.outcome).toMatchObject({ kind: "refused", reason: "hunk_missing" })
    expect(found.held["a.ts"]).toBe("one\ntwo\n")
    expect(found.payloads).toEqual([])
  })

  it("refuses the whole edit when it is there more than once", async () => {
    const found = await bench({ "a.ts": "two two\n" }, (it) =>
      Effect.gen(function* () {
        const outcome = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["two", "TWO"]) })
        return { outcome, held: it.held() }
      }),
    )

    expect(found.outcome).toMatchObject({ kind: "refused", reason: "hunk_ambiguous" })
    expect(found.held["a.ts"]).toBe("two two\n")
  })
})

describe("a slot nothing fills", () => {
  it("stops the write and names the missing slot", async () => {
    const found = await bench(
      { "a.ts": "one\n" },
      (it) =>
        Effect.gen(function* () {
          const outcome = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["one", "two"]) })
          return { outcome, held: it.held(), payloads: yield* it.payloads }
        }),
      [traceMemory, trace],
    )

    expect(found.outcome).toEqual({ kind: "degraded", missing: ["DiffApplier"] })
    expect(found.held["a.ts"]).toBe("one\n")
    expect(found.payloads).toEqual([{ kind: "degraded", missing: ["DiffApplier"] }])
  })

  // A write it cannot record is a write it does not make: the Trace is what
  // shows a file changed, so an unrecorded write would be a change nobody
  // can see.
  it("stops the write when the Recorder is empty", async () => {
    const found = await bench(
      { "a.ts": "one\n" },
      (it) =>
        Effect.gen(function* () {
          const outcome = yield* it.tool.execute({ path: "a.ts", hunks: hunks(["one", "two"]) })
          return { outcome, held: it.held() }
        }),
      [diff],
    )

    expect(found.outcome).toEqual({ kind: "degraded", missing: ["Recorder"] })
    expect(found.held["a.ts"]).toBe("one\n")
  })

  /**
   * The three slots are read at the moment of use and never captured, so one
   * tool answers degraded before an applier arrives and writes after it.
   */
  it("writes through the applier that fills the slot now", async () => {
    const found = await bench(
      { "a.ts": "one\n" },
      (it, kernel) =>
        Effect.gen(function* () {
          const edit = { path: "a.ts", hunks: hunks(["one", "two"]) }
          const before = yield* it.tool.execute(edit)
          yield* kernel.runtime.add(diff)
          const after = yield* it.tool.execute(edit)
          return { before, after, held: it.held() }
        }),
      [traceMemory, trace],
    )

    expect(found.before.kind).toBe("degraded")
    expect(found.after.kind).toBe("applied")
    expect(found.held["a.ts"]).toBe("two\n")
  })
})

/**
 * The plugin's row, over the execution that runs it. The tool's own contract
 * is above, against `makeEditTool`; what is here is that the name a model
 * writes reaches the write, and that the call leaves the three records.
 */
describe("a call the model makes by name", () => {
  const calls = <A>(
    seed: Readonly<Record<string, string>>,
    body: (
      made: Calling,
      kernel: Kernel,
      held: () => Readonly<Record<string, string>>,
    ) => Effect.Effect<A>,
  ): Promise<A> => {
    const virtual = virtualFileSystem(seed)

    return withKernel([...GROUND, virtual.plugin, toolEdit], (kernel) =>
      Effect.gen(function* () {
        const recorder = yield* kernel.slot.recorder.get
        yield* recorder.open(SESSION)
        return yield* body(
          calling(kernel, {
            session: SESSION,
            // Read at the moment of use, the way every commit path reads it.
            emit: (payload) =>
              Effect.flatMap(kernel.slot.recorder.get, (one) => one.commit([payload])),
          }),
          kernel,
          virtual.files,
        )
      }),
    )
  }

  it("lands the write, and every record of the call, in order", async () => {
    const found = await calls({ "a.ts": "one\n" }, (made, kernel, held) =>
      Effect.gen(function* () {
        const result = yield* made.call("edit", { path: "a.ts", hunks: hunks(["one", "two"]) })
        const recorded = (yield* committed(kernel)).map((event) => event.payload)
        return { result, recorded, held: held() }
      }),
    )

    expect(found.result.disposition).toBe("ok")
    expect(found.held["a.ts"]).toBe("two\n")
    // The `edit` payload lands inside the call, because the tool records the
    // write and the execution records the call.
    expect(found.recorded.map((payload) => payload.kind)).toEqual([
      "tool_call",
      "edit",
      "tool_update",
      "tool_result",
    ])
    const joined = found.recorded.filter((payload) => "id" in payload)
    expect(new Set(joined.map((payload) => "id" in payload && payload.id)).size).toBe(1)
  })

  // A refusal is a result the model reads, so a call that cannot land its
  // hunk still leaves a full set of records.
  it("reports a hunk that cannot land as a failed result", async () => {
    const found = await calls({ "a.ts": "one\n" }, (made, _kernel, held) =>
      Effect.map(
        made.call("edit", { path: "a.ts", hunks: hunks(["missing", "two"]) }),
        (result) => ({ result, held: held() }),
      ),
    )

    expect(found.result.disposition).toBe("failed")
    expect(found.held["a.ts"]).toBe("one\n")
  })

  it("refuses arguments that name no edit rather than writing", async () => {
    const found = await calls({ "a.ts": "one\n" }, (made, _kernel, held) =>
      Effect.map(made.call("edit", { path: "a.ts" }), (result) => ({ result, held: held() })),
    )

    expect(found.result.disposition).toBe("failed")
    expect(found.held["a.ts"]).toBe("one\n")
  })
})

/**
 * The person's door onto a write. The exit clause is "you can preview and undo
 * every write", and a preview is on the row while an undo is not: reversing a
 * write is not a call a model makes. So `/undo` is what makes the clause true
 * for a person, and this drives the row `eva.tool.edit` registers in the
 * command domain.
 */
describe("the write a person reverses", () => {
  const typing = <A>(
    seed: Readonly<Record<string, string>>,
    body: (
      undo: (token?: string) => Effect.Effect<readonly string[]>,
      made: Calling,
      held: () => Readonly<Record<string, string>>,
    ) => Effect.Effect<A>,
  ): Promise<A> => {
    const virtual = virtualFileSystem(seed)

    return withKernel([...GROUND, virtual.plugin, toolEdit], (kernel, scope) =>
      Effect.gen(function* () {
        const recorder = yield* kernel.slot.recorder.get
        yield* recorder.open(SESSION)
        const api = yield* makeSessionAPI(kernel, MODEL, scope)

        const undo = Effect.fn("test.undo")(function* (token?: string) {
          const row = (yield* kernel.domains.command.get).find((one) => one.id === UNDO_COMMAND)
          const said: string[] = []
          const context: CommandContext = {
            api: api.session,
            session: SESSION,
            ...(token === undefined ? {} : { argument: token }),
            write: (text) => void said.push(text),
            select: () => {},
          }
          yield* row?.run?.(context) ?? Effect.void
          return said as readonly string[]
        })

        return yield* body(
          undo,
          calling(kernel, {
            session: SESSION,
            emit: (payload) =>
              Effect.flatMap(kernel.slot.recorder.get, (one) => one.commit([payload])),
          }),
          virtual.files,
        )
      }),
    )
  }

  it("puts the file back, and says which token puts the change back", async () => {
    const found = await typing({ "a.ts": "one\n" }, (undo, made, held) =>
      Effect.gen(function* () {
        yield* made.call("edit", { path: "a.ts", hunks: hunks(["one", "two"]) })
        const written = held()["a.ts"]
        const said = yield* undo()
        return { written, said, held: held()["a.ts"] }
      }),
    )

    expect(found.written).toBe("two\n")
    expect(found.held).toBe("one\n")
    expect(found.said[0]).toContain("a.ts is as it was")
    expect(found.said[0]).toContain(`/${UNDO_COMMAND} 1`)
  })

  // The token map lives in this process, so a token nothing issued is not an
  // error: it is a person told what this build can reach.
  it("says so when no write is held under the token", async () => {
    const found = await typing({ "a.ts": "one\n" }, (undo, _made, held) =>
      Effect.map(undo("7"), (said) => ({ said, held: held()["a.ts"] })),
    )

    expect(found.said[0]).toContain("no write is held under 7")
    expect(found.held).toBe("one\n")
  })

  // Undoing twice redoes: one token names one write and reverses it whichever
  // way it stands. The command says the token, so a person can.
  it("puts the change back when the same token is named again", async () => {
    const found = await typing({ "a.ts": "one\n" }, (undo, made, held) =>
      Effect.gen(function* () {
        yield* made.call("edit", { path: "a.ts", hunks: hunks(["one", "two"]) })
        yield* undo()
        const reversed = held()["a.ts"]
        yield* undo("1")
        return { reversed, held: held()["a.ts"] }
      }),
    )

    expect(found.reversed).toBe("one\n")
    expect(found.held).toBe("two\n")
  })
})
