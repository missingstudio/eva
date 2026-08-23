# @missingstudio/eva

Eva is an open-source, AI-native software factory: a terminal client that
runs coding work end to end, from a prompt or a checkable Workflow to a
traced, verifiable answer. It is built on a plugin kernel — every capability
is a plugin — and this package is the CLI itself and the composition root
where the plugins are assembled. The [root README](../../README.md) is the
project's front door, and the glossary in
[docs/context.md](../../docs/context.md) defines the terms used here.

## Prerequisites

- Nothing, for the published binary: Homebrew, the install script, and npm
  all deliver a prebuilt binary for your platform.
- [Bun](https://bun.sh) 1.3.10 or newer, to run from source.
- An Anthropic API key, to talk to a model.

## Installation

```bash
# Homebrew, on macOS
brew install --cask missingstudio/tap/eva

# The install script, on macOS and Linux
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh

# npm — a prebuilt binary for your platform, no runtime needed
npm i -g @missingstudio/eva

# From source, with Bun 1.3 or newer
git clone git@github.com:missingstudio/eva.git && cd eva && bun install && bun run eva
```

The script checks the download against the release's signed checksums before
it installs anything. Every archive also carries a provenance attestation:
`gh attestation verify <archive> --repo missingstudio/eva`.

## Usage

Eva talks to Anthropic, so a key is the whole setup:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
eva
```

Your key never reaches a settings file, a log, or the session record.

| Command                 | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `eva`                   | Open the interactive surface                            |
| `eva -p "<prompt>"`     | Answer once, print to stdout, exit                      |
| `eva run <name> [file]` | Run a Workflow: one input in, the last Run's text out   |
| `eva trust`             | Read this directory's `.eva`, and record the grant      |
| `eva untrust`           | Drop the grant for this directory                       |
| `eva config show`       | Print the resolved config, and where each key came from |
| `eva --version`         | What you have                                           |

`eva run` takes its one input from a positional file, `--input <file>`, or
piped standard input — one route at a time, and two at once is refused with
both named. In the chat, type `/` for the local commands: `/help`, `/model`,
`/cost`, and `/clear`. They never reach a model, so they cost nothing.
`eva -p` exits non-zero when the answer fails, which makes it safe in a
pipeline.

The global flags are valid on every command: `--model provider/model` sets
the model for this run, `--config <path>` overlays a config file, and
`--plugin` / `--without-plugin` add or skip a plugin. Three environment
variables move the config itself: `EVA_CONFIG` replaces the user config file,
`EVA_CONFIG_DIR` reads another directory like a `.eva` directory, and
`EVA_CONFIG_CONTENT` overlays config from the environment. The full surface,
including how it is parsed, is
[docs/reference/command-line.md](../../docs/reference/command-line.md).

## Inside this package

For contributors, the shape of the composition root:

- `src/plugins.ts` is the built-in table — every plugin imported explicitly,
  in load order, because Transform replay order is precedence. `BUILD` is
  handed to `boot` and to the config key sweep alike, so `eva config show`
  and the run that follows it cannot name different plugins.
- `src/argv.ts` parses with commander and never acts: it answers one
  `Invocation`, and `main` in `src/index.ts` switches on it — which is why
  `--version` answers before anything loads.
- `src/world.ts` is the World: everything a run reads from outside itself
  arrives as an argument, so every branch of `main` runs against a scratch
  directory in a test.
- `src/eva.ts` runs the workspace source under Bun; the published
  `bin/eva.mjs` runs the packed build. The interactive surface's rich
  renderer is native code behind a dynamic import, so a `--print` run — and
  any run on Node — never loads it.

A plugin does not add a command: the command table is static and parsed
before the kernel boots. And the Build is closed — config decides what loads,
but only among the ids the table carries; an id this build has no
implementation for is reported as a Finding, never fetched.

## Development

Run the CLI from source at the repository root with `bun run eva`. Tests
live beside the sources: [src/argv.test.ts](src/argv.test.ts) holds every
parse, [src/main.test.ts](src/main.test.ts) every branch of `main` over a
scratch World, [src/plugins.test.ts](src/plugins.test.ts) the table's own
order, and [src/conversation.test.ts](src/conversation.test.ts),
[src/interactive.test.ts](src/interactive.test.ts), and
[src/version.test.ts](src/version.test.ts) the rest. Run the suite from the
repository root:

```bash
bun run test
```

`bun run verify` is exactly what CI checks on every change.
