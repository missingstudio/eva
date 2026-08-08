---
status: accepted
---

# Text chunks coalesce at the trace sink

`Text` Events stream one chunk at a time on the wire, and the trace sink folds consecutive chunks of one content block into a single `Text` Event when it commits. There is still exactly one Event schema — the wire and the Trace share it — but a Trace record corresponds to a unit of meaning rather than to a token.

Read literally, "the Trace is the persisted Event stream" makes every streamed token a durable record: a 50k-token turn becomes 50k rows, and replay, projection, and per-tenant encryption all pay that multiple forever.

## Consequences

**This is lossy, and the loss is permanent.** Coalescing discards inter-token timing, so a Trace cannot be used to debug streaming latency or to reproduce the exact cadence a user saw.

**Falsifier:** if token-level timing turns out to be needed — for render fidelity, for latency work, or for an eval that scores time-to-first-token — then chunks must be persisted and the cost paid knowingly. Revisit this ADR rather than adding a parallel store, which would create the second source of truth the design forbids.
