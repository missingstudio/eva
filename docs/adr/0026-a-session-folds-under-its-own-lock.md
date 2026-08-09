---
status: accepted
---

# A Session folds under its own lock

`Session` holds a mutex over its transcript. `Committed` takes it to fold, and `Messages` takes it to copy.

`Session.Open` mints a Recorder per Run and says so: "A Recorder belongs to one Run, so a Session of many turns opens many." `Recorder` says it is safe for concurrent use, and it is — each holds its own lock over its own wire counter and its own commit. Neither statement was wrong, and together they described a Session whose transcript two Runs could write at once with nothing between them.

## Why it had not failed

The console answers one turn at a time. It holds a `WaitGroup` over in-flight Runs and will not open a second before the first closes, so the second Recorder does not exist while the first is publishing.

That is a frontend's scheduling decision keeping a domain type sound. The domain type is in `core`, which is the layer with no outside world and the strictest allow list in the repository, and its correctness rested on the behaviour of the layer furthest from it. Stage 2 runs parallel tool groups; stage 7 forks a session into branches. Either would have found this, in a package whose whole purpose is to be the thing the rest is checked against.

`Turn.conditioning` calls `Messages()` on the caller's goroutine while a Recorder publishes on another, so the read raced the write as well as the write racing the write.

## What it costs

One lock, held across a type switch over five cases and an append. It is not contended: the fold is fast and Runs are slow.

`Fresh` and `Open` do not take it. Neither touches the transcript — `origin`, `ID`, `Tenant`, and `Actor` are set once at construction and never written again — and locking them would suggest they were mutable when the absence of a lock is what says they are not.

## Considered options

- **Document that a Session belongs to one Run at a time.** Rejected, and it is what was in force. It is a rule with no enforcement in the one layer where every other rule has some: `core` is pure because a linter says so, its allow list is short because a linter says so, and its transcript would have been single-threaded because a comment said so.
- **Give the Session its own goroutine and a channel of committed Events.** Rejected. It makes the fold asynchronous, so `Messages()` could return a transcript missing a turn that has already committed — the Trace and the Session disagreeing, which is the divergence ADR 0011 removed.
- **Make `Session.Open` refuse a second open Run.** Rejected as a bigger decision wearing this one's clothes. Whether a Session may have concurrent Runs is a question for branch and best-of-N racing at stage 7, and answering it now with a runtime error would prejudge it. The lock makes either answer safe.

## Consequences

**`core` keeps `sync`, and now two types use it.** The allow list already carried it for the Recorder's counter (ADR 0011). This is the second reason and it is the same reason: a counter and a transcript that are safe only by convention are both a data race waiting for a second goroutine.

**Falsifier:** if a Session ever needs a reader that must not block behind a fold — a dashboard tailing a long transcript — then a mutex is the wrong shape and a copy-on-write snapshot is the one to reach for. Nothing reads a Session that way today.
