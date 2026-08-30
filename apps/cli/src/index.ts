import type { Build } from "@missingstudio/eva-boot"
import { httpTransport } from "@missingstudio/eva-api/client"
import type { ConfigError } from "@missingstudio/eva-kernel"
import type { Claim } from "@missingstudio/eva-schema"
import { grantTrust, isTrusted, revokeTrust, type Overlays } from "@missingstudio/eva-kernel"
import { checkRules, sayFault, unreachableIn } from "@missingstudio/eva-tool-policy"
import { refusal } from "@missingstudio/eva-web"
import { Effect, Exit, Scope } from "effect"
import { parseArgv, showHelp } from "./argv.js"
import { runAttach } from "./attach.js"
import { attaching, BUILD, serving } from "./plugins.js"
import { report, speak } from "./report.js"
import { showConfig } from "./show.js"
import { runInteractive } from "./interactive.js"
import { runPrint } from "@missingstudio/eva-print"
import {
  resolveConfig,
  runHarness,
  startFrom,
  withSignals,
  type ResolvedConfig,
  type Started,
} from "./run.js"
import { runServe, WEB_DOOR } from "./serve.js"
import { closed, openClient } from "./surface.js"
import { fromProcess, type World } from "./world.js"

export * from "./argv.js"
export * from "./attach.js"
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
 * One door, opened and closed.
 *
 * What every door that needs a kernel does before it does its own work: read
 * the config the World names, say what the config sweep found, start the
 * plugins the config resolved to, and own the scope they live in. Four arms
 * spelled this and five of them closed the scope by hand — one of those on a
 * refusal path, and none of them on a body that failed.
 *
 * The scope closes however the body ends, an interrupt included, because a
 * surface is stopped by one and the plugins behind it still have to be let go.
 */
const door = <A>(
  world: World,
  overlays: Overlays,
  build: Build,
  body: (started: Started, settled: ResolvedConfig, scope: Scope.Scope) => Effect.Effect<A>,
): Effect.Effect<A, ConfigError> =>
  Effect.gen(function* () {
    const settled = yield* resolveConfig(overlays, world)
    report(settled, world)

    const scope = yield* Scope.make()
    const started = yield* startFrom(scope, settled, build, world.err)
    return yield* Effect.ensuring(body(started, settled, scope), Scope.close(scope, Exit.void))
  })

/**
 * What a Run that answered exits with. A Claim that failed says why on the
 * error stream, because the Trace holds the reason and so must the terminal —
 * a reader told only that something did not work has been told nothing.
 */
const exitOf = (claim: Claim, world: World): number => {
  if (claim.result === "done") return 0
  world.err(
    `${speak({ what: `${claim.summary}${claim.errorClass === undefined ? "" : ` (${claim.errorClass})`}` })}\n`,
  )
  return 1
}

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
      const read = checkRules(invocation.source)
      /**
       * A rule that can never fire is a fault of the file and not of the rule,
       * so it is found here beside the malformed ones. A run reads the same
       * file and goes on, because a rule that reaches nothing stops nothing.
       */
      const found = {
        ...read,
        faults: [...read.faults, ...unreachableIn(read.rules)],
      }
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
    case "run":
      /**
       * A name no harness answers is refused by the Session API, with the near
       * miss it already knows how to say. This door used to ask the same
       * question first, so the two spellings drifted — one ended in a question
       * mark and the other did not — and the only thing the second ask bought
       * was a Run that never opened.
       */
      return yield* door(world, invocation.overlays, build, (started, settled, scope) =>
        Effect.gen(function* () {
          const client = yield* openClient(started, scope)
          const answered = yield* withSignals(
            runHarness(client, {
              harness: invocation.harness,
              text: invocation.input,
              location: settled.location.directory,
            }),
          )

          // The last Run's text is the answer; the Runs before it are in the
          // Trace. A failed Workflow did not answer, so nothing reaches the
          // output stream a shell would read an artifact from.
          if (answered.claim.result === "done") world.out(answered.text)
          return exitOf(answered.claim, world)
        }),
      )

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
        world.err(`${speak({ what: refused })}\n`)
        return 1
      }

      return yield* door(
        world,
        invocation.overlays,
        serving(build, invocation, world.out),
        (started) =>
          Effect.map(Effect.exit(withSignals(runServe(started))), (outcome) =>
            closed(outcome, world.err),
          ),
      )
    }

    /**
     * No prompt means the interactive surface. A build with none says so
     * rather than printing help and exiting as though it had run.
     *
     * `--web` runs the page beside it, in this process and against this
     * Session — which is what lets a request asked in the terminal be
     * answered in the browser. The build is rebuilt exactly as `serve` rebuilds
     * it, because the raw `eva.web` entry has no writer, no bind, and no
     * `eva.api` wire: a page started from it would bind on the defaults, say
     * nothing, and answer no call. The bind is refused before anything boots,
     * for the reason it is refused there.
     */
    case "interactive": {
      const refused = refusal(invocation.host)
      if (refused !== undefined) {
        world.err(`${speak({ what: refused })}\n`)
        return 1
      }

      const page = invocation.web === true
      return yield* door(
        world,
        invocation.overlays,
        page ? serving(build, invocation, world.out) : build,
        (started) =>
          Effect.map(
            Effect.exit(withSignals(runInteractive(started, page ? [WEB_DOOR] : []))),
            (outcome) => closed(outcome, world.err, () => showHelp(world)),
          ),
      )
    }

    /**
     * The terminal, against a runtime another process serves — the same door
     * `eva` opens, reaching Eva over a socket instead of over this kernel.
     *
     * The wire is built before anything boots, because the build needs it: a
     * line typed here runs where the Domains are, and the terminal is rebuilt
     * around that as `serving` rebuilds the two halves of one port. A kernel
     * still starts, for the theme, the keymap and the renderer the person at
     * this terminal reads — those are facts of the process they sit at.
     *
     * No bind is refused here. This run opens no port: the one that was
     * refused, or not, is the serving process's, and it made that decision
     * when it bound.
     */
    case "attach": {
      const wire = yield* httpTransport({ origin: invocation.url })
      return yield* door(
        world,
        invocation.overlays,
        attaching(build, invocation.url, wire.command),
        (started) =>
          Effect.map(
            Effect.exit(withSignals(runAttach(started, wire, invocation.url))),
            (outcome) => closed(outcome, world.err, () => showHelp(world)),
          ),
      )
    }

    /**
     * The same Session API a Console calls, driven by the command line instead
     * of keys — and answered by the same default harness and the same gate,
     * because a Prompt means the same thing whichever door it came through.
     * Nothing here holds a person, so an `ask` is a denial that says nobody is
     * there.
     */
    case "print":
      return yield* door(world, invocation.overlays, build, (started, settled, scope) =>
        Effect.gen(function* () {
          const client = yield* openClient(started, scope)
          const printed = yield* withSignals(
            runPrint(client, invocation.prompt, {
              location: settled.location.directory,
              write: world.out,
            }),
          )
          world.out(`\n${printed.costLine}\n`)
          return exitOf(printed.claim, world)
        }),
      )
  }
})

export const run = (args?: readonly string[]): Promise<number> =>
  Effect.runPromise(main(fromProcess(args)))
