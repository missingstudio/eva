import type { Build } from "@missingstudio/eva-boot"
import { grantTrust, isTrusted, revokeTrust } from "@missingstudio/eva-kernel"
import { nearest } from "@missingstudio/eva-sdk"
import { checkRules, sayFault } from "@missingstudio/eva-tool-policy"
import { refusal } from "@missingstudio/eva-web"
import { Effect, Exit, Scope } from "effect"
import { parseArgv, showHelp } from "./argv.js"
import { BUILD, serving } from "./plugins.js"
import { report } from "./report.js"
import { showConfig } from "./show.js"
import { interacted, runInteractive } from "./interactive.js"
import { runPrint } from "@missingstudio/eva-print"
import { resolveConfig, runHarness, startFrom, withSignals } from "./run.js"
import { runServe, served } from "./serve.js"
import { openClient } from "./surface.js"
import { fromProcess, type World } from "./world.js"

export * from "./argv.js"
export * from "./report.js"
export * from "./show.js"
export * from "./interactive.js"
export * from "./plugins.js"
export * from "./run.js"
export * from "./serve.js"
export * from "./surface.js"
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

    /**
     * Answered from the rule set alone: no kernel, no model, no Session. The
     * faults are the policy plugin's to find and this branch's to print, so
     * `eva policy check` in CI and the gate at `tool.execute.before` cannot
     * disagree about what a malformed rule set is.
     */
    case "policyCheck": {
      const found = checkRules(invocation.source)
      if (found.faults.length === 0) {
        const count = found.rules.length
        world.out(
          count === 0
            ? `${invocation.path} sets no policy rules\n`
            : `${invocation.path} holds ${count} policy rule${count === 1 ? "" : "s"}, and every one is well formed\n`,
        )
        return 0
      }
      // Nothing reaches standard output: a shell reads an artifact there.
      for (const fault of found.faults) {
        world.err(`eva: ${invocation.path}: ${sayFault(fault)}\n`)
      }
      return 1
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

      const client = yield* openClient(started, scope)
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

    /**
     * The verb names the surface, so the row is started by id rather than by
     * the rule that picks the first interactive one. The bind and the writer
     * reach the plugin through the build, because a surface row is started
     * with a Client and nothing else.
     */
    case "serve": {
      /**
       * Refused before anything boots, so a bind that needs a token opens no
       * port. `eva.web` owns the rule — what counts as local, and why stage
       * 9b changes it — and this owns the exit code, because a surface row
       * cannot fail: `start` has `never` in its error channel.
       */
      const refused = refusal(invocation.host)
      if (refused !== undefined) {
        world.err(`${refused}\n`)
        return 1
      }

      const settled = yield* resolveConfig(invocation.overlays, world)
      report(settled, world)

      const scope = yield* Scope.make()
      const started = yield* startFrom(
        scope,
        settled,
        serving(build, invocation, world.out),
        world.err,
      )
      const outcome = yield* Effect.exit(withSignals(runServe(started)))
      yield* Scope.close(scope, Exit.void)
      return served(outcome, world.err)
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
        return interacted(outcome, world.err, () => showHelp(world))
      }

      // The same Session API a Console calls, driven by the command line
      // instead of keys — and answered by the same default harness and the
      // same gate, because a Prompt means the same thing whichever door it
      // came through. Nothing here holds a person, so an `ask` is a denial
      // that says nobody is there.
      const client = yield* openClient(started, scope)
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
