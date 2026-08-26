import {
  ShellError,
  type Command,
  type Process,
  type SandboxError,
  type SandboxPolicy,
  type Shell,
} from "@missingstudio/eva-core"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeNoSandbox } from "./sandbox.js"

const CLOSED: SandboxPolicy = { readable: [], writable: [], network: false }

const command: Command = { argv: ["echo", "hello"] }

const nothing: Process = {
  output: Stream.empty,
  exit: Effect.succeed({ code: 0, signal: null }),
  kill: Effect.void,
}

const noting = (seen: Command[]): Shell => ({
  spawn: (one) =>
    Effect.sync(() => {
      seen.push(one)
      return nothing
    }),
})

const failure = (fault: ShellError): Shell => ({ spawn: () => Effect.fail(fault) })

describe("eva.sandbox.none", () => {
  it("names no control it enforces", async () => {
    const found = await Effect.runPromise(makeNoSandbox(Effect.succeed(undefined)).capabilities)

    expect(found).toEqual({ enforces: [] })
  })

  it("starts the command through the Shell, unchanged", async () => {
    const seen: Command[] = []
    await Effect.runPromise(
      Effect.scoped(makeNoSandbox(Effect.succeed(noting(seen))).run(command, CLOSED)),
    )

    expect(seen).toEqual([command])
  })

  /**
   * The slot is read on every call and never captured, so the Shell that
   * answers is the one filling the slot now. This is what lets stage 4 put a
   * real Sandbox behind the same call site.
   */
  it("reads the Shell slot again for each command", async () => {
    const first: Command[] = []
    const second: Command[] = []
    let holder = noting(first)
    const sandbox = makeNoSandbox(Effect.sync(() => holder))

    await Effect.runPromise(Effect.scoped(sandbox.run(command, CLOSED)))
    holder = noting(second)
    await Effect.runPromise(Effect.scoped(sandbox.run(command, CLOSED)))

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })

  it("reports that no command can start when nothing fills the Shell slot", async () => {
    const fault = (await Effect.runPromise(
      Effect.scoped(Effect.flip(makeNoSandbox(Effect.succeed(undefined)).run(command, CLOSED))),
    )) as SandboxError

    expect(fault.reason).toBe("unavailable")
  })

  it("carries a shell that could not start as a spawn failure", async () => {
    const shell = failure(new ShellError({ reason: "not_found", message: "echo: not found" }))
    const fault = (await Effect.runPromise(
      Effect.scoped(Effect.flip(makeNoSandbox(Effect.succeed(shell)).run(command, CLOSED))),
    )) as SandboxError

    expect(fault.reason).toBe("spawn_failed")
    expect(fault.message).toBe("echo: not found")
  })
})
