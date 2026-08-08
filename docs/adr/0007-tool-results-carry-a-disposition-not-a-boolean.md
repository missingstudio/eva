---
status: accepted
---

# Tool results carry a Disposition, not a boolean

`ToolResult` carries a closed `Disposition` in place of an `OK bool`:

```
ok | denied | failed | skipped | cancelled | unknown_tool | budget_denied
```

The distinctions are behavioural. `skipped` is what unstarted calls in a parallel group become when the user steers mid-turn, so that nothing is orphaned. `denied` is a policy refusal the model should route around. `budget_denied` is the one where the correct recovery is to summarize partial work and return `Exhausted` — budget exhaustion enters the transcript as a recoverable result rather than arriving as a process kill from outside. `unknown_tool` is recoverable by choosing a different tool; `failed` usually is not.

A boolean carries none of this, so the model would infer the right recovery from prose in an error string. That is a guess where an enum is free.

## Consequences

Every Disposition must leave the transcript structurally valid for the next provider call. A tool call always has a result, whatever happened to it.
