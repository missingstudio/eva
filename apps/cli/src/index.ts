import type { Build } from "@missingstudio/eva-boot"
import { httpTransport } from "@missingstudio/eva-api/client"
import type { ConfigError } from "@missingstudio/eva-kernel"
import type { Claim } from "@missingstudio/eva-schema"
import { errorWords } from "@missingstudio/eva-session-view"
import { grantTrust, isTrusted, revokeTrust, type Overlays } from "@missingstudio/eva-kernel"
import { checkRules, sayFault, unreachableIn } from "@missingstudio/eva-tool-policy"
import { refusal } from "@missingstudio/eva-web"
import { Effect, Exit, Logger, LogLevel, References, Scope, Tracer } from "effect"
import { parseArgv, showHelp } from "./argv.js"
import { runAttach } from "./attach.js"
import { attaching, besideTerminal, BUILD, serving, type WebBind } from "./plugins.js"
import { report, speak } from "./report.js"
import { showConfig, showConfigJson } from "./show.js"
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
 * A door that runs a Surface: the bind it asked for, the build it needs, the
 * run it opens, and the help it offers on the way out.
 *
 * Three doors answered a Surface and each spelled the same four steps — refuse
 * the bind, rebuild the table, open the door, word the exit — and two of them
 * spelled the refusal word for word. A fourth Surface door is now a row rather
 * than a fourth copy.
 *
 * The build is a call and not a value, so nothing is assembled for a run whose
 * bind is refused: a bind nobody can authenticate opens no port and builds no
 * table either.
 */
interface SurfaceDoor {
  /**
   * The bind this run asked for, when it binds one. A door that binds nothing
   * names none — an attached run opens no port, and the bind that was refused,
   * or not, is the serving process's and was decided when it bound.
   */
  readonly bind?: WebBind
  readonly build: () => Build
  readonly run: (started: Started) => Effect.Effect<unknown, unknown>
  // A door that offers the help passes it; the one that does not passes
  // nothing.
  readonly help?: () => void
}

/**
 * The door, opened. The bind is refused before anything boots — `eva.web` owns
 * what counts as local and this owns the exit code, because a surface row
 * cannot fail: `start` has `never` in its error channel.
 *
 * How the run ends is `closed`'s: an interrupt is how a person stops a
 * surface, so it exits 0 and says nothing, and a failure is this build having
 * no such surface, which the door names.
 */
const openSurface = (
  world: World,
  overlays: Overlays,
  one: SurfaceDoor,
): Effect.Effect<number, ConfigError> => {
  const refused = one.bind === undefined ? undefined : refusal(one.bind.host)
  if (refused !== undefined) {
    world.err(`${speak({ what: refused })}\n`)
    return Effect.succeed(1)
  }

  return door(world, overlays, one.build(), (started) =>
    Effect.map(Effect.exit(withSignals(one.run(started))), (outcome) =>
      closed(outcome, world.err, one.help),
    ),
  )
}

/**
 * What a Run that answered exits with. A Claim that failed says why on the
 * error stream, because the Trace holds the reason and so must the terminal —
 * a reader told only that something did not work has been told nothing.
 *
 * The class is worded rather than printed. `errorWords` is the one table the
 * transcript and the page already read, so a person who reads a failure here
 * reads the same two sentences they would read at any other door — and the
 * class stays beside the summary, because that is the word a bug report
 * carries. Nothing reaches standard output: a pipe's answer is the answer.
 */
const exitOf = (claim: Claim, world: World): number => {
  if (claim.result === "done") return 0
  const words = claim.errorClass === undefined ? undefined : errorWords(claim.errorClass)
  world.err(
    `${speak({
      what: `${claim.summary}${claim.errorClass === undefined ? "" : ` (${claim.errorClass})`}`,
      ...(words === undefined ? {} : { why: words.means, next: words.next }),
    })}\n`,
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
      // The findings stay on the error stream in both modes, so `--json`
      // leaves one object on standard output and nothing else.
      world.out(invocation.json === true ? showConfigJson(settled) : showConfig(settled))
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
        world.err(`${speak({ what: `${invocation.path}: ${sayFault(fault)}` })}\n`)
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
       * The page's own words, in this app's voice. `eva.web` owns what is
       * said — where it bound, a bind it refused, a page nobody built — and
       * `speak` owns the shape every line this app says to a person is read
       * in. A plugin may not import an app, so the app speaks for it here.
       *
       * The terminal's door does not: `besideTerminal` puts the same words in
       * the notice area, where the whole screen is already Eva and a prefix
       * on every line would be noise.
       */
      const spoken = (text: string): void => world.out(`${speak({ what: text.trimEnd() })}\n`)

      return yield* openSurface(world, invocation.overlays, {
        bind: invocation,
        build: () => serving(build, invocation, spoken),
        run: runServe,
      })
    }

    /**
     * No prompt means the interactive surface. A build with none says so
     * rather than printing help and exiting as though it had run.
     *
     * `--web` runs the page beside it, in this process and against this
     * Session — which is what lets a request asked in the terminal be
     * answered in the browser. The build is rebuilt as `serve` rebuilds it,
     * because the raw `eva.web` entry has no writer, no bind, and no
     * `eva.api` wire: a page started from it would bind on the defaults, say
     * nothing, and answer no call. One thing differs: what the page says goes
     * to the terminal's notice area, because this door draws over standard
     * output. The bind is refused before anything boots, for the reason it is
     * refused there.
     */
    case "interactive": {
      const page = invocation.web === true
      return yield* openSurface(world, invocation.overlays, {
        // Whether the page runs or not. A run with no `--web` carries no host
        // — the parser refuses `--host` without it — so this is the bind the
        // page asked for, or the default, which is local and refuses nothing.
        bind: invocation,
        build: () => (page ? besideTerminal(build, invocation) : build),
        run: (started) => runInteractive(started, page ? [WEB_DOOR] : []),
        help: () => showHelp(world),
      })
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
      return yield* openSurface(world, invocation.overlays, {
        build: () => attaching(build, invocation.url, wire.command),
        run: (started) => runAttach(started, wire, invocation.url),
        help: () => showHelp(world),
      })
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
          /**
           * Cost is commentary and the answer is the artifact, so the two
           * leave on different streams: `eva -p "x" | cat` emits the answer
           * alone. It speaks in the one voice, because on a terminal it lands
           * under the answer and a reader tells them apart by the prefix.
           */
          world.err(`\n${speak({ what: printed.costLine })}\n`)
          return exitOf(printed.claim, world)
        }),
      )
  }
})

/**
 * The level `EVA_LOG` names, or nothing when it names none. The names are
 * Effect's own, in any case: all, trace, debug, info, warn, error, fatal,
 * none. A value that names no level leaves the run as it was.
 */
const levelOf = (asked: string | undefined): LogLevel.LogLevel | undefined =>
  LogLevel.values.find((level) => level.toLowerCase() === asked?.toLowerCase())

/**
 * A tracer that says each span as it ends. Nearly every function in the tree
 * is an `Effect.fn("…")`, so this is the call tree of a run, said innermost
 * first as it unwinds. It writes to the error stream, because standard output
 * is the answer.
 */
const saying = (err: World["err"]): Tracer.Tracer => {
  class Said extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      super.end(endTime, exit)
      const took = Number(endTime - this.startTime) / 1e6
      err(
        `${speak({ what: `${this.name} ${took.toFixed(1)}ms${Exit.isFailure(exit) ? " failed" : ""}` })}\n`,
      )
    }
  }
  return Tracer.make({ span: (options) => new Said(options) })
}

/**
 * The run, with what `EVA_LOG` asked for over it. The level says what is
 * logged and sends it to the error stream; a level of debug or finer opens
 * the spans as well, because a span is a detail.
 */
const watched = <A, E>(
  run: Effect.Effect<A, E>,
  level: LogLevel.LogLevel,
  err: World["err"],
): Effect.Effect<A, E> => {
  const logged = run.pipe(
    Effect.provideService(References.MinimumLogLevel, level),
    Effect.provideService(Logger.LogToStderr, true),
  )
  return LogLevel.isLessThanOrEqualTo(level, "Debug")
    ? Effect.withTracer(logged, saying(err))
    : logged
}

/**
 * Every door into Eva. The published binary calls this, and so does the
 * workspace entry, so `EVA_LOG` is read once here and reaches both.
 */
export const run = (args?: readonly string[]): Promise<number> => {
  const world = fromProcess(args)
  const level = levelOf(world.env["EVA_LOG"])
  return Effect.runPromise(
    level === undefined ? main(world) : watched(main(world), level, world.err),
  )
}
