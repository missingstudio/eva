# @missingstudio/eva-config

The config projection plugin for [Eva](../../README.md). The kernel reads the
`.eva` YAML files and merges the layers; this plugin interprets the merged
mapping. It projects the keys it declares into the domains — the default
model, agents, commands, keymap bindings, and themes — and it turns everything
the config said that reached nothing into Findings: the warnings a run prints
and the report behind `eva config show`.

Eva is built on a plugin kernel: every capability is a plugin. The CLI loads
this one last among the domain writers, because replay order is precedence and
the person's config should win over the defaults a base plugin seeded. The
glossary in [docs/context.md](../../docs/context.md) defines **Declaration**
and **Finding**, and [docs/decisions.md](../../docs/decisions.md) records the
layering and the trust grant — both of those belong to the kernel, not here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin effect returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-config": "workspace:*" } }
```

## Usage

The plugin takes no options. It reads five top-level config keys — `model`,
`agents`, `commands`, `keymap`, `themes` — from a `.eva` config file, read
only after `eva trust` grants it:

```yaml
model: anthropic/claude-opus-5
agents:
  reviewer:
    prompt: review carefully
commands:
  deploy:
    description: ship it
keymap:
  submit:
    binding: ctrl+enter
    command: session.submit
themes:
  dusk:
    name: Dusk
    colors: { foreground: "#eee" }
```

Each projected row is read back and registered whole, so config only replaces
what it names: a `/model` described in config keeps the `run` that
`eva.commands` supplied, and a theme that sets one colour keeps the rest.

`eva config show` prints the resolved config and where each key came from.
When something in the config reached nothing, a run reports it as a Finding:
a file the missing trust grant kept unread, a key nothing declares (with the
key a typo likely meant), a key written in a shape nothing reads, a plugin
option swept against what that plugin `takes`, and a resolved plugin this
build carries no implementation for. A Finding is data rather than a line of
text, so the terminal, `eva config show`, and a surface across a socket all
report the same answer.

## What it does not do

It reads no file and merges no layer: `resolveConfiguration` in the kernel
owns loading, layering, and the origin of every key. The `.eva` trust grant is
the kernel's too — `eva trust` writes it, and this plugin only reports the
files the missing grant kept unread. And nothing here validates: a Declaration
names a shape, and a value in another shape is reported and dropped, never
rejected.

## API

- `config` — the plugin definition, id `eva.config`. It reads the five keys
  above and registers the transforms.
- `project(raw): Projection` — projects the raw mapping into the domain rows.
- `findings(reviewed): Finding[]` — everything the config reached nothing
  with, from a `Reviewed` the composition root assembles.
- `KEYS` — the declared keys and their reader, so a key is declared and read
  in one place.
- `unreadKeys`, `suggestKey`, `misshapenKeys` — the sweep pieces `findings`
  is built from.
- Types: `Finding`, `Reviewed`, `ReviewedEntry`, `Projection`, `Misshapen`.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): the projection reads
only what the Declaration names, the shape sweep tells `theme` and `themes`
apart in both directions, and the typo suggestion reads `keympa` as `keymap`.
The booted behaviour — the sweep against a real directory, the trust
Findings, the plugin-option sweep — lives in `apps/cli/src/main.test.ts`,
under `config show`. Run the suite from the repository root:

```bash
bun run test
```
