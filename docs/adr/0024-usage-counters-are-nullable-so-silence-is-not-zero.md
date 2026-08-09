---
status: accepted
---

# Usage counters are nullable, so silence is not zero

Every counter on `events.Usage` is a `*uint64`. Absent means the provider did not report the figure; zero means it reported none used. `SchemaVersion` is 2.

ADR 0003 decided this and the type did not carry it. Four counters — input, output, cache write, cache read — were plain integers, and the doc comment above them said nullability was load-bearing while three fields below them were the only ones that could express it. The four that could not are the four a cost report is built from.

## What the gap cost

A Provider that reported nothing produced a record of zeros, and a record of zeros is a turn that cost nothing. Those are different claims and the schema had one way to write both.

The Anthropic Provider knew this and worked around it: a `reported` boolean beside the numbers, set by whichever frame carried a figure, and a `Degraded` record emitted instead of a `Usage` when nothing set it. That is the distinction the schema owed it, rebuilt in a layer that should not have had to. It was also invisible: nothing in `providers` said the dance existed, so the second Provider to arrive would have emitted a confident zero and no test anywhere would have failed.

Invariant 8 says there is one schema and every observable thing is an instance of it. A schema whose most-used field needs a per-provider convention to mean what it says is not one schema; it is one schema and a folk practice.

## What it changes

`spend` in the Anthropic Provider lost its boolean and its four integers became four pointers. `reported()` is now a question asked of the figures rather than a flag kept beside them, and it cannot disagree with them.

The fold in `ui` gained a `tally`: a sum, and a count of how many records carried the figure it sums. A set where one turn was silent has no total to state, so the line says so — the same rule the dollar figure already lived under, applied to the counters, because a partial sum looks whole and is short by an unknown amount.

The fake Provider's `Usage` is now converted rather than copied field by field. Go compares struct types by their fields and ignores tags, so `events.Usage(turn.Usage)` compiles only while the two agree. A counter added to the schema and not to the recording stops the build, where the hand-written copy it replaced dropped one silently.

## Why the version moved

Retyping increments it (ADR 0006). The number is the honest one even though nothing yet migrates on it: a reader that assumed a v1 `usage` payload had four numbers is right about every record written under 1 and wrong about every record written under 2, and the version is how it tells them apart.

A version 1 record still decodes. A figure it carries becomes a figure; the zero it may have written for either meaning reads as none used, which is the most a record made without the distinction can be asked to say. Stored Traces are never rewritten.

## Consequences

**Stating a figure costs a constructor.** `events.Tokens(n)` exists so that a caller with a figure writes one expression rather than a local variable and its address — the shape that makes a caller reach for a plain zero instead. The absent counter is the zero value and needs nothing.

**A cost line can now say less than it used to.** A turn that reported no counters shows "no usage reported" where it once showed "0 in / 0 out". That is the point, and it is the visible half of the change: the screen stopped stating a figure it never had.

**Falsifier:** if a Provider turns up that reports a counter as absent when it means zero — a silence that is genuinely a zero rather than a silence — then the distinction is being read backwards for that Provider, and the fix is at its adapter rather than here. The schema means what it says; an adapter that cannot tell the two apart says `Degraded`.
