---
status: accepted
---

# Usage is normalized, and an unreported field is nil rather than zero

The `Usage` Event uses a normalized shape that providers map into, not any one provider's shape:

```go
Usage {
    InputTokens, OutputTokens, CacheWriteTokens, CacheReadTokens uint64
    ReasoningTokens  *uint64   // nil = provider did not report it; 0 = none used
    ServerToolTokens *uint64
    USD              *float64  // nil = not reported; never an estimate
}
```

Two corrections to the draft drove this. The draft had a single `CachedInput` field, but a cache **write** costs more than base input while a cache **read** costs far less, so one field cannot compute cost — and cache-hit rate is the largest single lever on cost per task. The draft also needed a reasoning-token field on the grounds that reasoning tokens are a material share of cost; Anthropic's `MessageUsage` reports only `InputTokens`, `OutputTokens`, `CacheCreationInputTokens`, `CacheReadInputTokens`, and `ServerToolUse`, and bills thinking tokens inside `OutputTokens`. The field is real and necessary for OpenAI-compatible providers, and unfillable for our primary one.

## Consequences

Nullability is load-bearing, not stylistic. `nil` means "the provider did not tell us" and `0` means "none were used"; collapsing them into `0` is how a cost report becomes confidently wrong. This is the `Degraded` distinction expressed at field level.

`USD` is never populated with an estimate. Billing meters from provider-reported usage reconciled against invoices, so a self-reported or wall-clock-derived dollar figure in this field would become a financial liability. A Run whose cost is only an estimate is marked Degraded and excluded from precise cost reporting.

Anthropic splits usage across `message_start` (input) and `message_delta` (output), so a single `Usage` Event per turn needs accumulating across the stream before emitting.
