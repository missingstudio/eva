# @missingstudio/eva-tool-edit

The write tool for [Eva](../../README.md). It states an edit as text to find
and text to put in its place, previews it without touching the tree, applies
it so every hunk lands or none does, and keeps the apply so the write can be
reversed byte for byte. Every write it makes lands an `edit` payload on the
Trace, so what shows that a file changed is the record and not the tool's
word.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills no slot. It reads three — `FileSystem`, `DiffApplier`, and `Recorder` —
each at the moment of use, so one tool writes through whichever
[`@missingstudio/eva-fs`](../fs/README.md) or
[`@missingstudio/eva-diff`](../diff/README.md) holds the slot now. The
glossary in [docs/context.md](../../docs/context.md) defines **Hunk**,
**Preview**, and **Slot**, and
[architecture.md](../../docs/reference/architecture.md) §5 holds the slot
contracts.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The tool answers `Effect` values.
- A build that carries `eva.fs`, `eva.diff`, and `eva.trace`. With any one of
  the three slots empty the tool writes nothing and names the slot.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tool-edit": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. `makeEditTool` is the
tool itself, for a caller that holds the three reads:

```ts
const edited = Effect.gen(function* () {
  const tool = makeEditTool({
    files: ctx.slot.fileSystem.peek,
    applier: ctx.slot.diffApplier.peek,
    recorder: ctx.slot.recorder.peek,
  })
  const edit = {
    path: "src/one.ts",
    hunks: [{ find: "const one = 1", replace: "const one = 2" }],
  }

  // Nothing is written. `after` is the whole content an apply would write.
  const previewed = yield* tool.execute({ ...edit, dryRun: true })

  const applied = yield* tool.execute(edit)

  // The file holds what it held before.
  if (applied.kind === "applied") yield* tool.undo(applied.undo)
  return previewed
})
```

Every ending is an outcome and never a failure of the call: `previewed`,
`applied`, `refused` with the reason the boundary gave, or `degraded` naming
the slots nothing fills. A model reads a refusal and acts on it.

## How a write is previewed

The input is an edit and nothing else: a path and the hunks. So anything that
holds the `FileSystem` and the `DiffApplier` can resolve the same preview from
the arguments alone, which is how a permission gate shows a person the change
**before** this tool runs. The tool hands out no preview handle, because a
handle would be a second way to reach one and the two could disagree.

`dryRun` answers the preview and writes nothing. It is the same preview an
apply then writes, because an apply takes a preview: there is no path through
the applier that writes content nothing resolved first.

A preview that went stale is refused rather than applied. The applier
fingerprints the content it read, so a file somebody else wrote to between the
preview and the apply refuses with `stale`.

## How a write is undone

An `applied` outcome carries a token. `undo(token)` reverses that write, and
the file holds the bytes it held before, to the byte.

The token reaches the caller and the apply record does not. That record holds
the whole content the file had before the write, and a result carrying it would
send a file back to the model to get an undo.

The token names one write and reverses it whichever way it stands, so undoing
twice puts the change back. An undo whose file moved since the apply refuses
with `stale` and leaves the file alone: an undo that overwrote somebody else's
work would be a second accident, not a fix.

The tokens are held in this process, for as long as the plugin is loaded. They
do not survive a restart, and nothing rebuilds them from the Trace — the `edit`
payload records that a file changed, never how to change it back.

## What the Trace says

An applied edit lands one `edit` payload: the path, and how many hunks landed.
No hunk text. A payload is the record's account of a write, and the diff itself
is in the tree.

An undo lands an `edit` payload with no hunks. It writes one whole content and
lands no hunk, so the count is zero: the Trace says the file changed, and the
count says the change was not a set of hunks.

A write this tool cannot record is a write it does not make. With the
`Recorder` slot empty the outcome is `degraded` naming it, and the tree is
untouched — an unrecorded write is a change nobody reading the record can see.

## What it does not do

- **It creates no file and deletes none.** A path with nothing at it is
  refused with `not_found`. An undo of a create is a delete, a `FileSystem`
  offers no delete, and a create whose undo left an empty file behind would
  break the one promise this tool makes. A tool that creates a file arrives
  with the stage that gives a `FileSystem` a delete.
- It edits one file per call. Two files are two calls, because one write per
  file is all the `DiffApplier` offers.
- It decides nothing. Whether a write is allowed is the gate's, and the tool
  reports the file system's own refusal outside the root rather than checking
  a root of its own.
- It renders no diff. `after` is the exact content, and how that is shown
  belongs to a surface.
- It bounds nothing it keeps. The apply records grow with the edits a Run
  makes, which is the cost of every applied write staying undoable.

## API

- `toolEdit` — the plugin definition, id `eva.tool.edit`. It fills no slot, and
  it registers one row in the tool domain.
- `makeEditTool(deps): EditTool` — the tool, over the three slot reads. It is
  the whole capability, and it needs no kernel.
- `editToolOf(ctx)` — the tool and the row that offers it, built from a
  context's slots.
- `EDIT_TOOL_INPUT` — the JSON Schema the row carries.

The row is what a model calls, and it answers a `ToolResult`: `ok` with what
was written, or with what a dry run would write, and `failed` with the reason a
boundary refused. The undo token is not in that result. An undo is reached
through the `EditTool` `editToolOf` answers, because reversing a write is not
one of the calls a model makes.

## Development

Tests live beside the sources in [src/index.test.ts](src/index.test.ts), which
holds the plugin's id and the row it builds. The tool's own contract runs in
[packages/conformance/src/tool-edit.test.ts](../../packages/conformance/src/tool-edit.test.ts),
over the real applier, the real Recorder, and the testkit's virtual
`FileSystem` — a plugin may not import another plugin, and a tool held to a
double of the applier would be held to a shape nothing else in the tree has.
Run the suite from the repository root:

```bash
bun run test
```
