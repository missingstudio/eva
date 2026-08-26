import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Command, OutputChunk, Process, SandboxPolicy, Shell } from "@missingstudio/eva-core"
import { fs } from "@missingstudio/eva-fs"
import { sandboxNone } from "@missingstudio/eva-sandbox-none"
import { define } from "@missingstudio/eva-sdk"
import { shell } from "@missingstudio/eva-shell"
import { virtualFileSystem, withKernel } from "@missingstudio/eva-testkit"
import { Effect, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-ground-"))

const CLOSED: SandboxPolicy = { readable: [], writable: [], network: false }

const said = (process: Process) =>
  Stream.runFold(
    process.output,
    () => "",
    (all, chunk) => all + chunk.text,
  )

/**
 * A second Shell filler, so the read of the Shell slot can be watched. It
 * starts nothing: what is under test is which filler answered.
 */
const other = (seen: Command[]) =>
  define({
    id: "acme.shell",
    effect: Effect.fn("acme.shell")(function* (ctx) {
      const stub: Shell = {
        spawn: (command) =>
          Effect.sync(() => {
            seen.push(command)
            const spoken: OutputChunk = { stream: "stdout", text: "from the second shell" }
            return {
              output: Stream.fromIterable([spoken]),
              exit: Effect.succeed({ code: 0, signal: null }),
              kill: Effect.void,
            }
          }),
      }
      yield* ctx.slot.shell.provide(ctx.id, stub)
    }),
  })

/**
 * The three slots every tool stands on, over a live kernel. The FileSystem
 * contract itself is held in `fs-contract.test.ts` over both of its fillers;
 * what is here is the wiring — that each plugin fills its slot, and that a
 * consumer reads a slot at the moment of use.
 */
describe("the ground slots", () => {
  it("are each filled by their plugin", async () => {
    const found = await withKernel(
      [{ plugin: fs, options: { root: scratch() } }, shell, sandboxNone],
      (kernel) =>
        Effect.gen(function* () {
          const sandbox = yield* kernel.slot.sandbox.get
          return {
            fileSystem: (yield* kernel.slot.fileSystem.peek) !== undefined,
            shell: (yield* kernel.slot.shell.peek) !== undefined,
            enforces: (yield* sandbox.capabilities).enforces,
          }
        }),
    )

    expect(found).toEqual({ fileSystem: true, shell: true, enforces: [] })
  })

  /**
   * The virtual filler takes the FileSystem slot from `eva.fs` while the
   * kernel is up, and the next read lands in the map rather than on the
   * disk. One read, spelled once, answered by whichever filler holds the
   * slot — which is what makes a tool test hermetic with no second code
   * path in the tool.
   */
  it("hand the FileSystem to the filler that took it last", async () => {
    const virtual = virtualFileSystem({ "one.txt": "from the map" })

    const found = await withKernel([{ plugin: fs, options: { root: scratch() } }], (kernel) =>
      Effect.gen(function* () {
        const read = Effect.flatMap(kernel.slot.fileSystem.get, (found) => found.read("one.txt"))
        yield* Effect.flatMap(kernel.slot.fileSystem.get, (found) =>
          found.write("one.txt", "on the disk"),
        )

        const before = yield* read
        yield* kernel.runtime.add(virtual.plugin)
        const after = yield* read
        return { before, after }
      }).pipe(Effect.orDie),
    )

    expect(found).toEqual({ before: "on the disk", after: "from the map" })
  })

  /**
   * `eva.sandbox.none` reads the Shell slot per command and never captures
   * it, so replacing the Shell reaches the next command. Stage 4's Sandbox
   * arrives at the same call site for the same reason.
   */
  it("read the Shell again for each command the Sandbox starts", async () => {
    const seen: Command[] = []
    const command: Command = { argv: ["node", "-e", "process.stdout.write('from eva.shell')"] }

    const found = await withKernel([shell, sandboxNone], (kernel, scope) =>
      Effect.gen(function* () {
        const run = Effect.flatMap(kernel.slot.sandbox.get, (sandbox) =>
          Scope.provide(Effect.flatMap(sandbox.run(command, CLOSED), said), scope),
        )

        const first = yield* run
        yield* kernel.runtime.add(other(seen))
        const second = yield* run
        return { first, second }
      }).pipe(Effect.orDie),
    )

    expect(found.first).toBe("from eva.shell")
    expect(found.second).toBe("from the second shell")
    expect(seen).toEqual([command])
  })

  // Nothing fills the Shell slot, so the Sandbox says no command can start
  // rather than pretending it started one.
  it("report that no command can start with the Shell slot empty", async () => {
    const fault = await withKernel([sandboxNone], (kernel, scope) =>
      Effect.flatMap(kernel.slot.sandbox.get, (sandbox) =>
        Scope.provide(Effect.flip(sandbox.run({ argv: ["node"] }, CLOSED)), scope),
      ).pipe(Effect.orDie),
    )

    expect(fault.reason).toBe("unavailable")
  })
})
