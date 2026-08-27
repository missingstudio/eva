# @missingstudio/eva-tool-glob

The file-naming tool for [Eva](../../README.md). It names the files under the
workspace root that a glob matches, one per line.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers a row in the `tool` domain that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares, and it
reads the `FileSystem` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines — so the
paths it answers are the paths the workspace holds. The glossary in
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
{ "dependencies": { "@missingstudio/eva-tool-glob": "workspace:*" } }
```

## Usage

The plugin takes no options. It registers the row and nothing else, so a build
that does not want the tool leaves the plugin out:

```yaml
plugins:
  - id: eva.tool.glob
    enabled: false
```

The model calls it `glob` and hands it one field:

```json
{ "pattern": "src/**/*.ts" }
```

## How a call answers

- One path per line, relative to the root, files only, sorted. The tool
  answers what the `FileSystem` contract answers and holds no pattern rule of
  its own: `globMatcher` in core is the rule, so a filler over a disk and one
  over a map name the same files.
- Nothing matched is an `ok` result that says so.
- An empty `FileSystem` slot is a `failed` result that says so. Nothing
  throws: a Disposition is data the model can recover from.

## What it does not do

- It does not read content. That is `eva.tool.read`, and searching content is
  `eva.tool.grep`.
- It does not name directories. The contract answers files, because a
  directory is not something a tool of this stage reads or writes.
- It does not decide whether the call may run. That is the
  `tool.execute.before` boundary.

## API

- `toolGlob` — the plugin definition, id `eva.tool.glob`. It registers the
  `glob` row in the `tool` domain.
- `globTool(deps: GlobDeps): ToolInfo` — the row, for a suite that wants the
  tool without a kernel. `GlobDeps` is the _read_ of the `FileSystem` slot,
  never a `FileSystem`.

## Development

Tests live beside the sources: [src/glob.test.ts](src/glob.test.ts) holds what
a call answers, against the testkit's virtual file system, and
[src/index.test.ts](src/index.test.ts) holds the row and one call end to end
through the execution. Run the suite from the repository root:

```bash
bun run test
```
