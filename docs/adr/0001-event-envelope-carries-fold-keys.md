---
status: accepted
---

# The Event envelope carries everything needed to fold or filter

Every Event carries `ID`, `Seq`, `At`, `SchemaVersion`, `Kind`, `Tenant`, `Actor`, `Run`, `Session`, and `Parent` on the envelope; per-kind payloads carry only what is specific to the kind. The rule is: anything a projection needs to **fold or filter** goes on the envelope, and anything it only needs to **display** goes in the payload.

The draft design put run identity inside the `Started` payload, which would have made every other Event unattributable to a Run without replaying the stream from its start. Timestamps were absent entirely, though latency per step is needed later. Tenant was absent, though tenancy must not be retrofitted.

## Consequences

The envelope is wide, and its cost is paid on every record — including the many small ones. We accept that: the alternative is a projector that must replay to interpret, which makes the dashboard's read models expensive to rebuild and the trace store's per-tenant encryption impossible to apply at the record level.

`Tenant` and `Actor` are populated from commit one, long before a second tenant exists. Adding them later would touch every stored record, every query, every cache key, and every object path.
