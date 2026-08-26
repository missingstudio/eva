import { resolve } from "node:path"
import type { Command, Exited, Sandbox, SandboxPolicy } from "@missingstudio/eva-core"
import type { ContentBlock, Disposition, Payload, ToolStatus } from "@missingstudio/eva-schema"
import { Effect, Fiber, Stream } from "effect"

/**
 * How long output gathers before one `tool_update` carries it. A process
 * hands over chunks in whatever sizes the operating system chose, so one
 * record per chunk is a record count nothing can predict — a chatty command
 * would write thousands. One window is one record, and the window is short
 * enough that a reader still watches the command work.
 */
const WINDOW = 200
const CHUNKS = 512

export interface CommandLimits {
  // Seconds. The longest a command may run. A call may ask for less.
  readonly timeout: number
  // Characters of output the call carries. Past it nothing more is gathered.
  readonly maxOutput: number
}

export interface CommandDeps extends CommandLimits {
  /**
   * The read of the Sandbox slot, not a Sandbox: every call reads it again,
   * so the containment stage 4 fills the slot with arrives here with no
   * change to this call site.
   */
  readonly sandbox: Effect.Effect<Sandbox | undefined>
}

export interface CommandCall {
  // The call id every payload of this call joins on. Not an event id.
  readonly id: string
  readonly args: unknown
  readonly emit: (payload: Payload) => Effect.Effect<void>
  /**
   * Resolves when something stops the command. Absent means nothing does.
   * A stop is answered with a result that says `cancelled`; an interrupted
   * call has no result to answer with, so it says so in one last
   * `tool_update` and the Scope is what kills the process there.
   */
  readonly stop?: Effect.Effect<void>
}

export interface CommandOutcome {
  readonly disposition: Disposition
  readonly content: readonly ContentBlock[]
}

export interface CommandInput {
  readonly command: readonly string[]
  readonly cwd?: string
  readonly timeout?: number
}

const isWords = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((word) => typeof word === "string")

/**
 * The arguments, read. `command` is already-split words and this splits
 * nothing: the words that reach the Sandbox are the words a gate judged, and
 * two splitters that disagree is the hole a gate exists to close. A caller
 * that wants shell syntax names the shell itself — `["bash", "-c", line]` —
 * which is one opaque invocation to the gate, and it says so.
 */
export const readInput = (args: unknown): CommandInput | undefined => {
  if (typeof args !== "object" || args === null) return undefined
  const found = args as Record<string, unknown>
  const command = found["command"]
  if (!isWords(command) || command.length === 0) return undefined
  const cwd = found["cwd"]
  const asked = found["timeout"]
  return {
    command,
    ...(typeof cwd === "string" ? { cwd } : {}),
    ...(typeof asked === "number" && Number.isFinite(asked) && asked > 0 ? { timeout: asked } : {}),
  }
}

/**
 * What the command may reach.
 *
 * Reading is not where containment is won: a command runs a program from the
 * machine's own toolchain, so a narrow `readable` refuses every command
 * rather than containing one. Writing is where it is won, so the command may
 * write where it runs and nowhere else. The network stays open because most
 * commands fetch, and a stage-4 Sandbox that refused `git fetch` with nothing
 * said is harder to find than one that allowed it.
 *
 * Narrowing any of the three is `eva.tool.policy`'s decision and the mode's,
 * never this tool's. What is here is the widest policy that is still worth
 * enforcing.
 */
const policyOf = (input: CommandInput): SandboxPolicy => ({
  readable: ["/"],
  writable: [resolve(input.cwd ?? ".")],
  network: true,
})

const commandOf = (input: CommandInput): Command => ({
  argv: input.command,
  ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
})

const said = (text: string): ContentBlock => ({ type: "text", text })

const update = (call: CommandCall, status: ToolStatus): Payload => ({
  kind: "tool_update",
  id: call.id,
  status,
})

// A command that never started still ends as data the model can act on.
const refused = (call: CommandCall, why: string): Effect.Effect<CommandOutcome> =>
  Effect.as(call.emit(update(call, "failed")), { disposition: "failed", content: [said(why)] })

type Ending =
  | { readonly kind: "exited"; readonly exited: Exited }
  | { readonly kind: "timeout" }
  | { readonly kind: "stopped" }

// A nonzero exit is a result, not a failure of the call: the exit goes in the
// result content and the Run carries on.
const dispositionOf = (ending: Ending): Disposition => {
  switch (ending.kind) {
    case "exited":
      return "ok"
    case "timeout":
      return "failed"
    case "stopped":
      return "cancelled"
  }
}

const endingOf = (ending: Ending, seconds: number): string => {
  switch (ending.kind) {
    case "exited":
      return ending.exited.code === null
        ? `stopped by ${ending.exited.signal}`
        : `exit code ${ending.exited.code}`
    case "timeout":
      return `the command ran longer than ${seconds} seconds and was stopped`
    case "stopped":
      return "the command was cancelled and stopped"
  }
}

/**
 * Runs one command through the Sandbox slot and reports it.
 *
 * The Scope is its own, so the process is dead however the call ends —
 * including an interruption, which is what a cancelled Run does to the fiber
 * this runs on.
 */
export const runCommand = (deps: CommandDeps, call: CommandCall): Effect.Effect<CommandOutcome> =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = readInput(call.args)
      if (input === undefined) {
        return yield* refused(call, "the arguments name no command to run")
      }

      const sandbox = yield* deps.sandbox
      if (sandbox === undefined) {
        yield* call.emit({ kind: "degraded", missing: ["Sandbox"] })
        return yield* refused(call, "nothing fills the Sandbox slot, so no command can start")
      }

      // A call may ask for less time than the plugin allows and never more:
      // the option is the limit, not a suggestion the arguments may raise.
      const seconds =
        input.timeout === undefined ? deps.timeout : Math.min(input.timeout, deps.timeout)

      return yield* Effect.gen(function* () {
        const started = yield* sandbox.run(commandOf(input), policyOf(input))
        yield* call.emit(update(call, "in_progress"))

        let gathered = ""
        let dropped = false
        const pump = Stream.runForEach(
          Stream.groupedWithin(started.output, CHUNKS, WINDOW),
          (group) => {
            const whole = group.map((chunk) => chunk.text).join("")
            const room = deps.maxOutput - gathered.length
            const kept = whole.length > room ? whole.slice(0, room) : whole
            if (kept.length < whole.length) dropped = true
            if (kept === "") return Effect.void
            gathered += kept
            return call.emit({
              kind: "tool_update",
              id: call.id,
              status: "in_progress",
              content: [said(kept)],
            })
          },
        )
        const pumping = yield* Effect.forkChild(pump)

        const stopping: Effect.Effect<void> = call.stop ?? Effect.never
        const racing: readonly Effect.Effect<Ending>[] = [
          Effect.map(started.exit, (exited) => ({ kind: "exited", exited })),
          Effect.as(Effect.sleep(seconds * 1000), { kind: "timeout" }),
          Effect.as(stopping, { kind: "stopped" }),
        ]
        const ending = yield* Effect.raceAll(racing)

        if (ending.kind === "exited") {
          // The output queue ends before the exit resolves, so joining
          // drains what is left rather than waiting on a live process.
          yield* Fiber.join(pumping)
        } else {
          /**
           * The stop is not waited out. A process that ignores the signal
           * would hold the Run open for as long as it liked, and the fact
           * worth reporting is why the command was stopped rather than which
           * signal ended it.
           */
          yield* started.kill
          yield* Fiber.interrupt(pumping)
        }

        yield* call.emit(update(call, ending.kind === "exited" ? "completed" : "failed"))

        /**
         * What the Sandbox really enforced, not what the policy asked for.
         * `eva.sandbox.none` enforces nothing, so the result says so — the
         * caveat belongs beside the output the command produced without
         * containment, and it disappears on its own once a filler enforces
         * something.
         */
        const enforces = (yield* sandbox.capabilities).enforces
        const trailer = [
          endingOf(ending, seconds),
          ...(dropped ? [`output past ${deps.maxOutput} characters is not here`] : []),
          ...(enforces.length === 0
            ? ["nothing enforced the sandbox policy: the command ran with no containment"]
            : []),
        ]

        return {
          disposition: dispositionOf(ending),
          content: [...(gathered === "" ? [] : [said(gathered)]), said(trailer.join("\n"))],
        }
      }).pipe(Effect.catchTag("SandboxError", (fault) => refused(call, fault.message)))
    }),
  ).pipe(
    /**
     * A cancelled Run interrupts the fiber, which closes the Scope and kills
     * the process. There is no result to answer with, so the Trace hears the
     * call ended rather than reading `in_progress` for ever.
     */
    Effect.onInterrupt(() => call.emit(update(call, "failed"))),
  )
