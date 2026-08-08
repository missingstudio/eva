---
status: accepted
---

# Unknown Event kinds are preserved and marked degraded, never dropped

The set of Event kinds is closed and versioned. An adapter that emits a kind we do not recognise does not have it silently discarded: the Event is preserved verbatim in an `Unknown` envelope, and the Run raises `Degraded`, which excludes it from eval scoring.

An earlier draft of the design said "unknown extras dropped". That contradicts the project's own "fail closed, fail loud" rule, and it fails it in the most expensive place. Dropping produces a Trace that is structurally valid and quietly wrong — and the Trace is the only instrument we have for knowing whether the system is improving. A poisoned eval suite is a top-three risk to the whole project.

## Considered options

- **Drop unknown kinds.** Simplest, and what the draft said. Rejected: it manufactures silent data loss in the one place we cannot afford it.
- **Open kind set.** Any adapter may define kinds. Rejected: the projector and every Hook would have to tolerate arbitrary vocabulary, and invariant "one event schema, everywhere" stops meaning anything.
- **Reject the run outright on an unknown kind.** Rejected: a missing or surprising capability must degrade a run, never block the platform.
