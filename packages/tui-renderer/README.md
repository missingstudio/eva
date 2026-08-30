# @missingstudio/eva-tui-renderer

The terminal renderer of [Eva](../../README.md), whichever one this runtime
can give: a rich OpenTUI renderer where there is Bun's FFI and a real screen,
and a plain stream renderer everywhere else. Both draw the same `Frame` from
[`@missingstudio/eva-tui-core`](../tui-core/README.md).

Eva is built on a plugin kernel: every capability is a plugin, but this
package is not one — it is the renderer the composition root
(`apps/cli/src/plugins.ts`) binds to the Surface plugin through a dynamic
import, so a `--print` run, and any run on Node, never loads the native code.
It is the only package that may name OpenTUI —
[architecture.md](../../docs/reference/architecture.md) holds the import
rule — so a Surface plugin can never pull FFI in. The glossary in
[docs/context.md](../../docs/context.md) defines the terms used here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer. The rich renderer is native code
  reached over Bun's FFI; on Node the stream renderer draws instead.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tui-renderer": "workspace:*" } }
```

## Usage

`start` chooses the renderer and says why when it falls back, because a
renderer dropped in silence reads as a renderer chosen. This is how the
composition root calls it — behind a dynamic import, so the module is not
named until a surface actually starts:

```ts
const { start } = await import("@missingstudio/eva-tui-renderer")

// { renderer, notices }: the notices name what the fallback left unsaid.
const chosen = await start({ theme })
```

`capabilities()` reports whether Bun's FFI and a TTY are here, and
`canDrawRich` wants both. The rich path reaches `makeOpenTuiRenderer` through
a second dynamic import; every other path gets `makeStreamRenderer`. A pipe
stays quiet — plain output is what a pipe asked for, not a degradation.

## The two renderers

The rich renderer mounts `App` through React and holds the Frame outside the
tree in a store, so `draw` is a plain call. The stream renderer repaints a
screen whole — it homes and writes over, never erases first — and appends to
a pipe: only new conversation lines, streamed text once as it arrives, no
chrome and no panel. Both read presses through `toKeyPress`, the one place
that decides whether a press carries a typed character, and both report a
paste as the Renderer's own word, so it never reaches the keymap.

`frame.ts` holds one spelling for each chrome line — `bannerRows`,
`statusLine`, `workLine`, `caret`, `panelWindow` — so the two renderers
cannot disagree. `paletteFrom` says how a theme paints the transcript.

What a Run did is not decided here. `toGroups` and `toLines` map the Blocks of
[`@missingstudio/eva-session-view`](../session-view/README.md) to terminal
rows and decide nothing else, because a terminal with a fold of its own would
be a second answer to what a Run did — and a person comparing the screen with
the page would find the disagreement. A row is a line of text, so the screen
draws fewer of the Blocks than a page draws: that is a renderer that renders
less, not one that knows less.

## API

- `start(options?)` — returns a `ChosenRenderer`: the renderer this runtime
  can give, and the notices that say what choosing it left unsaid.
  `options.theme` carries the configured `ThemeColors`.
- `capabilities()`, `canDrawRich(found?)`, `Capable`, `StartOptions` — the
  choice and its inputs.
- `makeStreamRenderer(terminal?)` — the plain renderer, directly.
- `toKeyPress(key, value?)` — a raw terminal key as the `KeyPress` the
  contract defines.
- `paletteFrom(colors)`, `DEFAULT_PALETTE`, `Palette` — how a theme paints
  the transcript.
- The chrome spellings from `frame.ts`: `bannerRows`, `statusLine`,
  `workLine`, `caret`, `panelWindow`, and their shapes.
- `toGroups(frame)`, `toLines(frame)`, `Group`, `Line` — the Blocks of the
  session view as the rows this terminal draws.

`makeOpenTuiRenderer` is not exported from the index: it lives behind the
dynamic import in `renderer.tsx`, which is what keeps the native chunk out of
every path that did not ask for it.

## Development

Tests live beside the sources: [src/index.test.ts](src/index.test.ts) holds
the choosing rules, [src/renderer-contract.test.ts](src/renderer-contract.test.ts)
runs the Renderer contract against both adapters, and
[src/stream.test.ts](src/stream.test.ts), [src/frame.test.ts](src/frame.test.ts),
and [src/keys.test.ts](src/keys.test.ts) hold the rest.
[src/session-view.test.ts](src/session-view.test.ts) counts the folds that
decide what a Run did: it is one, and it is not in this package. Run the suite
from the repository root:

```bash
bun run test
```

What the rich renderer actually draws is checked by
[src/render-check.tsx](src/render-check.tsx), a type-checked Bun script that
mounts the real `App` and asserts on `captureCharFrame()`. It cannot be a
vitest file — the test workers run Node, and OpenTUI needs Bun's FFI — so run
it by hand:

```bash
bun packages/tui-renderer/src/render-check.tsx
```
