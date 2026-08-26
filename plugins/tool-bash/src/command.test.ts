import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  SandboxError,
  type Command,
  type Exited,
  type OutputChunk,
  type Process,
  type Sandbox,
  type SandboxControl,
  type SandboxPolicy,
} from "@missingstudio/eva-core"
import type { ContentBlock, Payload } from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { runCommand, type CommandDeps, type CommandOutcome } from "./command.js"

/**
 * The tool's own decisions, over a written Sandbox: what argv and what policy
 * reach the seam, when the slot is read, and what each ending reports. The
 * same behaviour over the real Shell and the real `eva.sandbox.none` is held
 * in `packages/conformance/src/tool-bash.test.ts`, because a plugin may not
 * import another plugin.
 */

const LIMITS = { timeout: 30, maxOutput: 64_000 }

const OUT = (text: string): OutputChunk => ({ stream: "stdout", text })

interface Script {
  readonly chunks?: readonly OutputChunk[]
  // Absent means the process never ends on its own.
  readonly exited?: Exited
  readonly fault?: SandboxError
  readonly enforces?: readonly SandboxControl[]
}

const written = (script: Script = {}) => {
  const seen: { readonly command: Command; readonly policy: SandboxPolicy }[] = []
  let killed = 0
  const sandbox: Sandbox = {
    run: (command, policy) =>
      Effect.gen(function* () {
        if (script.fault !== undefined) return yield* script.fault
        seen.push({ command, policy })
        const kill = Effect.sync(() => {
          killed += 1
        })
        yield* Scope.addFinalizer(yield* Effect.scope, kill)
        return {
          output: Stream.fromIterable(script.chunks ?? []),
          exit: script.exited === undefined ? Effect.never : Effect.succeed(script.exited),
          kill,
        } satisfies Process
      }),
    capabilities: Effect.succeed({ enforces: script.enforces ?? [] }),
  }
  return { sandbox, seen, killed: () => killed }
}

type Update = Extract<Payload, { kind: "tool_update" }>

const updatesOf = (said: readonly Payload[]): readonly Update[] =>
  said.filter((payload): payload is Update => payload.kind === "tool_update")

const textOf = (content: readonly ContentBlock[]): string =>
  content.map((block) => (block.type === "text" ? block.text : "")).join("\n")

const contentOf = (outcome: CommandOutcome): string => textOf(outcome.content)

interface Ran {
  readonly outcome: CommandOutcome
  readonly said: readonly Payload[]
}

const ran = (
  sandbox: Sandbox | undefined,
  args: unknown,
  over: Partial<CommandDeps> = {},
  stop?: Effect.Effect<void>,
): Promise<Ran> => {
  const said: Payload[] = []
  const call = {
    id: "call_1",
    args,
    emit: (payload: Payload) =>
      Effect.sync(() => {
        said.push(payload)
      }),
    ...(stop === undefined ? {} : { stop }),
  }
  return Effect.runPromise(
    Effect.map(
      runCommand({ sandbox: Effect.succeed(sandbox), ...LIMITS, ...over }, call),
      (outcome): Ran => ({ outcome, said }),
    ),
  )
}

describe("eva.tool.bash", () => {
  // Arguments this tool cannot read start nothing. A string is not words, and
  // this tool splits none: the splitter that judges a shell line is the
  // gate's, and two splitters that disagree is the hole a gate closes.
  it.each<unknown>([{}, { command: [] }, { command: "node -v" }, "node -v"])(
    "refuses arguments that name no command: %j",
    async (args) => {
      const holder = written()
      const found = await ran(holder.sandbox, args)

      expect(found.outcome.disposition).toBe("failed")
      expect(holder.seen).toHaveLength(0)
    },
  )

  it("hands the words to the Sandbox unchanged", async () => {
    const holder = written({ exited: { code: 0, signal: null } })
    const argv = ["bash", "-c", "a && b"]

    await ran(holder.sandbox, { command: argv })

    expect(holder.seen[0]?.command.argv).toEqual(argv)
  })

  it("asks for the widest policy worth enforcing, writable where the command runs", async () => {
    const holder = written({ exited: { code: 0, signal: null } })
    const directory = mkdtempSync(join(tmpdir(), "eva-bash-"))

    await ran(holder.sandbox, { command: ["node", "-v"], cwd: directory })

    expect(holder.seen[0]?.policy).toEqual({
      readable: ["/"],
      writable: [resolve(directory)],
      network: true,
    })
  })

  /**
   * The slot is read on every call and never captured, so the Sandbox that
   * answers is the one filling the slot now. This is what lets stage 4's
   * containment arrive at this call site with no change to it.
   */
  it("reads the Sandbox slot again for each command", async () => {
    const first = written({ exited: { code: 0, signal: null } })
    const second = written({ exited: { code: 0, signal: null } })
    let holder = first.sandbox
    const reading = Effect.sync(() => holder)

    await ran(undefined, { command: ["node", "-v"] }, { sandbox: reading })
    holder = second.sandbox
    await ran(undefined, { command: ["node", "-v"] }, { sandbox: reading })

    expect(first.seen).toHaveLength(1)
    expect(second.seen).toHaveLength(1)
  })

  // An empty Slot is what `degraded` is for. There is no second record for
  // it, and the call still ends as data rather than as a throw.
  it("records the empty Sandbox slot as degraded", async () => {
    const found = await ran(undefined, { command: ["node", "-v"] })

    expect(found.said[0]).toEqual({ kind: "degraded", missing: ["Sandbox"] })
    expect(found.outcome.disposition).toBe("failed")
    expect(contentOf(found.outcome)).toContain("Sandbox slot")
  })

  it("reports a command the Sandbox could not start rather than failing the call", async () => {
    const holder = written({
      fault: new SandboxError({ reason: "spawn_failed", message: "no-such-program: not found" }),
    })
    const found = await ran(holder.sandbox, { command: ["no-such-program"] })

    expect(found.outcome.disposition).toBe("failed")
    expect(contentOf(found.outcome)).toContain("no-such-program: not found")
  })

  // A nonzero exit is a result, not a throw: the exit is in the content and
  // the call ended `ok`.
  it("carries the exit code in the result, and a nonzero exit is a result", async () => {
    const holder = written({ chunks: [OUT("out\n")], exited: { code: 3, signal: null } })
    const found = await ran(holder.sandbox, { command: ["node", "-v"] })

    expect(found.outcome.disposition).toBe("ok")
    expect(contentOf(found.outcome)).toContain("out\n")
    expect(contentOf(found.outcome)).toContain("exit code 3")
  })

  it("reports the signal when a signal ended the process", async () => {
    const holder = written({ exited: { code: null, signal: "SIGKILL" } })
    const found = await ran(holder.sandbox, { command: ["node", "-v"] })

    expect(contentOf(found.outcome)).toContain("stopped by SIGKILL")
  })

  it("says the call started, and says where it ended", async () => {
    const holder = written({ chunks: [OUT("done\n")], exited: { code: 0, signal: null } })
    const found = await ran(holder.sandbox, { command: ["node", "-v"] })
    const statuses = updatesOf(found.said).map((payload) => payload.status)

    expect(statuses[0]).toBe("in_progress")
    expect(statuses.at(-1)).toBe("completed")
  })

  it("stops gathering output past the limit and says so", async () => {
    const holder = written({ chunks: [OUT("x".repeat(100))], exited: { code: 0, signal: null } })
    const found = await ran(holder.sandbox, { command: ["node", "-v"] }, { maxOutput: 10 })
    const first = found.outcome.content[0]

    expect(first?.type === "text" ? first.text : "").toBe("x".repeat(10))
    expect(contentOf(found.outcome)).toContain("output past 10 characters is not here")
  })

  /**
   * The result reports the containment the command had, not the containment
   * the policy asked for. `eva.sandbox.none` enforces nothing and the caveat
   * says so; a filler that enforces something takes the caveat away.
   */
  it("says when nothing enforced the policy, and stops saying it when something does", async () => {
    const exited: Exited = { code: 0, signal: null }
    const nothing = await ran(written({ exited }).sandbox, { command: ["node", "-v"] })
    const held = await ran(written({ exited, enforces: ["filesystem"] }).sandbox, {
      command: ["node", "-v"],
    })

    expect(contentOf(nothing.outcome)).toContain("no containment")
    expect(contentOf(held.outcome)).not.toContain("no containment")
  })

  // How long a command may run is this plugin's policy, because the process
  // holds no limit of its own.
  it("stops a command that outlives its timeout and reports it", async () => {
    const holder = written()
    const found = await ran(holder.sandbox, { command: ["node", "-v"] }, { timeout: 0.2 })

    expect(found.outcome.disposition).toBe("failed")
    expect(contentOf(found.outcome)).toContain("ran longer than 0.2 seconds")
    expect(holder.killed()).toBeGreaterThan(0)
  })

  // The option is the limit and not a suggestion the arguments may raise.
  it("lets a call shorten the timeout and never lengthen it", async () => {
    const asking = await ran(
      written().sandbox,
      { command: ["node", "-v"], timeout: 30 },
      { timeout: 0.2 },
    )
    const shorter = await ran(
      written().sandbox,
      { command: ["node", "-v"], timeout: 0.2 },
      { timeout: 30 },
    )

    expect(contentOf(asking.outcome)).toContain("ran longer than 0.2 seconds")
    expect(contentOf(shorter.outcome)).toContain("ran longer than 0.2 seconds")
  })

  it("kills the process when it is stopped, and the result says cancelled", async () => {
    const holder = written()
    const found = await ran(holder.sandbox, { command: ["node", "-v"] }, {}, Effect.sleep(50))

    expect(found.outcome.disposition).toBe("cancelled")
    expect(contentOf(found.outcome)).toContain("cancelled and stopped")
    expect(holder.killed()).toBeGreaterThan(0)
  })

  /**
   * A cancelled Run interrupts the fiber the tool runs on. There is no result
   * to answer with, so the Scope kills the process and one last `tool_update`
   * keeps the Trace from reading `in_progress` for ever.
   */
  it("kills the process and closes the record when the call is interrupted", async () => {
    const holder = written()
    const said: Payload[] = []
    const up = Deferred.makeUnsafe<void>()

    await Effect.runPromise(
      Effect.gen(function* () {
        const running = yield* Effect.forkChild(
          runCommand(
            { sandbox: Effect.succeed(holder.sandbox), ...LIMITS },
            {
              id: "call_1",
              args: { command: ["node", "-v"] },
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
      }),
    )

    expect(holder.killed()).toBeGreaterThan(0)
    expect(said.at(-1)).toEqual({ kind: "tool_update", id: "call_1", status: "failed" })
  })
})
