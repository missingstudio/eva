import { makeSessionAPI, type Build } from "@missingstudio/eva-boot"
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"
import { grantTrust, isTrusted, revokeTrust } from "@missingstudio/eva-kernel"
import { nearest } from "@missingstudio/eva-sdk"
import { Cause, Effect, Exit, Scope } from "effect"
import { parseArgv, showHelp } from "./argv.js"
import { BUILD } from "./plugins.js"
import { report } from "./report.js"
import { showConfig } from "./show.js"
import { runInteractive } from "./interactive.js"
import { runPrint } from "@missingstudio/eva-print"
import { resolveConfig, runHarness, startFrom, withSignals } from "./run.js"
import { fromProcess, type World } from "./world.js"

export * from "./argv.js"
export * from "./report.js"
export * from "./show.js"
export * from "./interactive.js"
export * from "./plugins.js"
export * from "./run.js"
export * from "./version.js"
export * from "./world.js"

/**
 * The composition root. The parser answers with one invocation and this
 * switches on it, so `--version` is answered before anything loads and a
 * kernel with every plugin disabled still starts, prints, and exits 0.
 *
 * Everything it reads from outside itself arrives in the World, so a test
 * drives every branch against a scratch directory. The build is a parameter
 * for the same reason: a test hands over one whose provider is scripted, so
 * the branches that run a model are reachable without a key.
 */
export const main = Effect.fn("cli.main")(function* (world: World, build: Build = BUILD) {
  const invocation = parseArgv(world)

  switch (invocation.kind) {
    // The help, the version, and every parse error already said their piece.
    case "answered":
      return invocation.code

    // The grant is the person's to give, so it is a verb they run rather than
    // a file a repository can ship. It answers before any config is read.
    case "untrust": {
      const target = yield* revokeTrust(world.cwd, world.env)
      world.out(
        isTrusted(target, world.env)
          ? `${target} is still trusted by a grant above it\n`
          : `${target} is no longer trusted\n`,
      )
      return 0
    }
    case "trust": {
      const target = yield* grantTrust(world.cwd, world.env)
      world.out(`${target} is trusted, and its .eva directory is read from now on\n`)
      return 0
    }

    // Answered from the config alone, so a config naming a plugin nobody has
    // still prints rather than failing to boot.
    case "showConfig": {
      const settled = yield* resolveConfig(invocation.overlays, world)
      report(settled, world)
      world.out(showConfig(settled))
      return 0
    }

    // The verb carries the selection, so a Workflow is never selected by a
    // file the Run does not name.
    case "run": {
      const settled = yield* resolveConfig(invocation.overlays, world)
      report(settled, world)

      const scope = yield* Scope.make()
      const started = yield* startFrom(scope, settled, build, world.err)

      // Refused before a Run is spent. The kernel refuses the same id again
      // as a failed Claim, so this check only buys the near miss.
      const rows = yield* started.kernel.domains.harness.get
      if (!rows.some((row) => row.id === invocation.harness)) {
        const meant = nearest(
          invocation.harness,
          rows.map((row) => row.id),
        )
        world.err(
          `eva: no harness answers ${invocation.harness}${meant === undefined ? "" : `, did you mean ${meant}?`}\n`,
        )
        yield* Scope.close(scope, Exit.void)
        return 1
      }

      const api = yield* makeSessionAPI(started.kernel, started.model, scope)
      const client = yield* makeClient(yield* localTransport(api.session))
      const answered = yield* withSignals(
        runHarness(client, {
          harness: invocation.harness,
          text: invocation.input,
          location: settled.location.directory,
        }),
      )
      yield* Scope.close(scope, Exit.void)

      // The last Run's text is the answer; the Runs before it are in the
      // Trace. A failed Workflow did not answer, so nothing reaches the
      // output stream a shell would read an artifact from.
      if (answered.claim.result === "done") {
        world.out(answered.text)
        return 0
      }
      const { claim } = answered
      world.err(
        `${claim.summary}${claim.errorClass === undefined ? "" : ` (${claim.errorClass})`}\n`,
      )
      return 1
    }

    case "interactive":
    case "print": {
      const settled = yield* resolveConfig(invocation.overlays, world)
      report(settled, world)

      const scope = yield* Scope.make()
      const started = yield* startFrom(scope, settled, build, world.err)

      // No prompt means the interactive surface. A build with none says so
      // rather than printing help and exiting as though it had run.
      if (invocation.kind === "interactive") {
        const outcome = yield* Effect.exit(withSignals(runInteractive(started)))
        yield* Scope.close(scope, Exit.void)
        if (Exit.isSuccess(outcome)) return 0
        world.err(`${Cause.squash(outcome.cause) as Error}\n`)
        showHelp(world)
        return 1
      }

      // The same Session API a Console calls, driven by the command line
      // instead of keys.
      const api = yield* makeSessionAPI(started.kernel, started.model, scope)
      const client = yield* makeClient(yield* localTransport(api.session))
      const printed = yield* withSignals(
        runPrint(client, invocation.prompt, {
          location: settled.location.directory,
          write: world.out,
        }),
      )
      world.out(`\n${printed.costLine}\n`)
      yield* Scope.close(scope, Exit.void)

      const { claim } = printed
      if (claim.result === "done") return 0

      // The Trace holds why a Run failed. So must the terminal, or the reader is
      // told only that something did not work.
      world.err(
        `${claim.summary}${claim.errorClass === undefined ? "" : ` (${claim.errorClass})`}\n`,
      )
      return 1
    }
  }
})

export const run = (args?: readonly string[]): Promise<number> =>
  Effect.runPromise(main(fromProcess(args)))
