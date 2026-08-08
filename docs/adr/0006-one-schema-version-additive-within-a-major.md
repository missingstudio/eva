---
status: accepted
---

# One schema version for all Events, additive within a major, migrated on read

A single monotonic integer versions the whole Event schema and rides on every envelope. Adding a Kind or a nullable field is additive and keeps the number. Removing a field, retyping one, renaming one, or narrowing an enum increments it.

Readers migrate old records **on read**. Stored Traces are never rewritten.

## Considered options

- **A version per Kind.** Rejected: a Hook subscribing to a dozen lifecycle points would have to negotiate a dozen independent versions, and the "one event schema, everywhere" invariant stops meaning anything useful.
- **Rewrite stored Traces on upgrade.** Rejected: Traces are append-only, and `attest/` will sign them as a non-repudiable action log. A rewrite invalidates the audit chain — the compliance evidence and the governance primitive are the same artifact.

## Consequences

Migration code accumulates in the reader and is never deleted, because a Trace from any past version must stay readable. This is the deliberate cost of an append-only store; budget for it rather than being surprised by it.
