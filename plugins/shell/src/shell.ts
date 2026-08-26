import { spawn as spawnProcess, type ChildProcess, type SpawnOptions } from "node:child_process"
import {
  ShellError,
  type Command,
  type Exited,
  type OutputChunk,
  type Process,
  type Shell,
} from "@missingstudio/eva-core"
import { Deferred, Effect, Queue, Scope, Stream, type Cause } from "effect"

const optionsOf = (command: Command): SpawnOptions => ({
  stdio: ["ignore", "pipe", "pipe"],
  ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
  ...(command.env === undefined ? {} : { env: { ...process.env, ...command.env } }),
})

/**
 * Starts the process and waits for it to be running. Node reports a program
 * it cannot start asynchronously, so a spawn that answered at once would hand
 * back a Process that was never alive.
 *
 * The output handlers are attached before the wait, so the first chunk is
 * queued whatever order the events arrive in.
 */
const started = (
  command: Command,
  program: string,
  output: Queue.Queue<OutputChunk, Cause.Done>,
  ended: Deferred.Deferred<Exited>,
) =>
  Effect.callback<ChildProcess, ShellError>((resume) => {
    const child = spawnProcess(program, command.argv.slice(1), optionsOf(command))
    let answered = false

    child.stdout?.on("data", (data: Buffer) =>
      Queue.offerUnsafe(output, { stream: "stdout", text: String(data) }),
    )
    child.stderr?.on("data", (data: Buffer) =>
      Queue.offerUnsafe(output, { stream: "stderr", text: String(data) }),
    )
    // `close` follows the last chunk, so the queue ends with nothing left.
    child.once("close", (code, signal) => {
      Queue.endUnsafe(output)
      Deferred.doneUnsafe(ended, Effect.succeed({ code, signal }))
    })

    child.once("spawn", () => {
      if (answered) return
      answered = true
      resume(Effect.succeed(child))
    })
    // `error` also fires on a failed kill, long after the spawn answered.
    child.once("error", (cause: NodeJS.ErrnoException) => {
      if (answered) return
      answered = true
      Queue.endUnsafe(output)
      resume(
        Effect.fail(
          new ShellError({
            reason: cause.code === "ENOENT" ? "not_found" : "spawn_failed",
            message: `${program}: ${cause.message}`,
          }),
        ),
      )
    })
  })

/**
 * The `Shell` slot over the machine's own processes. Output is queued as it
 * arrives and the exit is reported whole, so a caller reads a running process
 * and a finished one the same way.
 */
export const makeShell = (): Shell => ({
  spawn: Effect.fn("eva.shell.spawn")(function* (command: Command) {
    const program = command.argv[0]
    if (program === undefined) {
      return yield* new ShellError({
        reason: "not_found",
        message: "the command names no program",
      })
    }

    const output = yield* Queue.unbounded<OutputChunk, Cause.Done>()
    const ended = Deferred.makeUnsafe<Exited>()
    const child = yield* started(command, program, output, ended)

    const kill = Effect.sync(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
    })
    // The Scope owns the process: one still running when the Run ends is not
    // left behind.
    yield* Scope.addFinalizer(yield* Effect.scope, kill)

    return {
      output: Stream.fromQueue(output),
      exit: Deferred.await(ended),
      kill,
    } satisfies Process
  }),
})
