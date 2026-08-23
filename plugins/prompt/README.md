# @missingstudio/eva-prompt

Prompt Templates for [Eva](../../README.md). A Template is a named body of
text with named holes; this plugin turns the Templates a person writes in
config into rows of the prompt Domain, so Workflows can fill them by name
instead of carrying prompt text inline.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the prompt Domain that `eva.workflow` reads. The glossary in
[docs/context.md](../../docs/context.md) defines **Template**, **Variable**,
**Gap**, and **Instruction**.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin definition is an `Effect`
  program.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-prompt": "workspace:*" } }
```

## Usage

The plugin takes no per-plugin options. It reads one top-level config key,
`prompts`, a mapping of Template id to body:

```yaml
prompts:
  commit-msg:
    text: "Write one line for {{diff}}."
```

Templates also arrive as files: `.eva/prompts/<id>.md` reaches the same key
through the kernel's resource discovery — the file's body becomes the `text`,
keyed by the file's base name — so trust gating and the config layer chain
apply, and this plugin opens no file itself.

Each entry becomes a `PromptInfo { id, text }` row: plain data, no closure,
because every Domain draft must be serializable. The projection drops a row
rather than coercing one — an entry that is not a mapping, a `text` written
as a number or a list, and a `text` of nothing are not Templates. The row
then does not exist, and the point of use says so with a `template` Gap.

## How overriding works

Load order is the override story. This plugin loads after every plugin that
seeds a built-in Template, so a person's `prompts` entry with the same id
replaces the seeded text and keeps the row's position. The built-in repair
Template that `eva.workflow` ships fills only a row the person's config left
empty.

## How filling works

Filling is not here. `instructionOf` in `packages/sdk/src/prompt.ts` is a
pure function over the rows, so `eva.workflow` reaches it without importing
this plugin. `{{name}}` is a Variable; `{{> other}}` includes another
Template by name, depth first, before any Variable fills; an inserted value
is never scanned again. A hole nothing fills is a Gap — a `variable` nothing
bound, a `template` id that names no row, or a `cycle` — and one call names
every Gap it can see and refuses the Instruction whole, before any model
call spends.

## What it does not do

- No list and no loop in Template text. Variables are
  `Record<string, string>`; a caller that has a list joins it.
- No escape for a literal `{{`.
- One body per row, and no `system` field. A Step that needs a system half
  and a task half fills two Templates.
- A bound value is text, never a Template: a value containing `{{secret}}`
  is inserted as it is and scanned by nothing.

## API

- `prompt` — the plugin definition, id `eva.prompt`. It reads `prompts` and
  writes the rows into the prompt Domain.
- `project(raw)` — the pure projection from the raw `prompts` mapping to
  `PromptInfo` rows, dropping what it cannot read.

## Development

Tests live beside the sources: [src/project.test.ts](src/project.test.ts)
holds the projection rules and [src/index.test.ts](src/index.test.ts) the
Domain behavior, including the same-id replace. The join with `eva.workflow`
is proved in
[packages/conformance/src/workflow-prompt.test.ts](../../packages/conformance/src/workflow-prompt.test.ts).
Run the suite from the repository root:

```bash
bun run test
```
