import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Overlays } from "@missingstudio/eva-kernel"
import { nearest } from "@missingstudio/eva-sdk"
import { Command, CommanderError } from "commander"
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
  | { readonly kind: "interactive"; readonly overlays: Overlays }
  | { readonly kind: "print"; readonly prompt: string; readonly overlays: Overlays }
  | { readonly kind: "showConfig"; readonly overlays: Overlays }
  | { readonly kind: "trust" }
  | { readonly kind: "untrust" }
  | {
      readonly kind: "run"
      // The harness row id, with any .yaml or .yml already stripped.
      readonly harness: string
      // The one input. Empty when nothing named one.
      readonly input: string
      readonly overlays: Overlays
    }

// The verbs, for the suggestion a stray word gets.
export const COMMANDS: readonly string[] = ["config", "run", "trust", "untrust"]

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
        ? `eva: nothing reads the argument "${word}", a prompt goes after --print\n`
        : `eva: no command ${word}, did you mean ${meant}?\n`,
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
      return command.error(`eva run cannot read ${path}`)
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
      `eva run takes one input; it got ${routes.map((route) => route.name).join(" and ")}`,
    )
  }
  return routes[0]?.read() ?? ""
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
    .description("Eva is an open-source, AI-native software factory")
    .exitOverride()
    .configureOutput({
      writeOut: world.out,
      writeErr: world.err,
      outputError: (text, write) => write(text),
    })
    .showSuggestionAfterError()
    .allowExcessArguments()
    .version(VERSION, "-v, --version")
    .option("--config <path>", "overlay a config file", collect)
    .option("--model <provider/model>", "set the model for this run")
    .option("--plugin <id>", "load a plugin for this run", collect)
    .option("--without-plugin <id>", "skip a plugin for this run", collect)
    .option("-p, --print <prompt>", "answer once and exit")
    .addHelpText("after", ENVIRONMENT)

  // No prompt means the interactive surface, so the root is what runs when
  // no verb is named.
  root.action((options: RootOptions, command: Command) => {
    reportStray(command.args, world)
    const overlays = overlaysOf(options)
    record(
      options.print === undefined
        ? { kind: "interactive", overlays }
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

  root
    .command("config")
    .description("what a run would read")
    .command("show")
    .description("print the resolved config, and where each key came from")
    .action((_options: RootOptions, command: Command) => {
      record({ kind: "showConfig", overlays: overlaysOf(command.optsWithGlobals()) })
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
