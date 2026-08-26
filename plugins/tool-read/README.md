# @missingstudio/eva-tool-read

The read tool for [Eva](../../README.md). It answers the content of one file
under the workspace root, whole, so a model reads the text an edit will later
match.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers a row in the `tool` domain that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares, and it
reads the `FileSystem` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines — so the
root a person opened is the whole reach of a call. The glossary in
[docs/context.md](../../docs/context.md) defines **Domain**, **Transform** and
**Slot**, and [architecture.md](../../docs/reference/architecture.md) §4 and
§6 own the domain and the tool boundaries.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). A tool answers an `Effect`.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tool-read": "workspace:*" } }
```

## Usage

The plugin takes no options. It registers the row and nothing else, so a build
that does not want the tool leaves the plugin out:

```yaml
plugins:
  - id: eva.tool.read
    enabled: false
```

The model calls it `read` and hands it one field:

```json
{ "path": "src/session.ts" }
```

## How a call answers

- The content reaches the model as it is on the disk. Nothing is numbered and
  nothing is trimmed, because the edit tool matches the text it was shown.
- A path outside the root, a path with nothing at it, and a path that is a
  directory are each a `failed` result naming the path. Nothing throws: a
  Disposition is data the model can recover from.
- An empty `FileSystem` slot is a `failed` result that says so. The slot is
  read at the moment of the call, so a filler swapped between two calls
  answers the second one.

## What it does not do

- It does not write, delete, or move. A tool that changes a file is
  `eva.tool.edit`.
- It does not decide whether the call may run. That is the
  `tool.execute.before` boundary, and the gate is a plugin of its own.
- It reads no part of a file. A window over a large file arrives with the
  stage that manages context.

## API

- `toolRead` — the plugin definition, id `eva.tool.read`. It registers the
  `read` row in the `tool` domain.
- `readTool(deps: ReadDeps): ToolInfo` — the row, for a suite that wants the
  tool without a kernel. `ReadDeps` is the _read_ of the `FileSystem` slot,
  never a `FileSystem`.

## Development

Tests live beside the sources: [src/read.test.ts](src/read.test.ts) holds what
a call answers, against the testkit's virtual file system, and
[src/index.test.ts](src/index.test.ts) holds the row and one call end to end
through the pipeline. Run the suite from the repository root:

```bash
bun run test
```
