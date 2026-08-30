import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Overlays } from "@missingstudio/eva-kernel"
import { nearest } from "@missingstudio/eva-sdk"
import { DEFAULT_HOST, DEFAULT_PORT } from "@missingstudio/eva-web"
import { Command, CommanderError } from "commander"
import { PREFIX, speak } from "./report.js"
import { VERSION } from "./version.js"
import type { World } from "./world.js"

/**
 * What a run was asked to do. One member per branch of `main`, so a command
 * cannot be added without a branch that answers it, and `--trust --untrust`
 * together is no longer a state anything can be in.
 */
export type Invocation =
  // The command line answered itself: the help, the version, or a parse error.
  | { readonly kind: "answered"; readonly code: number }
  /**
   * `eva`, and with `--web` the page running beside the terminal. One process
   * holds both rows, so a request asked in the terminal is answerable in the
   * browser.
   *
   * The bind is spelled as the serve member spells it, because a page binds
   * the same way whichever door named it — and it is absent when the command
   * line named none, so the surface keeps the one default there is.
   */
  | {
      readonly kind: "interactive"
      readonly overlays: Overlays
      readonly web?: boolean
      readonly host?: string
      readonly port?: number
    }
  /**
   * `eva attach <url>`. The terminal, run against a runtime another process
   * serves. The address is read here rather than in the branch, because one
   * nothing can dial is a parse error and no kernel boots for it — the rule
   * `eva policy check` and `eva run`'s inputs both keep.
   */
  | { readonly kind: "attach"; readonly url: string; readonly overlays: Overlays }
  | { readonly kind: "print"; readonly prompt: string; readonly overlays: Overlays }
  | { readonly kind: "showConfig"; readonly overlays: Overlays }
  | { readonly kind: "trust" }
  | { readonly kind: "untrust" }
  /**
   * `eva policy check [file]`. The rule set is read here rather than in the
   * branch, because a file nobody can read is a parse error and the kernel
   * never sees it — the same rule `eva run`'s three input routes keep.
   */
  | { readonly kind: "policyCheck"; readonly source: string; readonly path: string }
  | {
      readonly kind: "run"
      // The harness row id, with any .yaml or .yml already stripped.
      readonly harness: string
      // The one input. Empty when nothing named one.
      readonly input: string
      readonly overlays: Overlays
    }
  /**
   * `eva serve --web`. The posture is a flag rather than a verb per surface,
   * so `--acp` at 9c adds a flag here and not a second verb — and until a
   * posture is named there is nothing to serve, so it is refused.
   *
   * The bind is absent when the command line named none: the surface owns the
   * default, and a default in two places is two defaults.
   */
  | {
      readonly kind: "serve"
      readonly overlays: Overlays
      readonly host?: string
      readonly port?: number
    }

// The verbs, for the suggestion a stray word gets.
export const COMMANDS: readonly string[] = [
  "attach",
  "config",
  "policy",
  "run",
  "serve",
  "trust",
  "untrust",
]

/**
 * The rule set `eva policy check` reads when nothing names one: the
 * repository's own profile. It is a config file because that is where a rule
 * set lives — the `policy` key of any layer a run reads — so CI checks the
 * file a run would read rather than one written for the check.
 */
export const DEFAULT_POLICY_FILE = ".eva/config.yaml"

// A repeatable flag keeps every value. Without this the last one wins.
const collect = (value: string, previous: readonly string[] = []): readonly string[] => [
  ...previous,
  value,
]

interface RootOptions {
  readonly config?: readonly string[]
  readonly model?: string
  readonly plugin?: readonly string[]
  readonly withoutPlugin?: readonly string[]
  readonly print?: string
  readonly web?: boolean
  readonly host?: string
  readonly port?: string
}

// The flags the kernel merges as one layer, in the shape it takes them.
const overlaysOf = (options: RootOptions): Overlays => ({
  ...(options.config === undefined ? {} : { config: options.config }),
  ...(options.model === undefined ? {} : { model: options.model }),
  ...(options.plugin === undefined ? {} : { plugin: options.plugin }),
  ...(options.withoutPlugin === undefined ? {} : { noPlugin: options.withoutPlugin }),
})

/**
 * A word no command and no flag took. Commander names a near flag and a near
 * command itself, but it has no candidate for a bare word, so this says where
 * a prompt goes rather than passing the word over in silence.
 */
const reportStray = (stray: readonly string[], world: World): void => {
  for (const word of stray) {
    const meant = nearest(word, COMMANDS)
    world.err(
      meant === undefined
        ? `${speak({ what: `nothing reads the argument "${word}"`, next: "a prompt goes after --print" })}\n`
        : `${speak({ what: `no command ${word}, did you mean ${meant}?` })}\n`,
    )
  }
}

/**
 * The one input a Workflow takes, from one of three routes: `--input <file>`,
 * a positional path, or piped standard input. Two routes at once is refused
 * with both named, and a file that cannot be read is refused with its path —
 * neither reaches the kernel. None of the three is the empty string, so a
 * Workflow whose Templates bind no `input` reference still runs.
 *
 * `command.error` throws, which is how every other parse error leaves here.
 */
const inputOf = (
  positional: string | undefined,
  flagged: string | undefined,
  command: Command,
  world: World,
): string => {
  const readInput = (path: string): string => {
    try {
      return readFileSync(resolve(world.cwd, path), "utf8")
    } catch {
      return command.error(`\`eva run\` cannot read ${path}`)
    }
  }

  const piped = world.stdin()
  const routes: { readonly name: string; readonly read: () => string }[] = []
  if (flagged !== undefined)
    routes.push({ name: `--input ${flagged}`, read: () => readInput(flagged) })
  if (positional !== undefined) {
    routes.push({ name: `the file ${positional}`, read: () => readInput(positional) })
  }
  if (piped !== undefined) routes.push({ name: "piped standard input", read: () => piped })

  if (routes.length > 1) {
    command.error(
      speak({
        what: "`eva run` takes one input",
        why: `it got ${routes.map((route) => route.name).join(" and ")}`,
      }),
    )
  }
  return routes[0]?.read() ?? ""
}

interface ServeOptions {
  readonly web?: boolean
  readonly host?: string
  readonly port?: string
}

/**
 * The port to bind, refused rather than coerced. `--port eight` reads as NaN,
 * and a NaN port binds a random one — which is a page at an address nobody
 * asked for.
 */
const portOf = (value: string | undefined, command: Command, where: string): number | undefined => {
  if (value === undefined) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port >= 0 && port <= 65535
    ? port
    : command.error(
        speak({ what: `\`${where}\` takes a port from 0 to 65535`, why: `it got ${value}` }),
      )
}

// The schemes a runtime is reachable at. `eva.web` binds a socket, so an
// address in any other spelling names something this cannot dial.
const REACHABLE: readonly string[] = ["http:", "https:"]

/**
 * The runtime `eva attach` dials, as an origin.
 *
 * Every call is built as the origin and a path, so what is kept is the origin
 * and a trailing slash goes. A word that is not an address is refused rather
 * than dialled: a run that boots a kernel and then cannot reach anything has
 * spent a person's time to say what the command line already knew.
 */
const runtimeAt = (value: string, command: Command): string => {
  let read: URL | undefined
  try {
    read = new URL(value)
  } catch {
    read = undefined
  }
  return read === undefined || !REACHABLE.includes(read.protocol)
    ? command.error(
        speak({
          what: "`eva attach` takes the address a runtime serves",
          why: `it got ${value}`,
          next: `an address reads like http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
        }),
      )
    : read.origin
}

/**
 * The page `eva --web` runs beside the terminal, and where it binds.
 *
 * A bind with no page to bind it is refused rather than passed over. `--port`
 * on its own names an address nothing is served at, and a person who asked
 * for one and was given silence has been told the page is there.
 */
const pageOf = (
  options: RootOptions,
  command: Command,
): { web?: boolean; host?: string; port?: number } => {
  const port = portOf(options.port, command, "eva")
  if (options.web !== true) {
    if (options.host !== undefined || port !== undefined) {
      command.error(
        speak({
          what: "`eva` binds --host and --port with --web",
          why: "on its own it serves no page",
        }),
      )
    }
    return {}
  }
  return {
    web: true,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(port === undefined ? {} : { port }),
  }
}

// The three variables the resolution order reads. Commander knows the flags
// and the commands; it does not know these.
const ENVIRONMENT = `
Environment
  EVA_CONFIG                 replace the path of the user config file, and
                             with it the trust record beside it
  EVA_CONFIG_DIR             read another directory like a .eva directory
  EVA_CONFIG_CONTENT         config read from the environment, over every file
`

/**
 * The command line, as commander describes it. It writes through the World and
 * throws rather than exiting, so nothing here reaches the process.
 *
 * An action records what was asked for and returns. It never does the work:
 * the Effect in `main` owns the Scope and the exit code, and a callback that
 * ran a Run would take both out of it.
 */
const program = (world: World, record: (invocation: Invocation) => void): Command => {
  const root = new Command("eva")
    .description("Eva is an open-source, autonomous software factory")
    .exitOverride()
    .configureOutput({
      writeOut: world.out,
      writeErr: world.err,
      /**
       * Every parse error, in the one voice. Commander words its own with an
       * `error:` marker and appends its suggestions on lines of their own;
       * both reach a person as one message under one prefix.
       */
      outputError: (text, write) =>
        write(
          text.startsWith(PREFIX)
            ? text
            : `${speak({ what: text.replace(/^error: /, "").trimEnd() })}\n`,
        ),
    })
    .showSuggestionAfterError()
    .allowExcessArguments()
    .version(VERSION, "-v, --version")
    .option("--config <path>", "overlay a config file", collect)
    .option("--model <provider/model>", "set the model for this run")
    .option("--plugin <id>", "load a plugin for this run", collect)
    .option("--without-plugin <id>", "skip a plugin for this run", collect)
    .option("-p, --print <prompt>", "answer once and exit")
    .option("--web", "run the page beside the terminal")
    .option("--host <host>", `the address the page binds, ${DEFAULT_HOST} by default`)
    .option("--port <port>", `the port the page binds, ${DEFAULT_PORT} by default`)
    .addHelpText("after", ENVIRONMENT)

  // No prompt means the interactive surface, so the root is what runs when
  // no verb is named.
  root.action((options: RootOptions, command: Command) => {
    reportStray(command.args, world)
    const overlays = overlaysOf(options)
    const page = pageOf(options, command)
    // A page has nobody to hold it open here: `--print` answers once and
    // exits, and a flag that is passed over reads as a flag that was honoured.
    if (options.print !== undefined && options.web === true) {
      command.error(
        speak({
          what: "`eva --print` answers once and exits",
          next: "`eva serve --web` is the page on its own",
        }),
      )
    }
    record(
      options.print === undefined
        ? { kind: "interactive", overlays, ...page }
        : { kind: "print", prompt: options.print, overlays },
    )
  })

  root
    .command("run")
    .description("run a workflow: one input in, the last Run's text out")
    .argument("<name>", "a harness row id; a trailing .yaml or .yml is stripped")
    .argument("[file]", "the one input, read from a file")
    .option("--input <file>", "the one input, read from a file")
    .action(
      (name: string, file: string | undefined, options: { input?: string }, command: Command) => {
        record({
          kind: "run",
          harness: name.replace(/\.ya?ml$/, ""),
          input: inputOf(file, options.input, command, world),
          overlays: overlaysOf(command.optsWithGlobals()),
        })
      },
    )

  root
    .command("attach")
    .description("run the terminal against a runtime another process serves")
    .argument("<url>", "the address that runtime printed when it bound")
    .action((url: string, _options: unknown, command: Command) => {
      record({
        kind: "attach",
        url: runtimeAt(url, command),
        overlays: overlaysOf(command.optsWithGlobals()),
      })
    })

  root
    .command("serve")
    .description("serve a surface: --web is the page that watches a Session")
    .option("--web", "serve the page that watches a Session")
    .option("--host <host>", `the address to bind, ${DEFAULT_HOST} by default`)
    .option("--port <port>", `the port to bind, ${DEFAULT_PORT} by default`)
    .action((_given: ServeOptions, command: Command) => {
      /**
       * Read through the globals, because the root spells these three flags
       * too: `eva --web` runs the page beside the terminal. Commander hands a
       * flag both levels declare to the root, and the merge finds it wherever
       * it landed — so the declarations above are what `eva serve --help` says
       * about them, and this is what reads them.
       */
      const options: ServeOptions = command.optsWithGlobals()
      // `--acp` is the next answer to "serve what", so a posture is named
      // rather than defaulted: a default would start a surface nobody chose.
      if (options.web !== true) command.error(speak({ what: "`eva serve` takes a posture: --web" }))
      const port = portOf(options.port, command, "eva serve")
      record({
        kind: "serve",
        overlays: overlaysOf(command.optsWithGlobals()),
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(port === undefined ? {} : { port }),
      })
    })

  root
    .command("trust")
    .description("read this directory's .eva, and record the grant")
    .action(() => {
      record({ kind: "trust" })
    })

  root
    .command("untrust")
    .description("drop the grant for this directory")
    .action(() => {
      record({ kind: "untrust" })
    })

  /**
   * Asking a command group what it holds is a question, not a mistake. Left
   * to commander a group with no action of its own writes its help where a
   * failure is read and exits 1, so `eva config` and `eva config --help`
   * printed the same bytes and disagreed about whether anything went wrong.
   */
  const config = root
    .command("config")
    .description("what a run would read")
    // An action of its own is what stops commander from complaining, and it
    // is also what drops the `help` subcommand a group gets for free, so the
    // group asks for it back.
    .helpCommand(true)
    .action(() => {
      config.outputHelp()
      record({ kind: "answered", code: 0 })
    })

  config
    .command("show")
    .description("print the resolved config, and where each key came from")
    .action((_options: RootOptions, command: Command) => {
      record({ kind: "showConfig", overlays: overlaysOf(command.optsWithGlobals()) })
    })

  // A group, for the reason `config` is one, and `check` is the one thing in
  // it. A plugin cannot add this verb: the command line is parsed before the
  // kernel boots, so the app declares the verb and the plugin holds the rules.
  const policy = root
    .command("policy")
    .description("the rules that decide a tool call")
    .helpCommand(true)
    .action(() => {
      policy.outputHelp()
      record({ kind: "answered", code: 0 })
    })

  policy
    .command("check")
    .description("validate a rule set; the fault is named and the exit is nonzero")
    .argument("[file]", `the config file holding the rules, ${DEFAULT_POLICY_FILE} by default`)
    .action((file: string | undefined, _options: unknown, command: Command) => {
      const path = resolve(world.cwd, file ?? DEFAULT_POLICY_FILE)
      let source: string
      try {
        source = readFileSync(path, "utf8")
      } catch {
        // `command.error` throws a CommanderError, which `parseArgv` turns
        // into an answered 1 — the route every parse error takes.
        return command.error(`\`eva policy check\` cannot read ${path}`)
      }
      record({ kind: "policyCheck", source, path })
    })

  return root
}

/**
 * Every complaint about the command line comes out of here. Commander writes
 * its own through the World, so a second writer somewhere else would order
 * its lines against them by accident.
 */
export const parseArgv = (world: World): Invocation => {
  let seen: Invocation = { kind: "interactive", overlays: {} }
  try {
    program(world, (invocation) => {
      seen = invocation
    }).parse(world.args, { from: "user" })
  } catch (cause) {
    // Every exit arrives here, the help and the version included.
    if (cause instanceof CommanderError) return { kind: "answered", code: cause.exitCode }
    throw cause
  }
  return seen
}

// The generated help, written where a failure is read.
export const showHelp = (world: World): void => {
  program(world, () => {}).outputHelp({ error: true })
}
