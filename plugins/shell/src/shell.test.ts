import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import type { Command, OutputChunk, Process, ShellError } from "@missingstudio/eva-core"
import { Effect, Exit, Option, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeShell } from "./shell.js"

const shell = makeShell()

// A scope of the test's own, because `spawn` binds the process to one.
const spawned = <A>(command: Command, body: (process: Process) => Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const process = yield* Scope.provide(shell.spawn(command), scope)
      const result = yield* body(process)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

const said = (chunks: readonly OutputChunk[], stream: "stdout" | "stderr") =>
  chunks
    .filter((chunk) => chunk.stream === stream)
    .map((chunk) => chunk.text)
    .join("")

const whole = (process: Process) =>
  Stream.runFold(
    process.output,
    () => "",
    (all, chunk) => all + chunk.text,
  )

const failing = (command: Command) =>
  Effect.runPromise(Effect.scoped(Effect.flip(shell.spawn(command)))) as Promise<ShellError>

describe("eva.shell", () => {
  it("streams stdout and stderr, then reports the exit", async () => {
    const found = await spawned(
      { argv: ["node", "-e", "console.log('out'); console.error('err')"] },
      (process) =>
        Effect.gen(function* () {
          const chunks = [...(yield* Stream.runCollect(process.output))]
          return { chunks, exit: yield* process.exit }
        }),
    )

    expect(said(found.chunks, "stdout")).toBe("out\n")
    expect(said(found.chunks, "stderr")).toBe("err\n")
    expect(found.exit).toEqual({ code: 0, signal: null })
  })

  /**
   * Output arrives while the process is alive, not once it is over. The child
   * writes its first line and then waits, so a `spawn` that answered only
   * when the process ended could not pass this.
   */
  it("hands out a chunk before the process ends", async () => {
    const found = await spawned(
      { argv: ["node", "-e", "console.log('first'); setTimeout(() => {}, 30000)"] },
      (process) =>
        Effect.gen(function* () {
          const first = yield* Stream.runCollect(Stream.take(process.output, 1))
          const early = yield* Effect.timeoutOption(process.exit, 10)
          yield* process.kill
          return { first: first[0]?.text, ended: Option.isSome(early) }
        }),
    )

    expect(found.first).toBe("first\n")
    expect(found.ended).toBe(false)
  })

  it("reports a signal when the process is killed", async () => {
    const found = await spawned(
      { argv: ["node", "-e", "setTimeout(() => {}, 30000)"] },
      (process) => Effect.andThen(process.kill, process.exit),
    )

    expect(found).toEqual({ code: null, signal: "SIGTERM" })
  })

  // A nonzero exit is a result, not a failure of the call.
  it("answers a nonzero exit as a result", async () => {
    const found = await spawned({ argv: ["node", "-e", "process.exit(3)"] }, (process) =>
      Effect.andThen(Stream.runDrain(process.output), process.exit),
    )

    expect(found).toEqual({ code: 3, signal: null })
  })

  it("starts the process where the command says", async () => {
    const directory = mkdtempSync(join(tmpdir(), "eva-shell-"))
    const found = await spawned(
      { argv: ["node", "-e", "process.stdout.write(process.cwd())"], cwd: directory },
      whole,
    )

    expect(basename(found)).toBe(basename(directory))
  })

  it("adds what the command names to the environment", async () => {
    const found = await spawned(
      {
        argv: ["node", "-e", "process.stdout.write(String(process.env.EVA_TEST_WORD))"],
        env: { EVA_TEST_WORD: "spoken" },
      },
      whole,
    )

    expect(found).toBe("spoken")
  })

  it("fails rather than answering a process the machine has no program for", async () => {
    expect((await failing({ argv: ["eva-no-such-program"] })).reason).toBe("not_found")
  })

  it("fails when the command names no program", async () => {
    expect((await failing({ argv: [] })).reason).toBe("not_found")
  })
})
