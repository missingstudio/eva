# Eva

Eva is an open-source, AI-native software factory. It is plugin-first: a small
kernel loads plugins, and every capability is a plugin — the model, the tools,
the harness, the session store, the sandbox, the agent loop, and every user
interface.

Eva ships its own native harness as a plugin. It also drives the harnesses you
already pay for as plugins, behind one contract, with one trace, one verifier,
and one bill.

## Read in this order

1. **[context.md](context.md)** — the words Eva uses. Short, and everything else
   assumes it.
2. **[reference/architecture.md](reference/architecture.md)** — how Eva is put
   together: the four extension points, the kernel, every module and interface.
3. **[roadmap.md](roadmap.md)** — every stage, what it proves, and the exit test
   it can fail.
4. **[plan.md](plan.md)** — what to build next, what can run beside it, and
   which directory the work goes in.

Then, as you need them:

| You want to                 | Read                                                         |
| --------------------------- | ------------------------------------------------------------ |
| Know what to build next     | [plan.md](plan.md)                                           |
| Find where a plugin goes    | [plan.md](plan.md)                                           |
| Make a change here          | [development.md](development.md)                             |
| Write a plugin              | [reference/writing-plugins.md](reference/writing-plugins.md) |
| Type a command or a flag    | [reference/command-line.md](reference/command-line.md)       |
| Build or test the repo      | [reference/toolchain.md](reference/toolchain.md)             |
| Ship a release, install Eva | [reference/ci-cd.md](reference/ci-cd.md)                     |
| Know why something is so    | `adr/` — decision records, local to a checkout               |
| Know what Eva is for        | [product.md](product.md)                                     |

## The layout

```
docs/
├── README.md          this map
├── context.md         the words Eva uses — read first
├── development.md     how a change is made, and where each stage is
├── product.md         what Eva is for, and who for
├── roadmap.md         every stage, and the exit test it can fail
├── plan.md            what is next, the dependency order, and every path
├── adr/               decision records — gitignored, local to a checkout
└── reference/
    ├── architecture.md    the plugin model, the kernel, every module and interface
    ├── writing-plugins.md the authoring walkthrough
    ├── command-line.md    every command and flag, and how they are parsed
    ├── toolchain.md       Vite+, Bun, TypeScript, CI, day-to-day commands
    └── ci-cd.md           the workflow fleet, the release, every install channel
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

**One document owns one subject:**

| Document             | Owns                                         |
| -------------------- | -------------------------------------------- |
| `context.md`         | what every term means                        |
| `architecture.md`    | how the mechanisms work                      |
| `writing-plugins.md` | how to author a plugin, and the traps        |
| `command-line.md`    | every command and flag, and the parse        |
| `toolchain.md`       | how to build and test, and CI's jobs         |
| `ci-cd.md`           | the workflows, the release, the channels     |
| `roadmap.md`         | what each stage is, and what it must prove   |
| `plan.md`            | what is next, the order, and where code goes |
| `development.md`     | how a change is made, and each stage's state |
| `adr/`               | what we decided, and what we rejected        |
| `product.md`         | what Eva is for, and who for                 |

When two documents disagree, one is wrong. Fix it — do not reconcile by copying.

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
| what a word means               | context.md                                |
| a directory on disk             | no document — nothing lists the tree      |

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
