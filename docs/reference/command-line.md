# The command line

This document owns Eva's command line: every command, every flag, how they are
parsed, and what each one exits with. [architecture.md](architecture.md) §10
owns the configuration order the flags feed. This document does not repeat it.

Two words, used consistently. A **flag** is `--name` or `--name <value>`.
Commander calls a flag an option; this document keeps the repository's word. A
**command** is a verb, like `trust`. Commander calls it a command too.

## 1. What changed, and what did not

`apps/cli/src/argv.ts` held a hand-written parser. It walked the arguments once,
read ten flags, and collected everything else into `unknown`. `HELP` was a
template string beside it. Commander replaced both.

The parser it replaced had earned three guarantees, and all three still hold:

1. **Nothing is silently ignored.** An unknown flag is named, with the near
   match. A stray word is told where a prompt goes.
2. **Nothing reads the process.** The World carries the arguments, the
   environment, the directory, and the two writers. Commander writes and exits
   through it, never around it.
3. **`--version` answers before anything loads.** A build with every plugin
   disabled still prints and exits 0.

Three limits went away with it:

- **It had no commands.** `--trust`, `--untrust`, and `--show-config` were verbs
  wearing flag clothes. Each new verb cost another `case` and another line of
  hand-written help.
- **It checked no arity.** `eva --print` with no prompt became an empty prompt
  and ran a turn against it. `eva --model` with no value became `undefined` and
  was dropped in silence.
- **It had no per-command help.** One string covered the whole surface, and a
  test asserted a substring of it.

That third limit is why this landed now rather than later.
[roadmap.md](../roadmap.md) already names six verbs the old parser could not
express: `eva serve --acp`, `eva auth status`, `eva plugin add`, `eva trace
show`, `eva harness list`, and `eva branch <session>@12`.

## 2. The surface

The three mode flags are commands.

```
eva                                 start the interactive surface
eva --print <prompt>                answer once and exit
eva --web                           run the page beside the terminal
eva run <name> [file]               run a workflow: one input in, the last Run's text out
eva serve --web                     serve the page that watches a Session
eva attach <url>                    drive a runtime another process serves, from this terminal
eva trust                           read this directory's .eva, and record the grant
eva untrust                         drop the grant for this directory
eva config show                     print the resolved config, and where each key came from
eva policy check [file]             validate a rule set, and name the fault in a malformed one
```

`eva run` names a harness row. A trailing `.yaml` or `.yml` is stripped before
the lookup, because `.eva/workflows/release-notes.yaml` is keyed by its base
name. The one input comes from one of three routes — `--input <file>`, the
positional file, or piped standard input — and two routes at once is a parse
error with both named. The Run that closed last is the answer: its text goes
to standard output on a `done` Claim and exits 0, and a failed Claim's summary
goes to standard error and exits 1.

`eva config` is a group, and `show` is the one thing in it. The group typed
bare answers with its own help on standard output and exits 0, exactly as
`eva config --help` does: asking what a group holds is a question, and only a
mistake is written where a failure is read.

`eva policy` is a group in the same shape, and `check` is the one thing in it.
It reads the rules under the `policy` key of a config file — `.eva/config.yaml`
when nothing names one, because that is the profile a run reads — and writes
one line per fault to standard error, each naming its place in the document.
It exits 1 when it found one and 0 when it did not, and nothing reaches
standard output on a fault, because a shell reads an artifact there. The rule
set is read while the command line is parsed, so a file nobody can read is a
parse error and the kernel never sees it.

It answers from the rule set alone: no kernel, no model, no Session. The faults
are `eva.tool.policy`'s to find and this command's to print, so CI and the gate
at `tool.execute.before` cannot disagree about what a malformed rule set is.

`eva serve` takes the posture as a flag: `--web` is the page that watches a
Session, and `--acp` at 9c is the next answer to "serve what". A serve that
names no posture is refused rather than defaulted, because a default would
start a surface nobody chose. The verb starts the `eva.web` row **by id** —
`eva` with no verb takes the first interactive surface, and that row is
registered after the terminal's, so registration order is what says a person
who typed `eva` gets the terminal. `--host` and `--port` ride the invocation and reach the
plugin through the build, because a surface row is started with a Client and
nothing else, so the bind is closed over when the plugin is made.

A local page binds to loopback, and a non-local `--host` is **refused** before
anything boots: a remote page needs a token, and stage 9b is what issues one.
The refusal names the reason and the stage, opens no port, and exits non-zero.
The rule is `eva.web`'s and the exit code is the app's — `SurfaceInfo.start`
has `never` in its error channel, so a refused bind cannot come out of a
surface row.

```
eva serve --web --host 0.0.0.0
  ← refused: a non-local bind needs a token, and tokens arrive at 9b
```

`eva --web` is the other arrangement of those two rows. One process holds the
terminal and the page, against one Session, so a request asked in the terminal
is answerable in the browser and the Trace shows one Session either way. The
flag names the `eva.web` row beside the interactive row the root already chose;
a row both of them name is started once; and the run ends when the terminal
ends, because a page holds nobody to end it. The build is rebuilt the way
`eva serve --web` rebuilds it, and the bind is refused by the same rule before
anything boots. `--host` or `--port` with no `--web` is refused rather than
passed over, and so is `--print --web`: an answer that exits serves no page.

A positional argument is safe under `eva run` and it is not safe at the root:
the verb is already named, so the positional cannot swallow a misspelled one.
The rule below about the bare prompt still holds where it was made.

Global flags. They are valid on every command, before it or after it:

| Flag                       | Repeatable | What it does                     |
| -------------------------- | ---------- | -------------------------------- |
| `--config <path>`          | yes        | overlay a config file            |
| `--model <provider/model>` | no         | set the model for this run       |
| `--plugin <id>`            | yes        | load a plugin for this run       |
| `--without-plugin <id>`    | yes        | skip a plugin for this run       |
| `-p, --print <prompt>`     | no         | answer once and exit             |
| `--web`                    | no         | run the page beside the terminal |
| `--host <host>`            | no         | the address the page binds       |
| `--port <port>`            | no         | the port the page binds          |
| `-v, --version`            | no         | print the version and exit       |
| `-h, --help`               | no         | print the help and exit          |

`--without-plugin` replaces `--no-plugin`. §8.1 says why the old spelling cannot
survive, and §9 says why nothing forwards it.

The prompt stays behind `--print`. It is not a bare argument, because a bare
argument swallows a misspelled verb: with `eva [prompt]` declared, `eva trsut`
is a valid prompt and goes to the model. §8.3 proves it.

### Room for the roadmap

These names are reserved. Nothing implements them yet, and this table is where
they land so two stages do not choose two shapes:

| Command                    | Stage                                    |
| -------------------------- | ---------------------------------------- |
| `eva serve --acp`          | 9c — Eva as an ACP agent                 |
| `eva auth status`          | already a plugin, no command yet         |
| `eva plugin add <package>` | 6.5 — extension distribution             |
| `eva trace show <run>`     | 6 — memory and trace                     |
| `eva trace publish <run>`  | 6 — the published Run                    |
| `eva harness list`         | 9c — harness adapters                    |
| `eva branch <session>@12`  | 6 — memory and trace                     |
| `eva top`                  | 9b — the fleet, needs-attention first    |
| `eva enroll create`        | mobile M0 — device grants, widened at 9b |
| `eva api schema`           | terminal C4 — the printable contract     |
| `eva mergeq status`        | 10 — the merge queue                     |
| `eva control up`           | S1 — a control plane, either posture     |
| `eva tenant export`        | S2 — tenancy with an exit door           |
| `eva billing invoice`      | S4 — one invoice per tenant              |
| `eva halt`                 | 14 · S5 — drain and freeze               |

`eva serve` takes the posture as a flag rather than as a verb per surface:
`--acp` and `--web` are two answers to "serve what", and a third surface adds
a third flag rather than a third verb. What starts a process is a flag, not a
Command — the same rule [context.md](../context.md) states for the Console.

A command named `plugin` and a flag named `--plugin` coexist. This is verified,
not assumed.

`eva run` was missing from this table, which is how Stage 1's own demo block
ended up with a verb nobody had designed. Write the next reserved verb down
here before its stage needs it.

### A plugin does not add a command

The command table is static, and the app owns it. A plugin cannot contribute a
command, because the command line is parsed before the kernel boots — that is
what makes `--version` answer with every plugin disabled.

So when a reserved verb needs a plugin, the app declares the verb and the plugin
implements the behaviour behind a slot or a Domain. `eva run` and `eva harness
list` read the harness Domain; neither is registered by a harness. A plugin that wants a verb of its own
registers a slash command in the command Domain, which
[architecture.md](architecture.md) §4.2 owns, and the surface runs it.

## 3. The rule: Commander parses, it does not act

An action handler records which command was named, and nothing else. The Effect
in `main` reads the record and acts.

```ts
root
  .command("trust")
  .description("read this directory's .eva, and record the grant")
  .action(() => {
    record({ kind: "trust" })
  })
```

Three reasons, in order of weight:

1. **`main` stays one Effect that returns an exit code.** An action handler that
   ran the work would run an Effect inside a callback. The Exit, the Scope, and
   the exit code would leave `main`, and `withSignals` would have nothing to
   interrupt.
2. **Parsing stays synchronous.** `parseArgv` keeps a unit test that needs no
   scratch directory and no kernel.
3. **Two exits never fight.** Commander exits the process; Effect returns a
   code. Only one may own the exit, and `apps/cli/src/eva.ts` already does.

## 4. The invocation

The parser answers with a discriminated union rather than a bag of flags. Each
member carries exactly what its branch needs.

```ts
export type Invocation =
  // The command line answered itself: the help, the version, or a parse error.
  | { readonly kind: "answered"; readonly code: number }
  | { readonly kind: "interactive"; readonly overlays: Overlays }
  | { readonly kind: "print"; readonly prompt: string; readonly overlays: Overlays }
  | { readonly kind: "showConfig"; readonly overlays: Overlays }
  | { readonly kind: "trust" }
  | { readonly kind: "untrust" }
  // The rule set is read here rather than in the branch, because a file
  // nobody can read is a parse error and the kernel never sees it.
  | { readonly kind: "policyCheck"; readonly source: string; readonly path: string }
  | {
      readonly kind: "run"
      // The harness row id, with any .yaml or .yml already stripped.
      readonly harness: string
      // The one input. Empty when nothing named one.
      readonly input: string
      readonly overlays: Overlays
    }
  | {
      readonly kind: "serve"
      readonly overlays: Overlays
      // Absent when the command line named none: the surface owns the
      // default, and a default in two places is two defaults.
      readonly host?: string
      readonly port?: number
    }
```

`Overlays` is the kernel's own type, so the parser produces what
`resolveConfiguration` consumes. `resolveConfig` used to map four `Argv` fields
into an `Overlays` by hand; it now passes the value through. One mapping is
gone, and with it the chance of the two shapes drifting apart.

`trust` and `untrust` carry no overlays on purpose. A grant is not configured.

The union also removes a state the old flags could reach: `--trust --untrust`
together was expressible, and the first branch won in silence.

## 5. Wiring Commander to the World

Commander writes to `process.stdout` and calls `process.exit`. Both are the
ambient reach the World exists to close. Two calls redirect them.

```ts
const program = (world: World, record: (invocation: Invocation) => void): Command => {
  const root = new Command("eva")
    .description("Eva is an open-source, autonomous software factory")
    .exitOverride()
    .configureOutput({
      writeOut: world.out,
      writeErr: world.err,
      outputError: (text, write) => write(text),
    })
    .showSuggestionAfterError()
    .allowExcessArguments()
    .version(VERSION, "-v, --version")
    .option("--config <path>", "overlay a config file; repeatable", collect)
    .option("--model <provider/model>", "set the model for this run")
    .option("--plugin <id>", "load a plugin for this run; repeatable", collect)
    .option("--without-plugin <id>", "skip a plugin for this run; repeatable", collect)
    .option("-p, --print <prompt>", "answer once and exit")
    .addHelpText("after", ENVIRONMENT)
  // …the actions follow, and each one only records.
  return root
}
```

`exitOverride` turns every exit into a thrown `CommanderError`, so `parseArgv`
catches it and answers with an invocation instead:

```ts
try {
  program(world, (invocation) => {
    seen = invocation
  }).parse(world.args, { from: "user" })
} catch (cause) {
  // Every exit arrives here, the help and the version included.
  if (cause instanceof CommanderError) return { kind: "answered", code: cause.exitCode }
  throw cause
}
```

`{ from: "user" }` is required. Without it Commander reads `args[0]` as the node
binary and `args[1]` as the script, and the World carries neither.

These are the codes Commander throws, verified against commander 15.0.0:

| Code                              | Exit code | When                         |
| --------------------------------- | --------- | ---------------------------- |
| `commander.version`               | 0         | `--version`                  |
| `commander.helpDisplayed`         | 0         | `--help`                     |
| `commander.unknownOption`         | 1         | a flag nothing declares      |
| `commander.optionMissingArgument` | 1         | `--print` with no prompt     |
| `commander.unknownCommand`        | 1         | a command nothing declares   |
| `commander.excessArguments`       | 1         | a stray word, unless allowed |

`main` needs none of them by name. It returns `invocation.code`.

### The environment block

Commander generates the help. It knows the flags and the commands; it does not
know the three environment variables, so `addHelpText("after", ENVIRONMENT)`
appends them. `HELP` is deleted. The help cannot fall out of step with the
flags now, because it is generated from them.

`showHelp(world)` writes that same generated help through `world.err`, which is
what the interactive branch prints when no surface plugin is loaded.

## 6. What main does

The order of the branches is load-bearing. `trust` answers before any config is
read, because the grant decides what may be read. `config show` answers after
resolution but before boot, because a config that names a plugin nobody has must
still print. `policy check` answers before either: the rule set is already in
the invocation, so it needs no resolution and no boot.

```ts
const invocation = parseArgv(world)

switch (invocation.kind) {
  case "answered":
    return invocation.code
  case "untrust":
  // …
  case "trust":
  // …
  case "showConfig":
  // …
  case "policyCheck":
  // …
  case "serve":
  // …
  case "interactive":
  case "print":
  // …
}
```

The switch is exhaustive, so a new command cannot be added without a branch that
answers it. The chain of `if` statements it replaced offered no such check.

## 7. What Commander does not do for us

`showSuggestionAfterError` covers flags and commands, at every depth:

```
error: unknown option '--show-conifg'
(Did you mean --show-config?)

error: unknown command 'shw'
(Did you mean show?)
```

It does not cover a stray word, and it cannot: `eva hello` is a word Commander
has no candidate for. It also stops suggesting commands once the root command
has an action handler, which the default interactive mode requires — §8.2 covers
that trade.

So `reportStray` lives in `argv.ts`, and keeps both of the old messages:

```ts
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
```

`nearest` is the SDK's, and the config key sweep already uses it. One suggestion
mechanism, two callers. `FLAGS` is deleted: Commander holds the flag names now,
and a hand-maintained list of them is a second source of truth that goes stale.

Every complaint about the command line comes out of `parseArgv`, because
Commander already writes its own through the World, and a second writer
somewhere else would order its lines against them by accident.

## 8. The traps

Each one below was run against commander 15.0.0. None is a guess.

### 8.1 `--no-plugin <id>` silently joins `--plugin`

Commander reads a `--no-` prefix as a negation and strips it to the same
attribute. So `--plugin` and `--no-plugin` write to the same key:

```
eva --plugin a --no-plugin b   →   { plugin: ["a", "b"] }
```

The plugin the person asked to drop is loaded instead, and nothing is said. This
is the exact failure the config key sweep exists to end, one level up.
Registering it as `new Option("--no-plugin <id>")` does not help: the negation is
decided by the flag string, not by how it is registered.

The flag is `--without-plugin <id>`. A test pins the two lists apart.

### 8.2 A root action costs the command suggestion

`eva` with no arguments starts the interactive surface, so the root command has
an action handler. With one attached, an unknown command is no longer a command
error:

```
eva trsut  without a root action  →  error: unknown command 'trsut'
                                     (Did you mean trust?)
eva trsut  with a root action     →  error: too many arguments. Expected 0 ...
```

Dropping the root action is not the fix, and it is not even available. Once a
command is registered, Commander needs the root action to reach the root at all.
Without one, both of these print the help to stderr and exit 1:

```
eva              →  commander.help, exit 1
eva --print hi   →  commander.help, exit 1
```

The second is fatal: the flags on the root become unreachable. So the root keeps
its action, calls `allowExcessArguments()`, and §7's `reportStray` makes the
suggestion. Suggestions inside a subcommand are unaffected — `eva config shw`
still answers `(Did you mean show?)`, because `config` has no action of its own.

### 8.3 A bare prompt swallows a misspelled verb

With `.argument("[prompt]")` declared on the root:

```
eva trust   →  the trust command      a command always wins over the argument
eva trsut   →  a prompt, sent to the model
```

The second line is a typo that costs money and says nothing. This is why the
prompt stays behind `--print`, and why §2 does not offer `eva "<prompt>"`.

### 8.4 `-v` is not Commander's default

Commander's default version flag is `-V`. Eva answers `-v`. The flags are passed
explicitly, or the short flag changes under people:

```ts
.version(VERSION, "-v, --version")
```

### 8.5 A repeatable flag needs a collector, and no default

Without the third argument, the last `--config` wins and the earlier ones are
dropped in silence. With a `[]` default, Commander prints `(default: [])` in the
help for every repeatable flag. The collector with no default gives clean help
and `undefined` when the flag is absent, which is what an optional `Overlays`
field wants.

### 8.6 `--print` with no prompt now fails

It used to become an empty prompt and run a turn. Commander refuses:

```
error: option '-p, --print <prompt>' argument missing
```

This is a behaviour change, and it is the point.

### 8.7 `--` does not protect a value

`eva --print -- -x` gives `--` to `--print` as its prompt, then fails on `-x`. A
prompt that starts with a dash is quoted, or given as `--print=<prompt>`. The
`=` form works for every flag that takes a value.

### 8.8 commander 15 wants a newer Node than the repository declared

`commander@15.0.0` declares `engines.node >= 22.12.0`. The root `package.json`
declared `>= 22`, then `>= 22.12`, and now `>= 22.13` — the last step is the
trace store's, because `node:sqlite` stopped needing a flag there. The other
choice was `commander@14`, which accepts Node 20; moving the floor is the
smaller change, and the toolchain already runs above it.

## 9. The old spellings are gone

`--show-config`, `--trust`, `--untrust`, and `--no-plugin` were not forwarded.
No deprecation, no alias, no warning.

The package is `private: true` at version `0.0.0`, nothing outside this
repository imports it, and no config file names a flag. There is no release to
be compatible with, so a shim would be scaffolding for zero users.

If a published release ever needs one, the shape is a rewrite of the argument
array before Commander sees it — one table, one pass, deleted in one commit:

```ts
const LEGACY: Readonly<Record<string, string>> = {
  "--show-config": "config show",
  "--trust": "trust",
  "--untrust": "untrust",
  "--no-plugin": "--without-plugin",
}
```

A rewrite rather than a hidden flag, because it forwards to the real surface and
so cannot drift from it.

## 10. Exit codes

| Code | When                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0    | the help, the version, a grant, `config show`, a rule set `policy check` read whole, a Run that ended `done`                        |
| 1    | a parse error, an unreadable config, a malformed rule set, a Run that ended any other way, or a serve this build has no surface for |
| 130  | the second Ctrl-C, which `withSignals` owns                                                                                         |

An unread config key does not change the exit code. It is a finding, written to
stderr, and the run continues.

## 11. Where it lives

| File                        | What it holds                                                  |
| --------------------------- | -------------------------------------------------------------- |
| `apps/cli/src/argv.ts`      | the program, `parseArgv`, `showHelp`, `Invocation`, `COMMANDS` |
| `apps/cli/src/index.ts`     | `main`, one branch per invocation                              |
| `apps/cli/src/run.ts`       | `resolveConfig` and `start`, both taking `Overlays`            |
| `apps/cli/src/serve.ts`     | `runServe`, which starts the `eva.web` row by id               |
| `apps/cli/src/surface.ts`   | `openClient` and `runSurface`: how every door opens a Session  |
| `apps/cli/src/argv.test.ts` | the parse, the messages, and the `--without-plugin` regression |
| `apps/cli/src/main.test.ts` | every branch of `main`, against a scratch directory            |

`Argv`, `FLAGS`, `HELP`, and `reportArgv` left the package's public surface.
Nothing outside the repository imported them.

`commander@15.0.0` was published on 2026-05-29, so it clears `bunfig.toml`'s
three-day `minimumReleaseAge` gate with no exception. It is MIT, it has no
dependencies of its own, it is ESM, and its typings are first-party.

## 12. How to land it

One logical change per commit, as [AGENTS.md](../../AGENTS.md) asks.

1. `build(cli): commander is a dependency, pinned in the catalog`
   The catalog entry, `apps/cli`'s dependency, and the Node floor.
2. `feat(cli): the command line is commander's, and the verbs are commands`
   `argv.ts`, `main`'s switch, `resolveConfig` taking `Overlays`, and both tests.
3. `docs: the command line reference describes every command and flag`
   This document, and its row in `docs/README.md`.

Splitting step 2 further is possible — the invocation union can land over the
old parser first, with no behaviour change — and it is worth doing if the review
wants the shape and the parser separated.

## 13. What we rejected

**Keeping the hand-written parser.** It was 120 lines and it worked. It had no
commands, no arity checking, and no per-command help, and the roadmap names six
verbs it could not express.

**Commander's action handlers doing the work.** They would run Effects inside
callbacks, and the Exit, the Scope, and the exit code would leave `main`.
Rejected in §3: parsing and acting stay separate.

**`@effect/cli`.** The closest call. The tree is Effect end to end, and
`@effect/cli` would give a typed parse inside the Effect world, with a wizard and
shell completions for free. It was rejected for now on two counts: it pulls
`@effect/platform` into the composition root, and it ties the command line to the
release-candidate cadence the repository already carries for `effect` itself. Its
parse is also an Effect, so "`--version` answers before anything loads" becomes
an argument to be made again rather than a fact. Worth revisiting when `effect`
leaves rc.

**yargs, citty, and cac.** None is disqualified. Commander wins on what this tree
needs: zero dependencies, MIT, first-party typings, generated help, and
suggestions for both flags and commands.

**A `-` prefix inside the value, as in `--plugin -eva.tui`.**
A decision record rejected that grammar for the config file. It would be
strange to resurrect it one layer up, where the flags mirror the config keys.
