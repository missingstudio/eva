# @missingstudio/eva-keymap

The default key bindings for [Eva](../../README.md)'s terminal surface. It
answers the question "what does enter do, and how do I quit" by shipping seven
Bindings — each a key chord tied to a named command — as data other plugins
and a person's config can override.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
writes rows into the keymap Domain; the [`eva.tui`](../tui/README.md) surface
reads that Domain and acts on the commands. The glossary in
[docs/context.md](../../docs/context.md) defines **Binding** and its one
canonical spelling.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin definition is an `Effect`
  program.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-keymap": "workspace:*" } }
```

## Usage

The plugin takes no options and reads no config keys. It writes these seven
rows, every one scoped to the `eva.tui` surface:

| Binding       | Command           | What it does             |
| ------------- | ----------------- | ------------------------ |
| `enter`       | `session.submit`  | Submit the line          |
| `shift+enter` | `input.newline`   | Break the line           |
| `ctrl+s`      | `session.steer`   | Steer the open Run       |
| `ctrl+c`      | `session.cancel`  | Cancel the open Run      |
| `ctrl+d`      | `app.quit`        | Quit                     |
| `escape`      | `surface.back`    | Step back                |
| `ctrl+k`      | `surface.palette` | Open the command palette |

A line submitted with `enter` waits its turn behind the Run that is open; one
sent with `ctrl+s` rides it instead. The two mean different things, so they
are two keys: steering is a deliberate gesture and never what a plain line
does by accident.

One row covers every meaning of escape: what stepping back steps back from is
the surface's to decide. To rebind a key, write a row in a `.eva` config
file — `eva.config` projects a person's keymap entries onto this same Domain,
and a same-id row replaces the shipped one.

## A known limit

`input.newline` is bound to `shift+enter`, and most terminals cannot send
that chord without the kitty keyboard protocol, which nothing in this tree
speaks. Typing a newline needs a terminal that can say the chord. A pasted
block keeps its newlines regardless, because a paste never reaches the
keymap. This is a recorded decision, not an oversight.

## What it does not do

It resolves nothing: the surface builds its keymap from these rows, and the
surface is what reports a Binding that names no key or a key bound twice.
Every shipped row is written in the canonical spelling that `canonical` in
`@missingstudio/eva-tui-core` defines, and every row names a command the
surface actually acts on — a registered-but-inert binding reads as working
until a person presses it.

## API

- `keymap` — the plugin definition, id `eva.keymap`. It writes `BINDINGS`
  into the keymap Domain.
- `BINDINGS` — the seven shipped rows, as `KeymapInfo` values.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): the shipped rows carry
no conflict, each is in its canonical spelling, and each lands intact in a
live kernel. The join with the surface's line editor is held in
[packages/conformance/src/tui.test.ts](../../packages/conformance/src/tui.test.ts),
where the two plugins meet. Run the suite from the repository root:

```bash
bun run test
```
