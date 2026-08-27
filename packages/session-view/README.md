# @missingstudio/eva-session-view

The one fold that decides what a Run did, for every surface of
[Eva](../../README.md). It takes the record — a Transcript, or the Messages a
Transcript holds — and answers with **Blocks**: words, reasoning, a tool call,
the result that answered it, a diff, an image, and `unknown`.

There is one of these because two would disagree. The terminal folded the
record itself and answered with terminal rows, so a page that draws a tool
call as a card could not use it and would have written a second fold; a person
comparing the two screens would then find the disagreement. Every renderer now
maps Blocks to its own primitives and decides nothing else.

`unknown` is the degradation rule the harness seam already uses, pointed at
renderers. A Surface may render less than another; it may never know more. So
a content kind no other member covers folds to `unknown` and says what it was,
rather than falling out of the transcript. A payload kind the schema does not
define folds there too, from the transcript fold that kept it.

This package holds no renderer and registers into nothing: it imports the
record contracts and nothing that draws. The glossary in
[docs/context.md](../../docs/context.md) defines Block, Message, Disposition
and Tool Status.

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
{ "dependencies": { "@missingstudio/eva-session-view": "workspace:*" } }
```

## Usage

There are two ways in and they are the same fold. A surface that already holds
the Messages — the terminal's `Frame.session` is exactly that list — calls
`blockFold`:

```ts
import { blockFold } from "@missingstudio/eva-session-view"

for (const turn of blockFold(frame.session)) {
  // turn.author is who spoke; turn.blocks is what they said.
}
```

A surface handed the record itself calls `blocksOf`, which asks the Transcript
for its Messages and folds those:

```ts
import { blocksOf } from "@missingstudio/eva-session-view"

const turns = blocksOf(transcript)
```

A Turn is one Message folded: `key`, `author`, and its Blocks. The Blocks of
one Message belong together on the screen, so the fold carries that boundary
rather than leaving every renderer to find it again.

## The Blocks

| Block        | What it says                                                                       |
| ------------ | ---------------------------------------------------------------------------------- |
| `words`      | what was said out loud, by whoever the Turn says was speaking                      |
| `reasoning`  | what was thought on the way to it                                                  |
| `tool`       | a call that is still open: its name, its kind, and its Tool Status                 |
| `result`     | the same call once a result answered it: its Tool Status and Disposition           |
| `diff`       | a file the Run changed: the path, and how many hunks changed in it                 |
| `mode`       | the permission mode the Session runs under, and why it changed                     |
| `permission` | a permission request nobody has answered: the id an answer names, and the question |
| `image`      | an image, with its media type                                                      |
| `unknown`    | something no member above covers: what it was, and what it said                    |

A call has a Tool Status and a Disposition, and neither replaces the other —
the Status says where a call is in its life, the Disposition says how it
ended. So an open call is a `tool` and an answered one is a `result`, and a
renderer that draws an outcome — denied, failed, over budget — draws it from
the `result`.

The `diff` Block carries what the record carries: a path and a count of hunks.
`eva.tool.edit` records no hunk text, so none is drawn; the Block does not
change shape on the day one does.

Two things a Run does are on the Trace and on neither surface, and both are
deliberate. **A command's streamed output** arrives as many `tool_update`
windows per call, so folding it into one Block would make the fold decide
truncation — a rendering policy with no home — and a `ContentBlock` carries no
stream to draw it under. **That a call ran beside another** is not a record
field at all: `parallelSafe` is a property of the row, and drawing it on a card
would need a record change and a decision to go with it.

The `permission` Block is the one Block that is not on the record, and it
cannot be: a request a person has answered is the Disposition of the call it
gated, and one nobody has answered is a thing that is still happening. It is a
Block anyway, so both surfaces draw one question the same way. It carries no
option list — the options are `PERMISSION_OPTIONS` in `packages/core`, the same
four every time, and a Block that carried them would give a renderer two places
to read the labels from.

## API

- `blockFold(messages)` — the fold, over the Messages a record holds.
- `blocksOf(transcript)` — the same fold, over a `Transcript`.
- `askingOf(asking)` — the questions that stand, as Turns. A second source,
  never the record: a surface draws it after the record, the way it draws the
  tail of an open Run after the record.
- `Block`, `Turn`, `Asking` — the shapes a renderer switches over.

## Development

Tests live beside the sources: [src/blocks.test.ts](src/blocks.test.ts) holds
the fold and the rule that this package names no renderer. Run the suite from
the repository root:

```bash
bun run test
```
