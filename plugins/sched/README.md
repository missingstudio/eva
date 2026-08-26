# @missingstudio/eva-sched

The parallel-safety policy for [Eva](../../README.md). One provider response
proposes a group of tool calls; this plugin is where a build says which of them
may run beside another.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
edits rows in the `tool` domain that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares, and the
group runner it edits them for lives in
[`@missingstudio/eva-core`](../../packages/core/README.md). The glossary in
[docs/context.md](../../docs/context.md) defines **Domain**, **Transform** and
**Barrier**, and [architecture.md](../../docs/reference/architecture.md) §4 and
§9.2 own the domain and this plugin's place in the build.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). A plugin's effect answers an `Effect`.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default, after the
tools, because it edits rows they registered. To use the package from another
workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-sched": "workspace:*" } }
```

## Usage

The plugin takes one option: the tools this build refuses to run in parallel,
whatever they claim.

```yaml
plugins:
  - id: eva.sched
    options:
      serial: [web]
```

A name no row holds is reported as a missed edit through `tool.updated`, so a
rule against a tool that is not loaded is visible rather than quiet.

## The policy, whole

A tool claims that one of its calls may run beside another through
`parallelSafe(input)` on its own row. The claim reads the arguments, so a tool
that is safe for one input and not for another says which is which per call.
The runtime then holds every group to four rules:

- A row that carries no claim is **unclassified** and runs alone.
- A row whose claim answers `false` for this call's arguments runs alone.
- A row whose claim throws runs alone: a classifier that cannot answer has not
  said yes.
- A row named in `serial` loses its claim, so it runs alone as well.

Nothing here makes a tool parallel-safe. There is no `parallel` option, and
that is the point: a tool that shares state with its own next call is the only
thing that knows so, and a person who could mark one safe from a config file
would be overruling the author of the code that runs. **The policy narrows and
never widens.**

The claim is taken off the row rather than answered `false`, so the row reads
as what it now is — a tool this build has not classified.

## What the group does with the answer

The group runner is `executeToolGroup` in
[`@missingstudio/eva-core`](../../packages/core/README.md). A run of
consecutive parallel-safe calls is one window and runs together under a bound;
every other call is a **barrier** and is a window of one, so everything before
it commits before it starts and nothing after it starts until it has committed.

A parallel window's records are held until the window ends and then commit call
by call in source order, so the Trace reads the same bytes whichever call
finished first. A barrier emits straight through, because nothing runs beside
it — which is how a command that streams its output still streams.

Which tools ship classified today: `read`, `grep`, `glob` and `web` claim
safety, because none of them changes anything. `edit` and `bash` claim nothing,
so both are barriers.

## What it does not do

- It does not decide whether a call may run at all. That is the
  `tool.execute.before` boundary, and the gate is a plugin of its own.
- It does not schedule anything itself. Ordering a group is group-shaped work
  and a hook fires per call, so the algorithm is core's and the policy is this
  plugin's.
- It does not set the bound on a window. The ceiling is `TOOL_GROUP_LIMIT`,
  and the caller that runs the group may lower it.
- It does not order Runs, Sessions, or workers. A **Scheduler** in Eva admits
  work to workers, which is a different thing and a later stage.

## API

- `sched` — the plugin definition, id `eva.sched`. With no `serial` option it
  registers nothing and every tool's own claim stands.
- `serialNames(options): readonly string[]` — the names the option holds, for a
  suite that wants the reading without a kernel.

## Development

Tests live beside the source: [src/index.test.ts](src/index.test.ts) holds the
option reading, the narrowing through a live kernel, and one group of calls end
to end through the pipeline. Run the suite from the repository root:

```bash
bun run test
```
