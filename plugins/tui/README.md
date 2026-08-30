# @missingstudio/eva-tui

The interactive terminal surface for [Eva](../../README.md). It ships the
Console a person types into: a prompt line, a live area that streams the open
Run's answer, slash commands with completion, and a command palette. It draws
through a Renderer contract, so the package itself never touches a terminal.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers the `eva.tui` row in the surface Domain and reads the keymap,
command, and theme Domains that other plugins fill — see
[architecture.md](../../docs/reference/architecture.md) for the layer rules.
The glossary in [docs/context.md](../../docs/context.md) defines **Surface**,
**Console**, **Note**, and **Live area**.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default, and plain
`eva` with no prompt starts it. To use the package from another workspace
package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tui": "workspace:*" } }
```

## Usage

### At the terminal

Run `eva` with no arguments. Type a prompt and press enter to submit it; the
answer streams into the live area. A line typed while a Run is open waits its
turn behind it — press ctrl+s instead and the line steers the Run that is
going, which is a deliberate gesture and not what enter does. A line starting
with `/` runs a Command (`/help` lists them), and ctrl+k opens the palette. The default chords come
from [`eva.keymap`](../keymap/README.md). Slash commands are local: they never
reach a model and cost nothing.

### Choose a theme

The plugin reads one config key, `theme`, declared as a name: `theme: mono`
and `theme: { id: mono }` select the same theme. It resolves the name against
the theme Domain that [`eva.themes`](../themes/README.md) fills. A name that
is not a theme there keeps the default and says so as a Note. Set it at the
top level of a `.eva` config file:

```yaml
theme: mono
```

The plugin takes no per-plugin options.

### Compose it in an app

The package exports a factory, not a finished plugin. The plugin holds the
Renderer contract, the app holds the terminal, and the composition root binds
them — a plugin may not import an app. The Eva CLI composes it like this
(`apps/cli/src/plugins.ts`):

```ts
import { makeTui } from "@missingstudio/eva-tui"

export const tui = makeTui({
  // Loaded only when the surface starts. The rich renderer is native code
  // over Bun's FFI, so a --print run never imports it.
  renderer: async (theme) => {
    const { start } = await import("@missingstudio/eva-tui-renderer")
    return start(theme === undefined ? {} : { theme })
  },
  version: VERSION,
})
```

`renderer` is called lazily, when the surface starts, with the resolved theme
colors. `version` names the build in the banner. An optional `directory`
overrides the working directory the banner shows.

## How the Console is built

`console.ts` is a pure reducer: `ConsoleState`, one `ConsoleEvent` case per
screen rule, and `frameOf` to project the Frame a Renderer draws.
`makeSurface` in `surface.ts` wires the world to it — keys in, frames out,
Session API calls at the edge — and keeps no state of its own. `pick.ts`
holds the choices a command opened and `ask.ts` the questions that stand, so
each keeps its own map and the surface holds neither. The line
editor in `line.ts` counts code points, and the keymap alone decides what a
chord means: rebind `session.submit` and plain enter is released with it. A
paste lands as text and never reaches the keymap, so a newline in a paste
never submits.

## A question a person is looking at

Eva may ask more than one question at a time — one tool group can hold two
calls that both need a person — and each ask is answered on its own. This
terminal shows one line at a time, so it holds the questions that stand by
their id: the first one is the one on the screen, a line a person types settles
that one, and the next is shown in its place. The others wait behind it rather
than replacing it.

The obligation is the `Frontend.ask` contract's, in
[@missingstudio/eva-sdk](../../packages/sdk/README.md), because the page keeps
it too — a page shows them all at once. What no surface may do is let one
answer settle a question it was not given for.

## What it does not do

It ships no Renderer — the composition root hands one in. It ships no key
Bindings and no themes; those are [`eva.keymap`](../keymap/README.md) and
[`eva.themes`](../themes/README.md), and this plugin reads both Domains at
the point of use.

## API

- `makeTui(options: TuiOptions): Plugin` — builds the plugin, id `eva.tui`.
  `TuiOptions` carries `renderer`, `version`, and an optional `directory`.
- `TUI_SURFACE` — the surface id string, `"eva.tui"`.
- `makeSurface(deps)` — wires a Session API and a Renderer into a running
  surface; `makeTui` calls it when the surface starts.
- `ConsoleState`, `initial`, `apply`, `frameOf`, `backStep` — the pure
  Console reducer and its Frame projection.
- `LineState`, `BLANK`, `edit`, `pasted` — the code-point line editor.
- `branchOf`, `shortPath` — banner helpers.

## Development

Tests live beside the sources: [console.test.ts](src/console.test.ts) holds
the screen rules, [line.test.ts](src/line.test.ts) the editor,
[overlay.test.ts](src/overlay.test.ts) the selection physics, and
[surface.test.ts](src/surface.test.ts) the wiring against a fake Session API
and a fake Renderer. Run the suite from the repository root:

```bash
bun run test
```
