# Eva

Eva is an open-source, autonomous software factory. It is plugin-first: a
small kernel loads plugins, and every capability is a plugin — the model, the
tools, the harness, the session store, the sandbox, the agent loop, and every
user interface.

Eva ships its own native harness as a plugin. It also drives the harnesses
you already pay for as plugins, behind one contract, with one trace, one
verifier, and one bill.

## The six documents

The doc set is one document per subject, and the subjects are these:

| Document                           | Owns                                              |
| ---------------------------------- | ------------------------------------------------- |
| [product.md](product.md)           | what Eva is for, and who for                      |
| [architecture.md](architecture.md) | the shape of the whole system, and its boundaries |
| [roadmap.md](roadmap.md)           | what each stage is, and what it must prove        |
| [development.md](development.md)   | how a change is made, and each stage's state      |
| [context.md](context.md)           | what every term means                             |
| [reference/](#the-layout)          | the mechanisms, consulted rather than read        |

Two companions ride beside them. [plan.md](plan.md) is the roadmap's: what is
next, the order, and where code goes. [ux-dx.md](ux-dx.md) is
development.md's: how the base layer becomes good to use — the interaction
design for every door, and the refactoring it rests on. Neither holds a list
of work in flight.

## Read in this order

1. **[context.md](context.md)** — the words Eva uses. Short, and everything
   else assumes it.
2. **[architecture.md](architecture.md)** — the shape: the surfaces, the
   daemon, the control plane, the harness seam, and the layers a builder
   writes against.
3. **[roadmap.md](roadmap.md)** — every stage, what it proves, and the exit
   test it can fail.
4. **[plan.md](plan.md)** — what to build next, what can run beside it, and
   which directory the work goes in.

Then, as you need them:

| You want to                  | Read                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| Know what to build next      | [plan.md](plan.md)                                              |
| Find where a plugin goes     | [plan.md](plan.md)                                              |
| Make a change here           | [development.md](development.md)                                |
| Design a surface, or fix one | [ux-dx.md](ux-dx.md)                                            |
| Know how a mechanism works   | [reference/architecture.md](reference/architecture.md)          |
| Write a plugin               | [reference/writing-plugins.md](reference/writing-plugins.md)    |
| Type a command or a flag     | [reference/command-line.md](reference/command-line.md)          |
| Build or test the repo       | [reference/toolchain.md](reference/toolchain.md)                |
| Ship a release, install Eva  | [reference/ci-cd.md](reference/ci-cd.md)                        |
| Deploy a website             | [reference/hosting.md](reference/hosting.md)                    |
| Know what a door can do      | [reference/parity.md](reference/parity.md)                      |
| Know where the Trace lives   | [reference/trace-storage.md](reference/trace-storage.md)        |
| Use a color, a type step     | [design.md](design.md) and [ui-guidelines.md](ui-guidelines.md) |
| Know why something is so     | [reference/architecture.md](reference/architecture.md)          |
| Know what Eva is for         | [product.md](product.md)                                        |

## The layout

```
docs/
├── README.md          this map
├── context.md         the words Eva uses — read first
├── product.md         what Eva is for, and who for
├── architecture.md    the shape of the whole system, and its boundaries
├── roadmap.md         every stage, and the exit test it can fail
├── plan.md            what is next, the dependency order, and every path
├── development.md     how a change is made, and where each stage is
├── ux-dx.md           how the base layer becomes good to use — the standard, not the work
├── design.md          the design tokens — machine-linted
├── ui-guidelines.md   how the tokens become components on the two websites
├── agents/            the working rules an engineering agent follows here
└── reference/
    ├── architecture.md    the plugin model, the kernel, every module and interface
    ├── writing-plugins.md the authoring walkthrough
    ├── command-line.md    every command and flag, and how they are parsed
    ├── toolchain.md       Vite+, Bun, TypeScript, CI, day-to-day commands
    ├── ci-cd.md           the workflow fleet, the release, every install channel
    ├── hosting.md         the two websites, and how each one is deployed
    ├── parity.md          what each door can do, and where each cell is proven
    └── trace-storage.md   where the Trace lives, and why
```

## Conventions

**Each document reads start to finish, in order.** A reader never jumps around
inside a file to follow it. No "see the section below", no forward references,
no `§4.1`. Say things where they belong, once, in reading order. One exception:
the `reference/` documents are consulted rather than read, so a numbered
reference may point across its own sections — each section still has to make
sense at the point of reading.

**Never duplicate — link instead.** If a fact belongs in another document, link
to that document. Two copies of a fact become two different facts.

**One document owns one subject.** The table at the top of this file and the
layout above are that ownership, one row per file. When two documents
disagree, one is wrong. Fix it — do not reconcile by copying.

**State has one owner.** Which stages are done, and what is left on the one
being built, live in the execution log in [development.md](development.md) and
nowhere else. Every other document is written to stay true while the work
moves: the roadmap describes a stage, never its progress; the plan holds the
order, never the position in it; and no document lists what exists on disk,
because `ls` answers that without going stale. When something changes, exactly
one file takes the edit:

| What changed                    | The one edit                              |
| ------------------------------- | ----------------------------------------- |
| a stage starts, moves, or lands | its row in development.md's execution log |
| a stage's design or exit test   | its section in roadmap.md                 |
| the dependency order            | the wave table in plan.md                 |
| a base-layer UX/DX obligation   | its section in ux-dx.md                   |
| what a word means               | context.md                                |
| a directory on disk             | no document — nothing lists the tree      |

**A committed document never sends a reader to an ignored path.** `plans/`,
`docs/adr/`, and `.eva/` are working state: a fresh clone has none of them, so
a line that says "the reasoning is in `docs/adr/`" or "the work is in
`plans/ux/`" points at nothing. Telling somebody where to **write** working
state is fine, and the agent rules do exactly that. Sending them there to
**read** is not.

**No plan lives here.** A document in `docs/` describes something that stays
true while the work moves — what Eva is, how it is shaped, what a stage must
prove, what good use looks like. A list of work in flight is a plan, and it
belongs with the tracker. The one thing in `docs/` that says _done_ is the
execution log in [development.md](development.md), and it says it one stage at
a time.

**No competitor or harness names.** The docs describe the field's designs
without naming who shipped them — "one surveyed harness", "a pattern proven in
the field". The evidence with the names lives in the survey directory beside
this repository, and only there. Dependency, provider, and platform names stay,
because config and install instructions need them.

**Add a directory when a second document needs it, not before.** This tree had
four empty directories once. Empty structure invites documents that exist to
fill it.

**Use ASD-STE100 Simplified Technical English.** Short sentences, active voice,
one instruction per sentence, consistent terms. The same word means the same
thing everywhere, and `context.md` says which word that is.

**Code in a document must compile.** Check every snippet against the pinned
Effect version before it lands — by hand today; a CI snippet gate is still
wanted. A snippet that does not run is worse than no snippet, because a reader
trusts it.
