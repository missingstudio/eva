# Eva

> **Status.** The ladder, the primitive, both references, and the roadmap are drafts.
> Stage 0 is built; the other eighteen stages are not.

Eva goes from a single model call to an autonomous, multi-tenant software factory.
This page is the map. It holds no argument of its own. Each document below owns its
part, and this page says which one to open.

## Where each thing is written

| Document                                                           | Answers                                                           | Kind        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------- |
| [tutorial/first-run.md](tutorial/first-run.md)                     | I have never run Eva. Show me.                                    | Tutorial    |
| [how-to/](how-to/)                                                 | I need to do one specific thing.                                  | How-to      |
| [explanation/the-ladder.md](explanation/the-ladder.md)             | Why does a factory need ten rungs, and in what order?             | Explanation |
| [explanation/the-primitive.md](explanation/the-primitive.md)       | What is the one type, and why that shape?                         | Explanation |
| [explanation/the-service-seam.md](explanation/the-service-seam.md) | Where does an interface attach, and what does Eva promise it?     | Explanation |
| [reference/commands.md](reference/commands.md)                     | What can I type, and what key does what?                          | Reference   |
| [reference/configuration.md](reference/configuration.md)           | What can I set, and what does it default to?                      | Reference   |
| [reference/architecture.md](reference/architecture.md)             | What is the event schema, the adapter contract, the hook surface? | Reference   |
| [reference/platform.md](reference/platform.md)                     | How do tenancy, isolation, and billing work?                      | Reference   |
| [roadmap.md](roadmap.md)                                           | What ships in which order, and what is the exit test?             | Roadmap     |
| [../CONTEXT.md](../CONTEXT.md)                                     | What does this word mean?                                         | Glossary    |
| [decisions.md](decisions.md)                                       | What has been decided, and why?                                   | Decisions   |

Open [the ladder](explanation/the-ladder.md) for the argument. Open
[the roadmap](roadmap.md) for the build order. Open
[the tutorial](tutorial/first-run.md) to get it running.

## Where the old Parts went

This page was one document of six numbered Parts until 2026-08-10. Earlier ADRs cite
those numbers, and nothing in `adr/` is ever rewritten, so the mapping stays here:

| Cited as                                        | Now                                                          |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Part 0 — The frame                              | [explanation/the-ladder.md](explanation/the-ladder.md)       |
| Part 1 — The primitive                          | [explanation/the-primitive.md](explanation/the-primitive.md) |
| Part 2 — Target architecture                    | [reference/architecture.md](reference/architecture.md)       |
| Part 3 — Production platform                    | [reference/platform.md](reference/platform.md)               |
| Part 4 — The build path, and every stage number | [roadmap.md](roadmap.md)                                     |
| Part 5 — Sequencing rules, and the rule numbers | [explanation/the-ladder.md](explanation/the-ladder.md)       |
| The final-repo-shape section                    | [reference/architecture.md](reference/architecture.md)       |

## What later decisions override here

The event schema is settled and is no longer a draft. It was resolved on 2026-08-08
and now lives in [`adr/0001`](adr/) to `adr/0008`, which own the reasoning.
[reference/architecture.md](reference/architecture.md) carries the resulting shape only.

Five further decisions override this document:

| Decision                                                                              | What it fixes                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`adr/0009`](adr/0009-config-and-profiles-are-toml.md)                                | Config and profiles are TOML, decoded strictly                                                         |
| [`adr/0010`](adr/0010-core-is-pure-so-io-lives-beside-it.md)                          | The layer graph, which differs from the tree in [reference/architecture.md](reference/architecture.md) |
| [`adr/0021`](adr/0021-the-repository-is-one-module-and-internal-is-the-default.md)    | One module, with those layers under `internal/`                                                        |
| [`adr/0045`](adr/0045-the-harness-is-a-layer-and-eva-is-one-entry-in-its-registry.md) | The Harness is a layer that lands early, and selection is a registry                                   |
| [`adr/0046`](adr/0046-the-wire-is-the-public-surface-and-internal-stays-internal.md)  | What Eva promises code it did not write, and that no package leaves `internal/`                        |

Where any document mapped above and an ADR disagree, the ADR wins.

## Two decisions that bind every page

**Implementation language: Go.** Use interfaces, not inheritance. Use one module,
with the layers under `internal/`. Keep imports between layers one-way. Every code
sketch in these documents is Go.

**Name: Eva.** Decided on 2026-08-08. Eva collides with no coding agent and no
factory. The nearest names are a voice-agent eval framework, a pentest agent, and an
Emacs assistant. Eva also reads as *eval* and *evidence*, which fits a
verifier-centric factory.
