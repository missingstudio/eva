---
status: accepted
---

# The Recorder closes the Run, so the caveat commits with the claim

ADR 0002 decided that an Event kind we do not recognise is preserved rather than dropped, and that the Run raises `Degraded`. It did not say whose job the raising is. This decides that: `core.Recorder` closes a Run, and composes the caveat itself.

```go
func (r *Recorder) Finish(ctx context.Context, claim events.Claim) error
```

`Finish` commits `Degraded` and `Finished` as one group, and omits `Degraded` when the Run is clean — its presence is the flag, so a gate reads whether the record is there rather than reading a boolean inside it.

The alternative was to leave it with the Unit: fold the unrecognised kinds in a projection, and have each Unit ask for them before it writes its `Finished`. That is a rule contributors are expected to remember, guarding the one failure the project has no instrument to detect. The Unit that forgets writes a clean-looking claim over a Trace holding a record nobody read — structurally valid, quietly wrong, and indistinguishable from a good Run to everything downstream. The Recorder is the only path an Event takes to the Trace (ADR 0011), and the only thing that sees all of them. So it is the one place the caveat cannot be forgotten.

The caveat is first in the group. `Finished` is what closes a Run, so a record behind it is one the close does not cover.

## What this amends in ADR 0011

Two statements there are now narrower than they read.

**"Behind one method."** There are two. `Record` is still the only way a producer's payloads reach the Trace; `Finish` writes nothing a producer supplied except the claim.

**"Group boundaries are the caller's."** They still are, with one exception, and the exception has a rule: the caller decides what commits together for everything it produced. The caveat belongs to no producer — it is a property of what the Trace already holds — so the Recorder owns that boundary and no other.

## Consequences

**The list names kinds, not counts.** One unrecognised kind is one entry however many records of it arrive, in the order the Run met them. `Missing` says what was not understood; it is not a measure of how much.

**An entry says what sort of thing was missed.** `unknown event kind "quantum_flux"` rather than `quantum_flux`, because the list is read by someone working out why a Run was excluded from scoring, and a bare name does not say whether a record or a figure is meant.

**`Record` still accepts `events.Finished`.** A caller can close a Run by hand and get no caveat. That is convention rather than compiler, and it is the gap to close if a second Unit ever grows its own close.

**Degrading a Run never fails it.** The claim in the Trace is the one the Unit made. The caveat sits beside it, which is ADR 0002's "degrade the run, never block the platform" expressed at the writer.

**Falsifier:** the Recorder can only raise what it can see for itself. The first degradation that comes from somewhere else — an estimated cost, a capability the harness does not have — cannot be discovered by watching commits, so `Finish` grows an argument or the Recorder grows a way to be told. Revisit then, rather than letting each Unit start composing its own close again.

## Considered options

- **A `Degradation` Subscriber, with the Unit composing the group.** Follows the projection pattern `Session` established, and rejected for the reason above: it puts the remembering back on every Unit, which is what makes the failure silent.
- **Write `Degraded` on its own, after `Finished`.** Rejected: a record behind the close is outside what the close covers, and a reader that stopped at `Finished` would never see it.
- **Fail a Run that committed an unrecognised kind.** Rejected by ADR 0002. A surprising kind degrades a Run; it never blocks the platform.
