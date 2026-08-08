---
status: accepted
---

# Event payloads are a sealed interface, not optional struct fields

The Event envelope holds its payload as an interface whose only method is unexported:

```go
type Payload interface{ isPayload() }
```

No package outside `events/` can implement it, so the closed kind set from ADR 0002 is enforced by the compiler rather than by review. The envelope's `UnmarshalJSON` switches on `Kind` to select the concrete payload type, and `Unknown` holds the raw bytes.

The alternative — one struct carrying `Kind` plus an optional pointer per payload — makes every payload nullable simultaneously, so "which pointer is set" and "what `Kind` says" can disagree. That is an invariant you must then write tests to defend, where the sealed interface makes the disagreement unrepresentable.

## Consequences

The unexported marker method looks like dead code and invites removal. It is the mechanism, not decoration: deleting it opens the kind set to every importing package.

Extensions and adapters cannot define new kinds. That is intentional and consistent with the kernel/extension boundary — the Event schema is kernel. An adapter with something new to say emits it and it arrives as `Unknown` with the Run marked Degraded.
