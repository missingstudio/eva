# @missingstudio/eva-approval

Named permission modes for [Eva](../../README.md), and the mandate half of the
four-option permission gate. A mode says which tools an agent is shown and what
it may do with them without asking.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
writes rows to the `agent`, `tool` and `command` domains that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares, and decides
at the `tool.execute.before` hook. The glossary in
[docs/context.md](../../docs/context.md) defines **Domain**, **Transform**,
**Hook** and **Slot**, and
[architecture.md](../../docs/reference/architecture.md) §4.2, §6 and §9.2 own
the domains, the boundary and this plugin's place in the build.

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

The Eva CLI already includes this plugin — it loads by default, after the tools
and after `eva.tool.policy`, because it removes rows the tools registered. To
use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-approval": "workspace:*" } }
```

## Usage

One config key, `approval`:

```yaml
approval:
  mode: supervised
  modes:
    autonomous:
      tools:
        bash: ask
```

`/mode` names the mode a Session runs under:

```
eva > /mode read-only
mode: read-only
```

`/mode` with no argument says which mode is open and lists the four.

## The four modes

| Mode         | Tools it is shown  | A call that may change something |
| ------------ | ------------------ | -------------------------------- |
| `read-only`  | reads and searches | refused, as a mandate            |
| `plan`       | reads and searches | refused, as a mandate            |
| `supervised` | every tool         | a person is asked                |
| `autonomous` | every tool         | runs                             |

`read-only` and `plan` are shown the same tools and differ in what they tell the
model to do with them: one is a restraint, the other is a task. Every mode
reads, because a mode in which an agent cannot read is a mode in which it cannot
start.

Which tools "read and search" means is not a list of names. A mode selects by
what a tool **does** — its `kind` — so a tool that loads tomorrow is selected by
what it does rather than by whether somebody listed it, and a kind this build
does not know is treated as one that changes something.

## A mode is capability selection, not a filter

Changing the mode **rebuilds the tool domain**. The agent is shown a different
domain rather than the same domain with rows refused at call time: a filter
is a list the model was offered and then denied from, and a rebuild is a list
that never held the row. A call naming a row the mode removed is
`unknown_tool`, which is the execution's own refusal and not this plugin's.

The rebuild publishes `tool.updated` by itself, so a mode needs no broadcast of
its own.

**One honest limit.** A domain is process-wide and a mode is per Session. With
two Sessions open in one process the domain is built to the widest live mode,
and each Session's own **mandate** is what refuses — so a `read-only` Session
beside an `autonomous` one may be _shown_ a tool it can never _run_. The strict
side is at the gate, where it decides. With one Session, which is the
interactive case, the domain is exactly that Session's mode.

## Per-tool overrides narrow, and never widen

An override is `ask` or `deny`. There is no `allow`, and a config file that
writes one is a fault that says so. A mode is what widens; an override a person
could write to open a tool their mode closed is exactly the widening a
repository-checked-in profile must never do.

A `deny` override is a mandate — `reject_always`. An `ask` override asks about
one tool in a mode that would not have.

## Narrow, never widen — as a property of the boundary

Every hook at `tool.execute.before` states a decision and **the strictest one
wins**. So:

- a repo profile's `allow` rule can never beat a mode's `reject_always`;
- a repo profile's `deny` or `ask` rule narrows a mode that allows;
- a protected path still asks, whatever any rule or mode says, because the
  deterministic gate computes that first and nothing reaches its ordering.

None of that is a check in this file. It is the ranking, and it holds whatever
order the plugins loaded in.

**Supervision is a baseline, not a decision.** `event.otherwise` is what a mode
supervises with, and a baseline is read only when nothing at the boundary
decided. That is what makes a rule a person already wrote standing authority:
the mode does not ask about a call the rule set already answered, and it never
had to read another plugin's rules to know so.

The mode a repository may set is only read after a person granted that
directory trust, which is the same gate that decides whether a project file may
name a plugin at all.

## What `allow_always` writes, and where

The four options separate the decision from how long it persists.
`allow_always` writes an `allow` rule into the person's own config file —
`~/.eva/config.yaml`, or wherever `EVA_CONFIG` names — under `policy.rules`,
which is the rule language the deterministic gate already reads. So the next
Run answers from the rule, and nobody is asked again.

```yaml
policy:
  rules:
    - allow:
        - [git]
        - [push]
      why: "a person allowed this: run git push?"
```

A person reads their grants by opening that file, and checks them with
`eva policy check ~/.eva/config.yaml`. Removing a grant is deleting the entry.

The grant never goes in the repository's profile. A grant a person gave belongs
beside their own settings, for the same reason the trust list does: a repository
that shipped a file granting itself permission is a repository making a claim
about itself.

**One honest limit.** The rule language grants over the **words a command would
run**. A call that names a file instead — an edit — has no words to write a rule
about, so `allow_always` there allows the call and remembers nothing. That is
also the right answer: pre-approving every edit forever from one keystroke is a
standing grant, and a standing grant is a mode.

## What it does not do

- It does not reach the person. The surface that holds one is boot's, and
  `overSurface` there is what asks; this plugin decides and remembers.
- It does not decide allow or deny from rules. That is `eva.tool.policy`, and
  the two meet at the boundary rather than in each other's code.
- It does not draw the question. The permission card on each surface is its
  own work.
- It does not fill `AgentInfo.tools` on the rows it writes. A mode selects by
  what a tool does, and a name list beside that rule would go stale the moment
  a tool loads.

## API

- `approval` — the plugin definition, id `eva.approval`.
- `MODES`, `modeInfo(id)`, `isMode(id)` — the four modes and their rows.
- `reaches(reach, kind)`, `widest(modes)`, `mandateOf(mode, kind, name)` — the
  selection and the mandate, for a suite that wants them without a kernel.
- `readApproval(value)`, `approvalOf(config)` — the one reader of the
  `approval` key, faults collected.
- `remembering(asking, env?)` — an asker that writes the grant when the answer
  says always. The composition root wraps boot's asker in this.
- `writeGrant(path, rule)`, `grantedRule(words, why)` — the grant itself, for
  a suite or a tool that wants to read one.

## Development

Tests live beside the source: [src/mode.test.ts](src/mode.test.ts) holds the
modes and the reader, [src/grant.test.ts](src/grant.test.ts) the grant on disk,
and [src/index.test.ts](src/index.test.ts) the selection and the mandate through
a live kernel. The two gates meet in
[packages/conformance](../../packages/conformance/README.md). Run the suite from
the repository root:

```bash
bun run test
```
