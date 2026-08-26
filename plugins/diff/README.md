# @missingstudio/eva-diff

The diff applier plugin for [Eva](../../README.md). It previews a structured
edit without touching the tree, applies it so every hunk lands or none does,
and reverses an applied edit to restore the prior content byte for byte. This
is what makes a write previewed and undoable.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `DiffApplier` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines. It reads
and writes through the `DiffFiles` each call hands it — a `FileSystem`
satisfies that shape — so it carries no filesystem of its own and reads no
other slot. The glossary in [docs/context.md](../../docs/context.md) defines
**Preview**, **Hunk**, and **Slot**, and
[docs/reference/architecture.md](../../docs/reference/architecture.md) §5 holds
the contract.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The `DiffApplier` contract returns
  `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-diff": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. It provides
`preview`, `apply`, and `reverse` — the `DiffApplier` contract in
`packages/core/src/contracts.ts` — into the `diffApplier` slot. Exactly one
plugin fills a slot at a time, so a second applier replaces this one whole.

A caller reads both slots at the moment of use and hands the one to the other:

```ts
const edited = Effect.gen(function* () {
  const files = yield* ctx.slot.fileSystem.get
  const applier = yield* ctx.slot.diffApplier.get

  // Nothing is written here. `preview.after` is the whole content an apply
  // writes, so a surface can show the change before anybody agrees to it.
  const preview = yield* applier.preview(files, {
    path: "src/one.ts",
    hunks: [{ find: "const one = 1", replace: "const one = 2" }],
  })

  const applied = yield* applier.apply(files, preview)
  yield* applier.reverse(files, applied) // the file holds what it held before
})
```

## What atomic means here

A `FileSystem` is an interface, not a syscall. It offers no rename into place,
no transaction, and no lock, so the applier cannot roll a half-finished write
back. It does not need to: **atomicity is a property of the preview, not of
the write.** Every hunk is placed while the preview is computed, so a hunk
that cannot land refuses the preview, and an apply is a single `write` of one
already-complete content. There is no intermediate state for a caller to
recover from.

A hunk lands when its `find` text appears exactly once in what the hunks
before it produced. Absent is `hunk_missing`; more than once is
`hunk_ambiguous`, with the count. A hunk is placed by index and slice rather
than by `String.replace`, whose string form reads `$&` and `` $` `` in the
replacement as substitutions — a replacement carrying either would land as
text nobody wrote.

An edit names one file. Two files are two edits, because one write per file is
all the contract offers and a promise across two files would be a promise the
applier cannot keep.

## How a stale preview is caught

A `Preview` carries `base`: a SHA-256 hash of the content the preview was
computed against. An apply reads the file again and refuses with `stale` when
the hash does not match. An `Applied` carries `wrote`, the hash of what the
apply wrote, and a reverse checks it the same way.

A content hash and not a modification time. The only question a preview asks
is whether the file still holds the bytes it read. A modification time answers
a different question: it moves when a write restores the same bytes, and it
does not move for two writes inside one clock tick — so it would refuse writes
that are safe and pass writes that are not. The hash is opaque: only the
applier that produced it reads it.

Every refusal is `DiffRefused`, a typed failure carrying the reason, the path,
and — for a hunk — which one. Nothing throws, so a tool turns a refusal into a
result the model can act on.

## What it does not do

- It creates no file and deletes none. An edit changes a file that is there.
- It renders no diff. `Preview.after` is the exact content, and how that is
  shown belongs to a surface.
- It writes no record. The `edit` payload is the tool's, because a payload is
  the Trace's account of a write and not the applier's.

## API

- `diff` — the plugin definition, id `eva.diff`, and the package's only
  export. It provides `preview`, `apply`, and `reverse` into the `diffApplier`
  slot.

## Development

Tests live beside the sources: [src/apply.test.ts](src/apply.test.ts) holds
the dry run, the atomic apply, the byte-for-byte reverse, and the stale
refusal, all against an in-memory `DiffFiles` with no disk under it;
[src/index.test.ts](src/index.test.ts) holds the slot fill,
empty-on-unload, and whole replacement. Run the suite from the repository
root:

```bash
bun run test
```
