# @missingstudio/eva-tool-grep

The search tool for [Eva](../../README.md). It matches a regular expression
against every line of the files under the workspace root, and answers
`path:line:text` for each hit.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers a row in the `tool` domain that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares, and it
reads the `FileSystem` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines — so it
walks the workspace a person opened and no search program. The glossary in
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
{ "dependencies": { "@missingstudio/eva-tool-grep": "workspace:*" } }
```

## Usage

The plugin takes no options. It registers the row and nothing else, so a build
that does not want the tool leaves the plugin out:

```yaml
plugins:
  - id: eva.tool.grep
    enabled: false
```

The model calls it `grep` and hands it a pattern, and a glob when it wants
fewer files than every file:

```json
{ "pattern": "UserSvc", "glob": "src/**/*.ts" }
```

## How a call answers

- One line per hit, as `path:line:text`. The line numbers count from 1 and the
  paths are relative to the root.
- The files searched are the ones the glob names, through the same
  `globMatcher` rule the `FileSystem` contract answers with — so a disk and a
  map answer the same paths. With no glob it searches every file.
- Nothing found is an `ok` result that says so, because nothing found is an
  answer.
- A pattern no engine reads is a `failed` result naming it, and so is an empty
  `FileSystem` slot. Nothing throws.

## What it does not do

- It does not run a search program. There is no `Shell` read here: a command
  is `eva.tool.bash`, and it is gated.
- It does not cap what it answers. A search that matches a whole tree answers
  the whole tree, and holding a context window is the business of the stage
  that manages one.
- It does not decide whether the call may run. That is the
  `tool.execute.before` boundary.

## API

- `toolGrep` — the plugin definition, id `eva.tool.grep`. It registers the
  `grep` row in the `tool` domain.
- `grepTool(deps: GrepDeps): ToolInfo` — the row, for a suite that wants the
  tool without a kernel. `GrepDeps` is the _read_ of the `FileSystem` slot,
  never a `FileSystem`.

## Development

Tests live beside the sources: [src/grep.test.ts](src/grep.test.ts) holds what
a call answers, against the testkit's virtual file system, and
[src/index.test.ts](src/index.test.ts) holds the row and one call end to end
through the pipeline. Run the suite from the repository root:

```bash
bun run test
```
