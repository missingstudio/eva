import type {
  Command,
  Exited,
  OutputChunk,
  Process,
  Sandbox,
  SandboxCapabilities,
  SandboxPolicy,
  ToolResult,
} from "@missingstudio/eva-core"
import { makeNoSandbox, sandboxNone } from "@missingstudio/eva-sandbox-none"
import type { ContentBlock, Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { makeShell, shell } from "@missingstudio/eva-shell"
import { withKernel } from "@missingstudio/eva-testkit"
import { runCommand, type CommandDeps } from "@missingstudio/eva-tool-bash"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The command tool over the real Shell and the real `eva.sandbox.none`. The
 * tool's own decisions are held beside it in `plugins/tool-bash`, over a
 * written Sandbox; what is here is the behaviour that needs a real process —
 * live output, a real exit, and a process that is dead after a timeout.
 *
 * A plugin may not import another plugin, so a suite that needs three of them
 * at once lives in this package.
 */

const LIMITS = { timeout: 30, maxOutput: 64_000 }

// A command that outlives every test, so a test never waits for one.
const WAITING = ["node", "-e", "setTimeout(() => {}, 30000)"]

const none = makeNoSandbox(Effect.succeed(makeShell()))

type Update = Extract<Payload, { kind: "tool_update" }>

const streamedOf = (said: readonly Payload[]): readonly Update[] =>
  said.filter(
    (payload): payload is Update => payload.kind === "tool_update" && payload.content !== undefined,
  )

const textOf = (content: readonly ContentBlock[]): string =>
  content.map((block) => (block.type === "text" ? block.text : "")).join("\n")

const contentOf = (outcome: ToolResult): string => textOf(outcome.content)

const streamed = (said: readonly Payload[]): string =>
  streamedOf(said)
    .map((payload) => textOf(payload.content ?? []))
    .join("")

/**
 * `eva.sandbox.none` with the Process it answered kept, so a test reads the
 * exit of a process the tool killed rather than taking the tool's word.
 */
const watching = () => {
  const started: Process[] = []
  const sandbox: Sandbox = {
    run: (command: Command, policy: SandboxPolicy) =>
      Effect.tap(none.run(command, policy), (process) =>
        Effect.sync(() => {
          started.push(process)
        }),
      ),
    capabilities: none.capabilities,
  }
  const ended: Effect.Effect<Exited | undefined> = Effect.suspend(
    () => started[0]?.exit ?? Effect.succeed(undefined),
  )
  return { sandbox, ended }
}

interface Ran {
  readonly outcome: ToolResult
  readonly said: readonly Payload[]
}

const ran = (args: unknown, over: Partial<CommandDeps> = {}): Promise<Ran> => {
  const said: Payload[] = []
  const call = {
    id: "call_1",
    args,
    emit: (payload: Payload) =>
      Effect.sync(() => {
        said.push(payload)
      }),
  }
  return Effect.runPromise(
    Effect.map(
      runCommand({ sandbox: Effect.succeed(none), ...LIMITS, ...over }, call),
      (outcome): Ran => ({ outcome, said }),
    ),
  )
}

/**
 * A second Sandbox filler, so the read of the Sandbox slot can be watched. It
 * contains nothing and starts nothing: what is under test is which filler
 * answered the next command.
 */
const other = (seen: Command[]) =>
  define({
    id: "acme.sandbox",
    effect: Effect.fn("acme.sandbox")(function* (ctx) {
      const spoken: OutputChunk = { stream: "stdout", text: "from the second sandbox" }
      const stub: Sandbox = {
        run: (command) =>
          Effect.sync(() => {
            seen.push(command)
            return {
              output: Stream.fromIterable([spoken]),
              exit: Effect.succeed({ code: 0, signal: null }),
              kill: Effect.void,
            } satisfies Process
          }),
        capabilities: Effect.succeed<SandboxCapabilities>({ enforces: ["filesystem"] }),
      }
      yield* ctx.slot.sandbox.provide(ctx.id, stub)
    }),
  })

describe("the command tool over the ground slots", () => {
  /**
   * Output reaches the Trace while the process is alive. The child speaks,
   * waits longer than one window, then speaks again — so a tool that gathered
   * everything and reported once could not pass this.
   */
  it("streams a real command's output as it runs", async () => {
    const found = await ran({
      command: ["node", "-e", "console.log('first'); setTimeout(() => console.log('second'), 400)"],
    })

    expect(streamedOf(found.said).length).toBeGreaterThan(1)
    expect(streamed(found.said)).toBe("first\nsecond\n")
  })

  /**
   * One record per chunk is a record count the operating system chooses, so
   * output is gathered per window instead. Five hundred lines are a handful of
   * records, not five hundred.
   */
  it("gathers a chatty command into few records", async () => {
    const found = await ran({
      command: ["node", "-e", "for (let i = 0; i < 500; i += 1) console.log('line ' + i)"],
    })

    expect(streamedOf(found.said).length).toBeLessThan(10)
    expect(contentOf(found.outcome)).toContain("line 499")
  })

  // A nonzero exit is a result, not a throw. stdout and stderr are one
  // stream, in arrival order, the way the Shell hands them over.
  it("carries a real exit code, and a nonzero exit is a result", async () => {
    const found = await ran({
      command: ["node", "-e", "console.log('out'); console.error('err'); process.exit(3)"],
    })

    expect(found.outcome.disposition).toBe("ok")
    expect(contentOf(found.outcome)).toContain("out")
    expect(contentOf(found.outcome)).toContain("err")
    expect(contentOf(found.outcome)).toContain("exit code 3")
  })

  it("reports a program the machine cannot start rather than failing the call", async () => {
    const found = await ran({ command: ["eva-no-such-program"] })

    expect(found.outcome.disposition).toBe("failed")
    expect(contentOf(found.outcome)).toContain("eva-no-such-program")
  })

  it("stops a real command that outlives its timeout, and the process is dead", async () => {
    const watcher = watching()
    const found = await ran(
      { command: WAITING },
      { sandbox: Effect.succeed(watcher.sandbox), timeout: 0.3 },
    )

    expect(found.outcome.disposition).toBe("failed")
    expect(contentOf(found.outcome)).toContain("ran longer than 0.3 seconds")
    expect(await Effect.runPromise(watcher.ended)).toEqual({ code: null, signal: "SIGTERM" })
  })

  /**
   * A cancelled Run interrupts the fiber the tool runs on. The Scope owns the
   * process, so it dies; there is no result to answer with, so one last
   * `tool_update` keeps the Trace from reading `in_progress` for ever.
   */
  it("kills a real process when the call is interrupted, and closes the record", async () => {
    const watcher = watching()
    const said: Payload[] = []
    const up = Deferred.makeUnsafe<void>()

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const running = yield* Effect.forkChild(
          runCommand(
            { sandbox: Effect.succeed(watcher.sandbox), ...LIMITS },
            {
              id: "call_1",
              args: { command: WAITING },
              emit: (payload) =>
                Effect.sync(() => {
                  said.push(payload)
                  if (payload.kind === "tool_update") Deferred.doneUnsafe(up, Effect.void)
                }),
            },
          ),
        )
        yield* Deferred.await(up)
        yield* Fiber.interrupt(running)
        return yield* watcher.ended
      }),
    )

    expect(found).toEqual({ code: null, signal: "SIGTERM" })
    expect(said.at(-1)).toEqual({ kind: "tool_update", id: "call_1", status: "failed" })
  })

  /**
   * The slot is read per command and never captured, over a live kernel: a
   * second filler takes the Sandbox slot while the kernel is up and the next
   * command lands on it. This is what lets stage 4's containment arrive with
   * no change to this call site.
   */
  it("reads the Sandbox slot again for each command", async () => {
    const seen: Command[] = []

    const found = await withKernel([shell, sandboxNone], (kernel) =>
      Effect.gen(function* () {
        const call = (id: string) =>
          runCommand(
            { sandbox: kernel.slot.sandbox.peek, ...LIMITS },
            {
              id,
              args: { command: ["node", "-e", "process.stdout.write('from eva.shell')"] },
              emit: () => Effect.void,
            },
          )

        const first = yield* call("call_1")
        yield* kernel.runtime.add(other(seen))
        const second = yield* call("call_2")
        return { first: contentOf(first), second: contentOf(second) }
      }),
    )

    expect(found.first).toContain("from eva.shell")
    expect(found.second).toContain("from the second sandbox")
    // The second filler enforces something, so the caveat is gone with it.
    expect(found.first).toContain("no containment")
    expect(found.second).not.toContain("no containment")
    expect(seen).toHaveLength(1)
  })
})
