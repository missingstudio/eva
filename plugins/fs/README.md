# @missingstudio/eva-fs

The file system plugin for [Eva](../../README.md). It reads and writes files
under one root, and it refuses a path that lands outside it — including a
path spelled with `..` and a path that walks a symlink out of the root. Every
tool that touches a file goes through it, so the workspace a person opened is
the whole reach of a Run.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `FileSystem` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines; the
testkit's virtual filler fills the same slot with a map instead of a disk, and
[packages/conformance](../../packages/conformance/README.md) holds both to one
contract. The glossary in [docs/context.md](../../docs/context.md) defines
**Slot** and **Seam**, and
[architecture.md](../../docs/reference/architecture.md) §5 owns the slot
mechanics.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The `FileSystem` contract returns `Effect`
  values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-fs": "workspace:*" } }
```

## Usage

The root is where Eva was started. Config names another when a run should
reach somewhere else:

```yaml
plugins:
  - id: eva.fs
    options:
      root: ~/work/service
```

A path a caller passes is relative to the root, or absolute and under it.
`write` makes the parent directories it needs. `glob` answers paths relative
to the root, files only, sorted, and the pattern rule is `globMatcher` in
core — so this filler and the virtual one answer the same paths.

## How the refusal works

A path is resolved against the root, and then the deepest part of it that
exists is resolved again through the real file system. So the check reads
where a read or a write would land, not how the path was spelled:

- `../secrets.txt` is refused. So is `/etc/hosts`.
- `../<root>/one.txt` is accepted, because it lands inside.
- a symlink inside the root pointing out of it is refused, on read and on
  write.
- `glob` never walks a symlinked directory: a walk that followed one could
  leave the root, and a link to its own parent would never end.

A refusal is a `FileSystemError` with `reason: "outside_root"`. The other two
reasons are `not_found` — nothing is at the path — and `io`, which is
everything the disk itself refused, a read of a directory included. `stat`
answers `undefined` for a path with nothing at it rather than failing,
because "is anything there" is a question and not a fault.

## What it does not do

- It does not delete and it does not move. The tools this stage builds read,
  write, search, and run; a tool that removes a file arrives with the stage
  that needs one.
- It contains nothing. A path under the root is reachable, whatever the
  policy says — the gate decides, and the `Sandbox` slot enforces.
- It holds no lock and no snapshot. Two writers to one path is the last
  writer, as it is on the disk.

## API

- `fs` — the plugin definition, id `eva.fs`. It takes one option, `root`, and
  provides the `FileSystem` slot.
- `makeFileSystem(root: string): FileSystem` — the implementation, for a
  suite that wants the filler without a kernel.

## Development

Tests live beside the sources: [src/fs.test.ts](src/fs.test.ts) holds what
only the disk filler owes — the symlink refusals and the walk that does not
follow one — and [src/index.test.ts](src/index.test.ts) holds the slot fill
and the empty on unload. The contract every filler owes is in
[packages/conformance/src/fs-contract.test.ts](../../packages/conformance/src/fs-contract.test.ts),
which runs it over this plugin and the testkit's virtual filler at once. Run
the suite from the repository root:

```bash
bun run test
```
