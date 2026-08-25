# Domain docs

How the engineering skills consume this repo's domain documentation. This repo
does not use the default paths, so read this before looking for a file that is
not there.

## Before exploring, read these

- **[`docs/context.md`](../context.md)** — the glossary. It is this repo's
  `CONTEXT.md` under its own name, and it is the single source of truth for
  what every term means.
- **`docs/adr/`** — the decision records. Read the ones that touch the area you
  are about to work in.

**Do not create `CONTEXT.md` at the repository root, and do not create a
`CONTEXT-MAP.md`.** `docs/context.md` already exists and is populated. A second
glossary is the exact failure it exists to prevent: one concept, one name.

If `docs/adr/` does not exist yet, **proceed silently.** Do not flag its
absence and do not suggest creating it upfront. `/domain-modeling` creates
records lazily, when a decision is actually resolved.

## The layout is single-context, by design

`package.json` declares workspaces — `apps/*`, `packages/*`, `plugins/*` — so
this repo looks like a candidate for a multi-context layout. It is not one.

One glossary covers every package on purpose. [The docs
conventions](../README.md) state the rule this follows: one document owns one
subject, and never duplicate — link instead, because two copies of a fact
become two different facts. A per-package `CONTEXT.md` would let `Session`,
`Run`, and `Surface` be defined three times, and the three would drift.

```
/
├── docs/
│   ├── context.md      the glossary — one, for the whole repo
│   ├── adr/            decision records
│   ├── roadmap.md      every stage and its exit test
│   ├── plan.md         what is next, and where code goes
│   └── reference/      consulted, not read
├── apps/               composition roots
├── packages/           libraries that register nothing
└── plugins/            everything that registers into an extension point
```

`docs/adr/` is gitignored, like `plans/`. A decision that must survive belongs
in a document that is committed — [roadmap.md](../roadmap.md) for what a stage
must prove, [context.md](../context.md) for what a word means.

## Use the glossary's vocabulary

When output names a domain concept — an issue title, a refactor proposal, a
hypothesis, a test name — use the term as `docs/context.md` defines it.

That file is stricter than a glossary usually is, and the strictness is the
point:

- Each entry carries an **`_Avoid_`** line naming the rejected words. Using one
  of those words is a defect, not a style preference. `Turn` unqualified is the
  worked example: it means two different things in four systems Eva touches, so
  the bare word is retired in favour of **Run**, **Step**, and **Provider
  Turn**.
- A **Deferred** table names machinery not built yet, with the stage that is
  likely to bring each term. A term there has no definition to honour yet.
- A **Retired** section says which words were removed and what replaced them.

If a concept is not in the glossary, that is a signal: either the language is
being invented and the project does not use it — reconsider — or there is a
real gap, and `/domain-modeling` should close it.

## Flag conflicts with a decision record

If output contradicts an existing record in `docs/adr/`, surface it rather than
silently overriding:

> _Contradicts the record on event-sourced orders, but worth reopening
> because…_

Reference a record by its file name. There is no `ADR-0007` numbering scheme to
cite.
