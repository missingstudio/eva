# Issue tracker: local markdown

Issues and specs for this repo live as markdown files under `plans/`.

## Conventions

- One **stage** per directory: `plans/<stage>/`. A stage is named by its id in
  [roadmap.md](../roadmap.md): a factory stage is `stage-<n>` (`stage-1`,
  `stage-9a`), a surface or service stage is its lowercase letter id (`w0`,
  `w1`, `d0`, `m0`, `s1`).
- The spec is `plans/<stage>/README.md`. It carries what the stage builds on,
  the design decisions already settled, the plan table, and the exit test.
- Tickets are one file per plan at `plans/<stage>/NNN-<slug>.md`, numbered from
  `001`, never a single combined file. The slug is the plan's title in
  kebab-case, and a title is a **sentence** —
  `001-a-fold-says-where-it-folded-to.md`, not `001-fold-cursor.md`.
- The plan table in `README.md` is the index. Its columns are Plan, Title,
  Priority, Effort, Depends on, Status.
- **Blocking** is the `Depends on` column, naming plan numbers. A ticket is
  unblocked when every plan it names reads `DONE`.
- **Status** is the `Status` column: blank or `TODO`, then `DONE`. For an
  inbound issue that has been triaged, the role from
  [triage-labels.md](triage-labels.md) goes on a `Status:` line in the ticket
  file itself.
- Comments and conversation append to the bottom of the ticket under a
  `## Comments` heading.

## When a skill says "publish to the issue tracker"

Create the file under `plans/<stage>/`, creating the directory if needed. Add
its row to the stage's `README.md` plan table in the same edit — a ticket that
is not in the table is a ticket the next session will not find.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. Normally the path or the plan number is
passed directly.

## `plans/` is gitignored

`.gitignore` ignores `plans/`, so **a ticket and its DONE status never reach a
commit.** Three consequences that have each cost something already:

- Edit the status row anyway. It is how the next session knows where the stage
  stopped. Never try to `git add` it.
- A `grep` that honours gitignore never searches `plans/`. A search for a
  string that lives only in a plan returns nothing and reads as proof of
  absence. Use `command grep`, `rg --no-ignore`, or a `find`-driven scan when
  the answer could live in a plan.
- **There is no history to recover from.** A deleted plan is gone. Nothing here
  is a primary source: a decision worth keeping goes to `docs/adr/`, and a
  conclusion worth keeping goes to the roadmap.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `plans/<effort>/map.md` — the Notes, Decisions-so-far, and Fog body.
- **Child ticket**: `plans/<effort>/NNN-<slug>.md`, numbered from `001`, with
  the question in the body. A `Type:` line records `research`, `prototype`,
  `grilling`, or `task`; a `Status:` line records `claimed` or `resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top, or the `Depends on`
  column when the effort uses a plan table.
- **Frontier**: scan the directory for tickets that are open, unblocked, and
  unclaimed; lowest number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set
  `Status: resolved`, then append a context pointer to the map's
  Decisions-so-far.
