# @missingstudio/eva-tui-core

The contracts a terminal Surface and its renderers share in
[Eva](../../README.md): the `Frame` a screen shows, the `Renderer` that draws
one, the one spelling of a key Binding, and the color vocabulary a theme must
fill. No rendering code lives here.

Eva is built on a plugin kernel: every capability is a plugin, and a plugin
may not import another plugin — the layer rule in
[architecture.md](../../docs/reference/architecture.md) holds. This package
imports only the schema, so the Surface plugin and the renderer package
[`@missingstudio/eva-tui`](../tui/README.md) both depend on it and never on
each other. The glossary in [docs/context.md](../../docs/context.md) defines
**Surface**, **Binding**, and **Live area**; this package is where those
words become types.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tui-core": "workspace:*" } }
```

## Usage

`canonical` is the Binding grammar's one home: modifiers in the order `ctrl`,
`meta`, `shift`, then the key — `enter` never `return`, `plus` never `+`. A
string that names no key answers nothing rather than a guess:

```ts
import { canonical, themeColors } from "@missingstudio/eva-tui-core"

canonical("Shift+Ctrl+K") // "ctrl+shift+k"
canonical("return") // "enter"
canonical("ctrl") // undefined — a bare modifier is not a binding

// The one gate between a theme row's loose colors and the contract.
// A row missing a key is not a theme yet, and the caller keeps its default.
themeColors({ foreground: "#c9d1d9", muted: "#8b949e", accent: "#58a6ff" })
// undefined — "warning" is missing
```

## What a Frame says

`Frame` says what a terminal shows and where each part comes from: `session`
is the fold of the record, `live` is what the open Run has streamed, and
`notes` are the Surface's own words. The rest — banner, input, cursor,
`took`, work, status, an optional `overlay` and `theme` — is chrome, and a
renderer that cannot draw chrome shows the conversation and still honours the
Frame. `Renderer` is what a Surface draws through: `draw`, the `draws`
capability pair, `onKey`, `onPaste`, `onEnd`, and a `stop` that is safe to
repeat.

## API

- `Frame`, `Overlay`, `Work`, `Banner`, `StatusLine` — what a screen shows.
- `Renderer`, `Draws`, `ChosenRenderer`, `EMPTY` — what a Surface draws
  through, and the empty Frame.
- `canonical(binding)` — one spelling for a Binding, or `undefined` for a
  string that is not one.
- `formatKey(chord)`, `Chord`, `KeyPress` — a chord's spelling, and a press
  as a Surface reads it.
- `makeKeymap(bindings)` — a `Keymap` holding rows in the one spelling;
  `lookup` answers `undefined` for an unbound key.
- `conflicts(rows)` — the keys bound twice on one Surface.
- `THEME_KEYS`, `ThemeColors`, `themeColors(colors)` — the color vocabulary
  and its gate.
- `overlayLines`, `tokenLine`, `seconds`, `tookText`, `costText` — the
  spellings every renderer shares. `costText` marks an Estimate with `~`,
  because an Estimate read as a Cost is the mistake the pair exists to
  prevent.

## What it does not do

It draws nothing: the two Renderer adapters live in
[`@missingstudio/eva-tui`](../tui/README.md), and so does `toKeyPress`, the
normalizer that turns a raw terminal key into the `KeyPress` defined here. It
holds no rows of its own — the keymap and theme Domains are plugins' to fill.

## Development

Tests live beside the sources: [src/frame.test.ts](src/frame.test.ts),
[src/keys.test.ts](src/keys.test.ts), and
[src/theme.test.ts](src/theme.test.ts). Run the suite from the repository
root:

```bash
bun run test
```
