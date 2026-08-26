import { SandboxError, type Sandbox, type Shell } from "@missingstudio/eva-core"
import { Effect } from "effect"

/**
 * The `Sandbox` slot with no containment. It starts the command exactly as
 * the Shell would, and `capabilities` names nothing — so a caller reports the
 * containment it has rather than assuming the seam gave it any.
 *
 * `shell` is the read of the Shell slot, not the Shell: every call reads it
 * again, so replacing the Shell reaches the next command and a stage-4
 * Sandbox drops in at the same call site.
 */
export const makeNoSandbox = (shell: Effect.Effect<Shell | undefined>): Sandbox => ({
  // The policy is not read. There is nothing here to enforce it with, and
  // `capabilities` is where that is said rather than in a quiet ignore.
  run: Effect.fn("eva.sandbox.none.run")(function* (command) {
    const found = yield* shell
    if (found === undefined) {
      return yield* new SandboxError({
        reason: "unavailable",
        message: "nothing fills the Shell slot, so no command can start",
      })
    }
    return yield* Effect.mapError(
      found.spawn(command),
      (cause) => new SandboxError({ reason: "spawn_failed", message: cause.message }),
    )
  }),

  capabilities: Effect.succeed({ enforces: [] }),
})
