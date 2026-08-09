---
status: accepted
---

# A prompt is answered by a Run, and a turn is one provider exchange

The prompt-to-answer arc has no name of its own. What answers a prompt is a Run: the intent rides on its opening record, the answer is its Text, and the claim closes it. "Turn" names one exchange with a Provider — a request begun, a stream read to its end — which is the meaning the providers layer already used, and one Run holds many turns the day there are tools to call between them.

Before this, "Turn" was two things at once. `cli.Turn` was a type meaning one prompt carried to one answer, the glossary used the lowercase word about twenty times without defining it, and the Run entry's avoid list retired it. A word the vocabulary uses that often, defines nowhere, and retires in one place is a word nobody can grasp — and it was the operator's own report that they could not.

## The distinction was a phantom

Turn-as-arc and Run never diverge, and the architecture forbids them to twice over.

The intent rides on Started, so a prompt exists in the record only as the opening of a Run — there is no identifier, no event, and no struct for the arc apart from the Run that accounts for it. And the Session's fold refuses one answer across two Runs by construction: Text from a second Run starts a new transcript entry, so a Turn that spanned Runs would produce a transcript no fold can hold.

Every candidate for divergence collapses into the Run. A refused attempt retries inside the open Run, as a Retry record before a wait. An interrupted Run closes, and continuing needs a new intent, which is a new Run. Budget exhaustion is data inside the transcript, and Exhausted closes the Run. Where an arc genuinely spans executions — a Spec re-run after a failure — the vocabulary already retired the word for that pair: a Spec plus its Runs was Task, and it stays retired.

Two names with one extension is what the glossary exists to prevent. The arc keeps the name that owns the record.

## The word was scheduled to collide with itself

The stage that adds tools makes one prompt cost many provider exchanges, and both the glossary and the plan already reach for "turn" at that smaller granularity: a Provider begins a turn, a Wire is one Provider's half of a turn, one Driver pulls a turn, and the loop's runaway fuse is a maximum number of turns. Kept as the arc, the word would have meant the whole outside the loop and one iteration inside it, in the same codebase, from the first tool call on. The meaning that survives the loop's arrival is the smaller one, so that is the meaning the word is pinned to.

## What was considered instead

Keeping Turn-as-arc with a proper glossary entry was drafted and read well, but every entry needed a paragraph keeping Turn apart from Run — a distinction that names no difference, defended forever. Renaming the arc (Exchange was the strongest candidate) fixed the collision and kept the phantom: the new word would need the same paragraph, and it would sever the vocabulary from the one word every model API and harness shares.

## Consequences

**The type named for the arc is renamed when it moves.** `cli.Turn` keeps its name until the loop layer is extracted, because a rename and a move are one reviewable act and the type is constructed in one place. Its new name belongs to the loop, which is what the type grows into.

**Older records are not rewritten.** ADRs before this one use "turn" in the arc sense, and they stand as written; this decision is why a reader may meet both senses in the ledger, and the glossary's entry is what adjudicates.

**Prose survives where the senses agreed.** While one prompt costs one provider exchange, "the turn in flight" and "answers one turn" are true in both senses, so nothing that reads correctly today had to be rewritten to keep this decision honest.

**Falsifier:** if a prompt's answer ever legitimately spans two Runs — a mid-answer resume that continues the same arc under a new execution — the arc has become a real concept with no name, and it gets one then, in its own ADR, with the fold changed to match. Nothing planned needs it: the plan's own escalation design re-enters the same call by cursor, inside the Run that asked.
