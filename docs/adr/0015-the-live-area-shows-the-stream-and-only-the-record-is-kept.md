---
status: accepted
---

# The live area shows the stream, and only the record is kept

A Trace record is a unit of meaning. ADR 0004 made that true by folding consecutive text chunks of one content block into one record, and `cli.Turn` holds a block's chunks until the block is whole so that the sink has something to fold.

An ordinary answer is one content block.

So an interface built only from committed Events shows nothing at all until the answer is over, and then shows the whole of it at once. Every consumer downstream of the Recorder — the Session, the machine-readable stream, the Renderer — is correct to work this way. A person watching a turn happen is not a consumer of the record.

## Two things, told apart by name

`Turn.Arriving` is told each chunk as the Provider yields it, before any of it is committed. It is nil on every path but the console.

```go
type Turn struct {
    // …
    Arriving func(chunk string)
}
```

What it feeds is the **live area**: the part of the interface that shows a turn while it is still happening. The live area is erased when the Run closes, and what replaces it — put above the interface's own view, in the terminal's scrollback, where it stays — is the Renderer's fold over what the Trace holds.

That erasure is the whole of the argument. Nothing a person keeps came from anywhere but the record. A chunk that never reached the Trace, because the process was killed mid-block, leaves nothing behind that says it did.

## Why not the alternatives

**Commit a block in pieces.** The obvious fix, and it trades away ADR 0004 for nothing. A threshold in bytes cannot stream and stay proportionate to meaning at the same time: tokens arrive at tens per second, so a threshold small enough to feel live is a threshold that makes a long answer thousands of records, and a threshold large enough to keep the Trace small is ten seconds of silence. A threshold in time is the same trade with a clock on it.

**Publish the arriving chunks as uncommitted Events.** The envelope has a place for this — `Seq` is zero until the sink assigns it — and ADR 0008 closed it deliberately: only the Recorder may stamp, and every stamped Event is an appended one, or the two sequences stop meaning anything. An interface that received Events it could not tell apart from records would be the second source of truth this project has one instrument to detect.

**Let the interface read the Provider.** Then the interface holds a Provider, and what it shows is no longer bounded by what anything recorded. This is the arrangement invariant 1 exists to forbid.

## Consequences

**A chunk is not an Event.** `Arriving` takes a string. It was tempting to type it as `events.Text` and reuse the vocabulary, and that is exactly the confusion to avoid: a payload with no envelope looks like a record that lost one. A string cannot be mistaken for something the Trace holds.

**The interface receives two kinds of message and keeps them apart.** Both arrive from outside its update loop, and it folds them differently: one into a live area it will erase, one into the Renderer whose output it keeps.

**One-shot mode watches nothing.** `Arriving` is nil there, and the turn is written when it is over. Nothing is lost: there is no live area for a command that prints once and exits.

**Falsifier:** this holds while the live area is genuinely erased. The first feature that keeps arriving text — a scrollback of the live area, a copy button over it, a `--stream` flag that prints chunks to stdout — makes a person keep something no record holds, and at that point either the feature goes or the chunks have to become records.
