# @missingstudio/eva-themes

The theme registry for [Eva](../../README.md). It ships the built-in color
themes and the `/theme` command that chooses one, so the screen's colors are
something a person can look at and change without editing a file.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
writes rows into the theme Domain and one row into the command Domain; the
[`eva.tui`](../tui/README.md) surface reads the theme Domain when it starts.
The glossary in [docs/context.md](../../docs/context.md) defines **Domain**
and **Command**.

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
{ "dependencies": { "@missingstudio/eva-themes": "workspace:*" } }
```

## Usage

The plugin takes no options and reads no config keys. It registers three
themes — `default`, `contrast`, and `mono` — and the `/theme` command.

A theme is chosen in one of two places:

- **In config**, through the `theme` key that the `eva.tui` surface reads at
  start (`theme: mono` in a `.eva` config file). The key belongs to the
  surface that draws, not to this plugin.
- **At runtime**, with `/theme`. With an argument it applies the theme it
  names; a name that is not a theme here is said rather than guessed at. With
  no argument it asks: a surface that can draw panels shows the list and
  paints the row under the selection as a live preview, and a surface that
  cannot writes the list as words instead.

Applying goes through the surface's `paint`, and the outcome is also said in
words (`theme → Monochrome`), so a reader scrolling back knows what happened.
A decision record, local to a checkout, records the split: a theme is
looked at before it is chosen, and only a Command applies one.

## How a theme is shaped

Every shipped theme fills exactly the keys the renderer contract names —
`THEME_KEYS` in `@missingstudio/eva-tui-core`: `foreground`, `muted`,
`accent`, and `warning`, each a six-digit hex string. A row missing one of
them is not a theme yet, and `/theme` says so rather than painting half of
it. A person's own themes arrive through config, projected onto this same
Domain by `eva.config`, and merge onto the colors a same-id row already had.

## What it does not do

It applies nothing at load: the `eva.tui` surface reads the Domain when it
starts. It does not decide the palette the rich renderer falls back to —
`DEFAULT_PALETTE` lives in `@missingstudio/eva-tui-renderer`, and
[packages/conformance/src/tui.test.ts](../../packages/conformance/src/tui.test.ts)
holds the default theme to it, because a plugin does not import a plugin.

## API

- `themes` — the plugin definition, id `eva.themes`. It registers the theme
  rows and the `/theme` command.
- `THEMES` — the three shipped themes, as `ThemeInfo` rows.
- `themeRow(theme)` — a theme as a `PickRow`, carrying its colors so a panel
  can preview it under the selection.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): every shipped theme
passes the contract's gate, the rows land in a live kernel without doubling
on rebuild, and `/theme` behaves on surfaces with and without a panel. Run
the suite from the repository root:

```bash
bun run test
```
