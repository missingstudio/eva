# @missingstudio/eva-commands

The built-in slash commands for [Eva](../../README.md): `/model`, `/cost`,
`/clear`, and `/help`. A slash command is a line a person types at the
Console with a leading `/`. It is handled locally — it never reaches a model
and costs nothing.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers rows in the command Domain; parsing the line and dispatching it
belong to the SDK, and where the output goes belongs to the surface. The
glossary in [docs/context.md](../../docs/context.md) defines **Command**,
**Session**, and **Catalog**.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). Command handlers are `Effect` programs.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-commands": "workspace:*" } }
```

## Usage

The plugin takes no options and reads no config keys. In the interactive
surface, type:

| Command              | What it does                     |
| -------------------- | -------------------------------- |
| `/model [ref]`       | Show or set the Session's model  |
| `/cost`              | Show what this Session has spent |
| `/clear` (or `/new`) | Open a new Session and select it |
| `/help`              | List every registered command    |

`/model` with an argument sets the model the `provider/model` reference names
and says so in words, so a pipe transcript is never poorer than a screen.
With no argument it asks: a surface that supplies a panel lists every model
the Catalog holds, with context window and input price as the detail; a
surface without one writes the current model and the list as words. Choosing
nothing changes nothing.

`/help` prints over the Domain's rows, so a command any plugin registers is
listed. `eva.config` projects a person's `commands:` mapping onto this same
Domain after this plugin has seeded it, so a same-id entry overrides a
shipped row.

## Who supplies which run

`COMMANDS` is a plain table, and a constant cannot carry a handler that needs
context. So `/help` and `/model` are registered first and get their handlers
edited in, closing over the Domains this plugin is registered beside. `/cost`
is registered with no `run` at all: its behavior belongs to
[`eva.print`](../print/README.md), because the cost formatter lives there,
and that plugin edits the `run` in when it loads. Until it does, `/cost` is a
row the build knows of but cannot execute, and dispatch says so.

## What it does not do

It runs nothing against a model: no command here opens a Run. The dispatch
policy — the near-miss suggestion, the "does nothing in this build" answer —
is the SDK's, shared by every Console. And a plugin cannot add a top-level
CLI verb: the command table is static and the app owns it
([command-line.md](../../docs/reference/command-line.md)); slash commands are
the plugin-extensible surface.

## API

- `commands` — the plugin definition, id `eva.commands`. It registers the
  four rows and edits in the `/help` and `/model` handlers.
- `COMMANDS` — the table of the four rows, as `CommandInfo` values.
- `modelRows(catalog)` — every model the build can reach as `PickRow`s, each
  named `provider/model` the way the line names one.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): the table names exactly
the four commands, `new` resolves to `/clear`, a booted kernel holds every
row, and `/model` behaves with and without an argument, with and without a
panel. Run the suite from the repository root:

```bash
bun run test
```
