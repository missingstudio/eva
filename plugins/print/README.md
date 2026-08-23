# @missingstudio/eva-print

The non-interactive output path for [Eva](../../README.md). `eva -p "<prompt>"`
answers once, streams the answer to stdout, prints a cost line, and exits
non-zero when the Run's Claim failed — the shape a script or a pipe wants.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers the `eva.print` row in the surface Domain and supplies the `/cost`
handler that [`eva.commands`](../commands/README.md) only describes. The
glossary in [docs/context.md](../../docs/context.md) defines **Surface**,
**Cost**, and **Estimate** — the last two are most of this package.

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

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-print": "workspace:*" } }
```

## Usage

The plugin takes no options and reads no config keys. At the command line:

```bash
eva -p "summarize this repository"
```

The answer streams to stdout as it arrives. A cost line follows it, a failed
Claim's summary goes to stderr, and the process exits 1 on failure. In the
interactive surface, `/cost` prints the same line for the current Session.

The surface row it registers is `interactive: false`, `streaming: true`,
`images: false`, with no `start`. A surface that cannot ask a person declares
it, so every ask becomes a rejection rather than a hung pipe, and the
interactive branch never picks this row.

## How the cost line reads

`src/cost-line.ts` is the grammar, and its point is that an Estimate is never
mistaken for a Cost:

- A reported Cost prints as money: `1.2k in / 340 out · $0.0400`.
- An Estimate wears `~` and the word `est`, and a reported figure beside it
  wins.
- A Session that has run with no reported figure says `cost unreported`,
  because silence is not zero.
- A Session that has not run says `nothing spent yet` instead.
- One silent usage record suppresses the whole total — a partial sum is never
  shown — and a reported zero prints rather than hiding.

`/cost`'s handler attaches the transcript over the Session API, so what is
reported is what was committed to the record.

## What it does not do

It parses no flag and owns no exit code: `-p, --print` belongs to the command
line in `apps/cli/src/argv.ts`, and the answer-once loop is the composition
root's (`runPrint` in `apps/cli/src/run.ts`). This plugin gives that loop its
surface row and its words. It draws nothing — there is no `start` on its row,
so a build whose only surface is this one refuses plain `eva` rather than
pretending it can hold a Console. And in a build without `eva.commands` there
is no `/cost` row to edit, so the command is absent rather than described by
nothing.

## API

- `print` — the plugin definition, id `eva.print`. It registers the surface
  row and edits the `/cost` handler in.
- `PRINT_SURFACE` — the surface id string, `"eva.print"`.
- `showCost` — the `/cost` handler: attach the transcript, write the cost
  line.
- `costLine(summary, ran)` — the cost-line grammar over a `CostSummary`.
- `formatCount`, `formatCost` — the number and money formatters it uses.

## Development

Tests live in [src/cost-line.test.ts](src/cost-line.test.ts) — every reading
of the grammar above. The answer-once loop is held in
[apps/cli/src/conversation.test.ts](../../apps/cli/src/conversation.test.ts).
Run the suite from the repository root:

```bash
bun run test
```
