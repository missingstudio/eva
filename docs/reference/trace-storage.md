# Trace storage

The Trace is the only source of truth Eva has. Every projection is a fold over
it, and anything the Trace cannot rebuild is a bug —
[context.md](../context.md) says so, and the whole read half of the system
depends on it being true.

That makes **where the Trace lives** a load-bearing decision, and today the
answer is one file. This document owns that decision: what the one file costs,
where it gives out, what every other harness does instead, and what Eva should
do about it.

[architecture.md](architecture.md) owns the slot mechanics — how a sink is
loaded, swapped, and sequenced. This document owns the store beneath it.

Every number here was measured on this repository, against the sink and the
session store as they stand at `135aa4d`, on Apple silicon with APFS and
Bun 1.4.0. The last section says how to repeat them.

> **Status.** The plan below is ratified and built. `eva.trace.sqlite` is the
> default sink and imports a legacy `trace.jsonl` at first open;
> `eva.trace.jsonl` is one file per Session in a directory, listed by first
> line and `mtime`; `eva.trace.postgres` fills the same slot from config.
> `TraceStore` allocates in the store, `SessionStore.list` states its order,
> and `newSessionID` is time-ordered.
>
> Since then, four things the first cut left loose: the two SQL stores share
> one row-shaped store in `packages/core/src/rows.ts` and differ only in
> their lock; a re-committed group answers with the positions it already
> holds, which is the idempotency `id UNIQUE` was always meant to buy; a
> cached Header records the fold rule that wrote it, so a rule that moves
> costs one replay per Session rather than a listing that is quietly wrong;
> and reading a Trace back from JSONL has one owner in
> `packages/core/src/archive.ts`.
>
> Still open: the archive **export** with its manifest (S2's exit test), and
> cross-process `follow`. The sections below keep the measurements and the
> reasoning as they were decided.

## What the Trace is today

One file. `~/.eva/trace.jsonl`, every Session interleaved, one JSON object per
line, each Session numbered from 1.

Three pieces make it work. `sequenced` in
[packages/core/src/sink.ts](../../packages/core/src/sink.ts) owns the
numbering rule and holds a high-water map in memory. `makeJsonlStore` in
[plugins/trace-jsonl/src/sink.ts](../../plugins/trace-jsonl/src/sink.ts) owns
the bytes. `makeSessionStore` in
[plugins/session-jsonl/src/index.ts](../../plugins/session-jsonl/src/index.ts)
folds the records back into Sessions and stores nothing of its own.

The store has one read primitive, `walk`. It reads the whole file with
`readFileSync`, splits it on newlines, and decodes every line. `replay` walks
and keeps the lines of one Session. `sessions` walks and collects the ids.
`recover` walks at open to find each Session's high water.

Every read is therefore a read of the whole Trace:

| Call              | Whole-file walks                     |
| ----------------- | ------------------------------------ |
| open the sink     | 1 — `recover`                        |
| `sink.replay(id)` | 1                                    |
| `sink.sessions`   | 1                                    |
| `store.open(id)`  | 1                                    |
| `store.fold(id)`  | 1                                    |
| `store.list`      | **1 + one for every Session listed** |

The last row is the one to look at. `list` calls `sink.sessions` to name the
Sessions, then calls `replay` once per Session to build each Header. Listing
N Sessions reads the file N+1 times.

## What one file costs

The measurements below use a synthetic Trace shaped like a real corpus: 4.1 KB
per line and 120 Events per Session, which is what 879 Claude Code session
files on this machine average across 1.07 GB and 262,517 records.

| Trace  | Sessions | Open sink | Replay one Session | `sessions` | Peak RSS |
| ------ | -------- | --------- | ------------------ | ---------- | -------- |
| 10 MB  | 20       | 12 ms     | 10 ms              | 9 ms       | 147 MB   |
| 97 MB  | 200      | 93 ms     | 103 ms             | 88 ms      | 724 MB   |
| 483 MB | 1,000    | 805 ms    | 1,123 ms           | 758 ms     | 1,749 MB |
| 966 MB | 2,000    | 1,966 ms  | 2,626 ms           | 2,710 ms   | 1,640 MB |

Reading the bytes is not the cost. `readFileSync` on the 966 MB file takes
221 ms; the other 2.4 seconds are `JSON.parse` and the Zod envelope, run
240,000 times to return the 120 records one Session asked for.

`list` multiplies that:

| Trace  | Sessions | `store.list` | Peak RSS |
| ------ | -------- | ------------ | -------- |
| 10 MB  | 20       | 0.2 s        | 198 MB   |
| 97 MB  | 200      | **15.0 s**   | 838 MB   |
| 483 MB | 1,000    | **679.5 s**  | 2,319 MB |

Fifteen seconds to draw a session list is not a slow page. It is a page that
does not work. Eleven minutes is not a page at all. The cost is one whole-file
walk for every Session listed, so it grows as Sessions times bytes — a 50×
corpus costs 45× more.

Peak RSS matters as much. The 483 MB file needs 1.7 GB of resident memory to
answer one `replay`, because the file becomes a JS string, the split becomes
120,000 more, and every decoded Event is a fresh object graph.

Eva's own Trace today is 57 KB and 179 records, at 322 bytes per line. Nothing
above is a live problem. All of it is a problem that stage 2 creates, because
a tool loop commits `tool_call`, `tool_update`, and `tool_result` where stage 1
commits one `text`.

## Where the one file gives out

Five separate faults. Two are correctness, and they are the serious ones.

### One bad line hides every record after it

`walk` and `recover` both stop at the first line they cannot decode. In one
shared file, the records after a bad line belong to every Session, not to the
Session that wrote it.

Feed `recover` a four-record Trace with one undecodable line in the middle and
the high-water map comes back missing a Session that has records on disk:

```
clean             { "highWater": { "a": 2, "b": 2 } }
one bad line      { "highWater": { "a": 2 } }
```

Session `b` still has two records in the file. Recovery says it has none. The
next commit to `b` is numbered 1, and now two different Events on disk claim
`(b, 1)`. The Cursor on the wire is a trace position, so an ambiguous position
is an ambiguous resume.

### The first schema bump erases the Trace

`decode` refuses any record whose `version` is not `SCHEMA_VERSION`, and
`SCHEMA_VERSION` is 1 with no migration path —
[packages/schema/src/codec.ts](../../packages/schema/src/codec.ts) says as much
in a comment. That is a reasonable decision before anything ships. In one
shared file it has an unreasonable consequence:

```
all records bumped to v2      { "highWater": {} }
```

The walk stops on line 1. Every Session's high water reads as zero, every
Session renumbers from 1, and `replay` returns nothing for any of them. One
version bump costs the whole Trace at once, rather than costing each Session
its own history.

### Nothing is ever removed

There is no rotation, no compaction, and no delete. Deleting one Session means
rewriting the file. The file only grows, and every read grows with it.

### One process owns the numbering

`sequenced` reads the high water once at open and keeps it in memory. Two Eva
processes on the same file both believe they own the next number.

The live stream has the same shape. `follow` is an in-process `PubSub` in
`sequenced`, and the payload hub in
[packages/boot/src/session.ts](../../packages/boot/src/session.ts) is another
one. A page served by `eva serve web` cannot see what `eva` in another
terminal commits, even though both write the same file.

### The durability is weaker than the README says

`append` calls `fsyncSync` per group, and
[the plugin README](../../plugins/trace-jsonl/README.md) calls the result
"fsynced per group". On macOS, `fsync(2)` does not flush the drive's write
cache; `F_FULLFSYNC` does. The same 200 fsynced appends, same file, same
machine:

| Runtime         | Per fsync |
| --------------- | --------- |
| Bun 1.4.0       | 36 µs     |
| Node 22 (libuv) | 3,953 µs  |

libuv asks macOS for `F_FULLFSYNC`. The 110× gap says Bun does not. A group is
therefore durable against `kill -9`, which is what the torn-tail recovery is
built for, and not durable against power loss. That is a defensible choice. It
is not the choice the README describes.

## How other harnesses store a Trace

Nine stores, read either from their own state on this machine or from their
source. The first column is the unit of storage.

| Harness            | Unit                  | Layout                                                                           | Position                      | Index                                     |
| ------------------ | --------------------- | -------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| Claude Code        | one file per Session  | `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`                                     | file order + `parentUuid`     | none                                      |
| Codex CLI          | one file per Session  | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`                         | file order                    | `threads` table in `state_5.sqlite`       |
| Codex app server   | database row          | `thread_timeline_ledger(host_id, thread_id, sequence, record_id, payload_json)`  | per-thread `sequence`         | the table                                 |
| Grok CLI           | directory per Session | `~/.grok/sessions/<url-encoded cwd>/<uuid>/events.jsonl` and siblings            | file order                    | `session_search.sqlite`                   |
| mux (Coder)        | two files per Session | `~/.mux/sessions/<workspace>/chat.jsonl` + `chat-archive.jsonl`                  | per-workspace seq             | none                                      |
| opencode           | database row          | `event(id, aggregate_id, seq, type, data)` + `event_sequence(aggregate_id, seq)` | per-aggregate seq             | `UNIQUE(aggregate_id, seq)` + projections |
| Cursor             | database row          | `cursorDiskKV` keyed `bubbleId:<composer>:<bubble>`                              | order held in the head record | the table                                 |
| emdash             | database row          | `conversation_records` (Drizzle/SQLite)                                          | n/a                           | the table                                 |
| tau (Hugging Face) | one file per Session  | JSONL, `append` and `read_all`                                                   | file order                    | none                                      |

**Not one of them keeps every Session in one append-only file.** That is the
survey's finding, and it is unanimous. The four that use a database use one
file, but it is indexed rather than scanned.

The rest of the survey is about what they do with the pieces.

### One file per Session is the default

Claude Code, Codex CLI, and tau all take the same shape: append-only JSONL, one
file, one Session. It costs nothing to build, `replay` is a single file read,
and deleting a Session is `unlink`.

Claude Code shards by working directory before it shards by Session, so a
project's sessions sit together. Codex shards by date instead, so
`~/.codex/sessions/2026/07/27/` bounds any one directory to a day. Both moves
answer the same question: what stops one directory from holding fifty thousand
entries.

Claude Code carries no sequence number at all. Ordering is file order, and
structure is a `parentUuid` chain — which is a tree rather than a line, and is
how rewind and branching work at all. Mutable facts arrive as later records
that a fold resolves last-write-wins: one 626-record session file on this
machine holds 46 `ai-title`, 46 `custom-title`, and 40 `last-prompt` records
for a single Session — mutable metadata, appended 132 times.

Codex puts a `session_meta` record on line 1 with the cwd, the CLI version, the
model provider, and the full base instructions, so a rollout file is
self-describing without an index.

### The ones that grew added an index beside the log

Codex keeps the rollout files and added `~/.codex/state_5.sqlite`, whose
`threads` table holds one row per Session — `rollout_path`, `title`, `cwd`,
`tokens_used`, `git_branch`, `archived`, `recency_at`, `project_id`, and
fifty migrations' worth of the rest. The log stays the record. The table
answers "which Sessions exist, newest first" without opening a single rollout
file. Grok CLI does the same thing with `session_search.sqlite` beside its
per-Session directories.

This is the pattern Eva's `list` needs. It is the whole of what `list` costs
today.

### mux rotates at the compaction boundary

mux splits one Session's history in two: `chat.jsonl` holds the active epoch,
and `chat-archive.jsonl` holds everything before the last durable context
boundary. Its own comment says why — so that per-turn reads and rewrites stay
"O(active epoch) instead of O(lifetime history)".

Two details are worth stealing. The sequence counter is seeded from the archive
when the active file is missing, so rotation never re-uses a number. And a
workspace lock is held while both files are scanned, so a reader never sees the
seam mid-rotation.

### opencode moved the log into SQLite

opencode's event store is the closest thing in the survey to Eva's:

```sql
CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);
CREATE TABLE event (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL);
CREATE UNIQUE INDEX event_aggregate_seq_idx ON event (aggregate_id, seq);
CREATE INDEX event_aggregate_type_seq_idx ON event (aggregate_id, type, seq);
```

`aggregate_id` is Eva's `session`. `event_sequence` is Eva's high water, made
durable rather than held in memory. The append path allocates the next `seq`
inside the write transaction, refuses an id that already exists, and refuses a
`seq` that is not exactly one past the current one — so a second process
cannot collide, and a replay that diverges is a named error rather than a
corrupt Trace. Reads are `WHERE aggregate_id = ? AND seq > ? ORDER BY seq`,
which is a Cursor read.

opencode also keeps projection tables — `message`, `part`, `session` — so a
list or a transcript is a query, not a fold. Eva folds on every read instead,
which is a cleaner rule and a slower one.

Codex's app server reaches the same place by a different road:
`thread_timeline_ledger(host_id, thread_id, sequence, record_id, payload_json)`,
`WITHOUT ROWID`, unique on `(host_id, thread_id, record_id)`. Composite primary
key of thread and position, idempotency by record id. It is Eva's envelope with
the payload as a JSON column.

### What the survey agrees on

- **Split by Session.** Everyone does. The unit of read, the unit of delete,
  and the unit of corruption should all be one Session.
- **Shard the directory.** By cwd, by date, or by workspace. Something has to
  bound the fan-out.
- **Keep the index separate from the log.** Every harness that outgrew a
  linear scan added a table beside the files rather than a bigger scan.
- **A per-Session sequence is what a live wire needs.** The harnesses with a
  cursor-resumable stream — opencode, the Codex app server, mux — all number
  per Session. The ones that only replay from a file do not bother.

Eva already has the last one. The Cursor is a trace position, and `seq` is the
only sequence. That rules out the file-order designs and puts Eva with
opencode.

## Three shapes, priced

The same corpus, stored three ways, measured the same way.

Reads, on the 966 MB / 2,000-Session corpus:

| Operation                | One JSONL file | File per Session | SQLite   |
| ------------------------ | -------------- | ---------------- | -------- |
| List every Session       | 2,710 ms       | 2 ms             | 1 ms     |
| Replay one Session       | 2,626 ms       | 3 ms             | 12 ms    |
| High water, one Session  | 1,966 ms       | 0.2 ms           | 2 ms     |
| High water, all Sessions | 1,966 ms       | 1,323 ms         | 2 ms     |
| Cursor read, `seq > n`   | 2,626 ms       | 3 ms             | <1 ms    |
| Peak RSS                 | 1,640 MB       | 1,007 MB         | 559 MB   |
| Bytes on disk            | 966 MB         | 966 MB           | 1,134 MB |

Writes, 2,000 groups of about 470 bytes each:

| Writer                           | Per group |
| -------------------------------- | --------- |
| JSONL append, no fsync           | 2 µs      |
| JSONL append + fsync             | 29 µs     |
| SQLite WAL, `synchronous=normal` | 51 µs     |
| SQLite WAL, `synchronous=full`   | 253 µs    |

Read this as one trade and not three. The append-only file wins the write by
an order of magnitude and loses every read by two or three. SQLite costs 17%
more disk and 20–200 µs a commit, and makes every read constant-time.
Splitting the file costs nothing at all and fixes every read except the
all-Sessions high water — and that one only exists because of the shape of
Eva's own contract.

Eva commits a handful of groups a Run. It reads on every attach, every reload,
and every session list. The write column is the one that does not matter.

## What Eva should do

**Go to SQLite now, and keep JSONL as the export.** One migration, not three.

The case rests on one fact: Eva's Trace is 57 KB and 179 records today. There
is nothing to migrate. Every month this waits, the migration gets more
expensive and buys the same thing.

### The driver is free, and it is portable

`node:sqlite` is in the standard library. It needs no dependency, no native
build step, and no lockfile entry, and it runs under both of Eva's runtimes:

| Runtime               | `node:sqlite` | WAL, `synchronous=normal` | WAL, `synchronous=full` |
| --------------------- | ------------- | ------------------------- | ----------------------- |
| Bun 1.4.0             | works         | 43 µs a group             | 177 µs a group          |
| Node 22.23            | works         | 25 µs a group             | 80 µs a group           |
| `bun build --compile` | works         | —                         | —                       |

That matters more than it looks. [toolchain.md](toolchain.md) holds a runtime
boundary: a portable package claims `node` types and nothing else, and `vp
test` answers under Node. `bun:sqlite` would make the trace sink a Bun-only
leaf whose own tests cannot run. `node:sqlite` keeps it portable, and the
compiled binary carries it — proved by compiling a probe with
`bun build --compile` and running it.

It is also faster than `bun:sqlite`, which cost 51 µs a group at
`synchronous=normal` on the same machine.

One cost, and it is exact. `node:sqlite` stopped needing `--experimental-sqlite`
in Node **v22.13.0**, and `engines` in the root `package.json` says `>=22.12`.
The floor moves by one patch line.

### The store

```sql
CREATE TABLE event (
  session TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  id      TEXT NOT NULL UNIQUE,
  at      TEXT NOT NULL,
  run     TEXT NOT NULL,
  parent  TEXT,
  kind    TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (session, seq)
) WITHOUT ROWID;

CREATE TABLE session_head (session TEXT PRIMARY KEY, seq INTEGER NOT NULL);
```

`PRIMARY KEY (session, seq)` makes a duplicate trace position impossible rather
than unlikely — the fault a bad line produces today. `id UNIQUE` makes a
re-commit idempotent. `session_head` is Eva's high water, made durable instead
of held in one process's memory. It is opencode's `event`/`event_sequence` pair
under Eva's own names.

Against the 966 MB corpus this answers `list` in 1 ms, one Session's replay in
12 ms, and a Cursor read in under 1 ms, in 559 MB of resident memory. The one
file answers the same three in 2,710 ms, 2,626 ms, and 2,626 ms, in 1,640 MB.

### One contract has to invert first

This is the part that is not a plugin swap, and it is the reason to settle the
question before a second backend exists.

`sequenced` in [packages/core/src/sink.ts](../../packages/core/src/sink.ts)
reads `store.highWater` once at open, holds the map in memory, and stamps every
group **before** it calls `store.write`. A SQL store cannot use that and stay
correct across processes: the number must be allocated inside the same
transaction as the insert, or two writers race for it. opencode allocates in
the transaction and refuses a `seq` that is not exactly one past the current
one, which is why a second process cannot collide there.

So `TraceStore` inverts. The store owns the allocation and returns the stamped
group. Two pieces of `sequenced` survive, in different places:

- **Text coalescing** is genuinely universal, so it moves above the store and
  runs for every sink.
- **In-memory numbering** becomes a helper that a non-transactional store — the
  JSONL export sink, the memory sink — wraps itself in, rather than a rule
  every store inherits whether it suits them or not.

`sequenced` exists because two sinks paid the numbering rule separately and
drifted. The lesson holds; the shape of the rule does not survive contact with
a store that can number better than the caller can.

### JSONL becomes the export, one file per Session

Keep `eva.trace.jsonl`, and stop making it the default. It becomes what it is
actually good at: the portable archive, the thing a user can `grep`, the format
a Trace crosses a machine boundary in.

The roadmap already needs exactly this. S2's exit test is a tenant's complete
state exported as an archive, imported into a local single-tenant install, and
resumed there.

**One file per Session, in a directory, with a manifest beside them.** Not one
interleaved file, and not a bare directory.

One file per Session, because it makes the unit of export a Session. Sending
one Session to a colleague is `cp`; exporting a tenant is `tar` over the
directory. Interleaving every Session in one archive can do the second and
cannot do the first, and it carries every fault named earlier — one bad line
hiding the records after it, one schema bump costing all of them — into the
one artifact meant to survive a move.

The manifest is what makes the directory a listing rather than a pile, and the
next section is why it is not optional.

### Ordering is the thing a directory cannot answer

The page renders Sessions. **Nothing in Eva sorts them.**

`store.list` iterates `new Set([...onDisk, ...known])`, `session.list` in
[packages/boot/src/session.ts](../../packages/boot/src/session.ts) passes that
through, the API route maps it, and `Listing` in `apps/web/src/page.tsx` calls
`sessions.map`. There is not one `sort` in the path. The order a reader sees is
whichever order the store's walk happened to produce — first-commit order
today, by accident.

That is roadmap failure mode 2 waiting to happen: a terminal fold and a web
fold disagreeing about what Eva holds. **`SessionStore.list` has to state its
order — most recently updated first, id as the tiebreak — and every store owes
that same order.** This is a contract fix, and it is due whatever the storage
is.

Two facts then decide the JSONL layout.

**`readdir` order is arbitrary.** The first name back from a directory of 2,000
Session files on APFS was `sess_00000332`, not `sess_00000000`. A directory has
no default order at all.

**And a `SessionID` does not sort.** `newSessionID` in
[packages/core/src/local.ts](../../packages/core/src/local.ts) is `sess_` plus
the first 16 hex characters of a random UUID, so sorting the filenames sorts
nothing. Codex and Grok both mint UUIDv7 — `019eb9e3-…`, `01a025dd-…` — and get
creation order out of the id for free. **Make `newSessionID` time-ordered.** It
is one line, it costs nothing, and it buys filename order that means something,
a stable tiebreak for `list`, and a date shard derivable from the id if the
directory ever needs one.

What it does not buy is _updated_ order, which is what a session list wants.
Here is what each way of getting it costs, over 2,000 Sessions and 966 MB:

| Way to build the listing              | Titles | Cost       |
| ------------------------------------- | ------ | ---------- |
| One file today, `store.list`          | yes    | 679,500 ms |
| File per Session, fold every file     | yes    | 1,952 ms   |
| File per Session, first line + `stat` | yes    | 391 ms     |
| File per Session, `readdir` + `stat`  | no     | 5.8 ms     |
| File per Session + manifest           | yes    | 2.9 ms     |
| SQLite, `ORDER BY updated_at DESC`    | yes    | 1 ms       |

The first-line trick works — a title is the opening `started` record's intent
until an `info` overrides it, and `mtime` on an append-only Session file is its
last commit. It is 391 ms and 4,000 syscalls, and both of its shortcuts are
real: an `info` that renames a Session late is missed, and `mtime` does not
survive `cp -r`, an untarred archive, or a restore from backup.

So the manifest earns its place, 391 ms against 2.9 ms. And that is the finding
worth acting on: **a JSONL store needs an index to answer the one question the
page asks.** An index inside a live sink is a cache with a staleness problem, a
rebuild path, and a concurrent-writer question — which is SQLite, rewritten
worse.

An index inside an _archive_ is none of those things. It is a table of
contents, written once at export time by a store that already knows every
answer, and read once at import. That is Codex's `session_index.jsonl`, one
line per Session:

```jsonl
{
  "session": "sess_…",
  "title": "…",
  "createdAt": "…",
  "updatedAt": "…",
  "head": 412,
  "file": "sess_….jsonl"
}
```

Which settles it. `eva.trace.jsonl` should be one file per Session **as an
archive**, with a manifest, and it should stop being the default live sink. If
someone still wants to run on files — `--without-plugin eva.trace.sqlite`, a
machine with no SQLite, a Trace they want to `tail` — give them the same
directory with first-line-plus-`mtime` listing, say in the README that ordering
degrades on a restored copy, and do not build a live manifest for it. The
memory sink already covers tests and ephemeral runs, so nothing else depends on
JSONL staying live.

### The managed posture

The instinct — SQLite locally, something else hosted — is right, and the
roadmap already fixes its shape. Two rules bind it.

Phase VI says tenancy is a posture, not a fork: **one artifact, and every infra
service fills a Slot Eva already has.** So the hosted store is not a different
storage design. It is `eva.trace.postgres` filling the same `TraceSink` slot
that `eva.trace.sqlite` fills, chosen by config, with the same schema and very
nearly the same SQL.

S3 says what proves it: run one Workflow all-local, all-hosted, and mixed, and
diff the Traces. They must be identical except the filler names and the meter
events. **A plugin that can tell the difference is a defect.** That is the
acceptance test for a second backend, and it is already written down.

Three things differ between the two, and each is a decision rather than a
detail:

- **Who may allocate.** SQLite in WAL mode is one writer and many readers on
  one machine. Postgres is many writers on many machines. Both allocate in the
  transaction, so both are safe — but a hosted Trace also needs to say which
  worker owns the next number when a Session moves. opencode carries an
  `owner_id` on its sequence table for exactly this.
- **How `follow` wakes.** Today it is an in-process `PubSub`, which is instant
  and invisible across processes. SQLite across processes means polling
  `seq > cursor`; Postgres has `LISTEN`/`NOTIFY`. S3's test diffs Traces and
  not latency, so it passes either way — which means this one has to be
  designed deliberately rather than discovered.
- **Where cold Events live.** A hosted Trace grows without bound, and Postgres
  is an expensive place to keep a Session nobody has opened in a year. The
  answer in the field is mux's split at cloud scale: hot Events in the
  database, sealed segments in object storage. opencode's enterprise layer is
  the same shape — an S3-compatible adapter beside the local database.

None of that is work for now. All of it is work that gets cheaper if the local
store is already a transactional event table rather than a file.

### Why not the staged plan

One file per Session, then an index, then SQLite — three on-disk layouts and
three migrations to reach the same place. Worth doing if the trace were large
enough that a rewrite were risky. It is 57 KB.

File per Session does win one measurement: replaying a whole Session is 3 ms
against SQLite's 12 ms, because it is one sequential read with no index to
walk. It loses `list`, which needs a separate index built and kept in step. It
loses every Cursor read. It cannot make a duplicate trace position impossible,
and it does nothing for multi-process write or cross-process live. It is a good answer to the read problem and no answer at
all to the correctness problem.

Keep it in mind for one case only: if profiling later shows whole-Session
replay dominating, the fix is a projection table, not a return to files.

### The order

Two of these change no records and can land today, before any store moves:

1. **Give `list` an order.** Most recently updated first, id as the tiebreak,
   stated in the contract and held by a conformance test. Nothing sorts today,
   so the page and the terminal are one accident away from disagreeing.
2. **Make `newSessionID` time-ordered.** One line in
   [packages/core/src/local.ts](../../packages/core/src/local.ts), and the
   tiebreak above becomes meaningful.

Then the store:

3. **Invert `TraceStore`** so the store allocates. Both existing sinks keep
   working through the in-memory helper, and no records move.
4. **Add `eva.trace.sqlite`** and make it the default.
5. **Split `eva.trace.jsonl` by Session and give it a manifest**, as the
   archive. Drop it from the default plugin table.
6. **Write the import.** A JSONL archive loads into the store, which is S2's
   exit test and also the migration for anyone with a `trace.jsonl` already.

Separately and immediately, and independent of all of the above: either say
what `fsync` buys on this runtime in
[the plugin README](../../plugins/trace-jsonl/README.md), or pay for the
guarantee the README claims. A durability promise that is 110× cheaper than the
real thing is a promise someone will rely on.

## What changes, and what does not

The Trace stays the single source of truth. Every projection stays a fold.
`seq` stays the only sequence, and the Cursor stays a trace position. The
Recorder stays the one path an Event takes to the Trace, and it still stamps no
position — the store numbers now instead of the wrapper around it.

`Event`, `Payload`, the codec, and the wire are untouched. A record on the wire
and a record in an export are byte-identical to what they are today.

Three interfaces change, and deliberately.

`TraceStore` gains the allocation, and `TraceSink.highWater` narrows to one
Session. Both are internal to the composition root and to sink authors.

`TraceSink` gains `headers`, and it is the one member a consumer sees move.
It is not optional: a store that keeps Headers beside the log answers
cheaply, one that does not is folded behind the seam, and a caller has one
way to ask either. The optional half stayed on the store, where it belongs —
a store says what it can answer cheaply, and the seam makes up the
difference. `headers` promises no order, because the listing is what holds
one: `SessionStore.list` merges Sessions the Trace has never seen with the
ones it has, and only something that has seen both can put them in one
order. Three adapters used to sort for a caller that sorted again.

`SessionStore.list` gains a stated order, which is a promise it did not make
before rather than a shape that changed.

One value changes: a `SessionID` minted after this is time-ordered. An older
one still parses, still resolves, and still folds — the id is opaque to
everything except the sort.

## How to repeat the measurements

Build a corpus shaped like the real one — 4.1 KB per line, 120 Events per
Session — write it to a file, and time `makeJsonlSink`, `sink.replay`,
`sink.sessions`, and `makeSessionStore(...).list` against it. Import the sink
from inside `plugins/trace-jsonl/`, because the workspace links are per-package
and two copies of Effect will not run.

For the fsync figure, append 200 lines with `fsyncSync` after each, under Bun
and under Node, and compare. libuv asks macOS for `F_FULLFSYNC`; a runtime that
returns in tens of microseconds is not doing it.

For the SQLite figures, load the same corpus into
`event(session, seq, id, at, run, parent, kind, payload)` with
`PRIMARY KEY (session, seq) WITHOUT ROWID`, close the database, reopen it
read-only, and time the same four questions.

For the `node:sqlite` figures, run the same inserts under `bun` and under
`node` from one file that imports `node:sqlite`, and compile a probe with
`bun build --compile` to prove the driver survives into the binary.
