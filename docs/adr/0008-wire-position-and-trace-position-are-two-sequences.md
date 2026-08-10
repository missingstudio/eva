---
status: accepted
---

# Wire position and Trace position are two sequences, named apart

There are two independent sequence numbers, and conflating them is the trap this ADR exists to stop.

- **`WireSeq`** — assigned by the producer, per connection. It exists so a reconnecting peer can resume from its last acknowledged cursor and have the events after it replayed.
- **`Seq`** — assigned by the **sink** at commit time, per Session. It is the Trace's own ordering.

They cannot be the same number. The sink coalesces many wire `Text` chunks into one Trace Event (ADR 0004), and it appends an assistant message together with all of that message's tool results as one atomic write. Both operations mean wire position and Trace position diverge by construction.

## Consequences

The sink assigns `Seq`, so producers cannot. This is what makes "no `tool_use` is ever persisted without its `tool_result`" a property of the writer rather than a rule contributors are expected to remember. Resume, replay, branching, and compaction all depend on it holding without exception.

A durable commit is what advances the reconnect cursor, so the two sequences meet at exactly one point: the sink's successful append. Nothing else may advance a cursor, or a dropped connection can lose Trace events — which poisons the eval suite, a top-three project risk.

**The naming is the decision.** Calling both `Seq` reads as one concept and quietly becomes two, and the resulting bug is an off-by-N in whichever consumer guessed wrong.
