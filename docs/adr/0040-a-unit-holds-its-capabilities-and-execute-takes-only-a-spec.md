---
status: accepted
---

# A Unit holds its capabilities, and Execute takes only a Spec

`Unit.Execute(ctx, spec) (Outcome, error)` is the whole signature. What a Unit works with — the Provider, the Recorder, the Session, and later the tools, the memory, the verifier, and the hook bus — are fields it is built with, not a Runtime handed to it per call.

The plan sketched the other shape: `Run(ctx, spec, rt Runtime)`, with a Runtime carrying every capability and a null implementation of each from day one. The code shipped the first shape without the difference being decided, and one of the two has to be the pattern before there is more than one Unit.

## The composition rule decides it

The plan's own load-bearing line is that any Unit is a tool to a parent Unit:

    func AsTool(u Unit) Tool { return toolAdapter{u} }

A tool is called with arguments. If Execute took a Runtime, the adapter would have to produce one at the moment of the call — so either the adapter closes over a Runtime it was built with, which is this decision with an extra step, or the parent supplies its own, which hands a child the parent's tools, budget, and hooks and makes the mandate boundary a matter of what the caller remembered to swap out.

A signature of `(ctx, spec)` is what makes a Unit substitutable for a tool call, and substitutability at every rung is the whole claim of the ladder. The shape that shipped serves the plan's rule better than the plan's sketch did.

## What the Runtime was protecting, and how it is kept

The argument for Runtime is real and it is about extension: add an attachment surface late and you re-plumb every loop. That is true of a surface reached through a call chain. It is not true here, because the capabilities are fields and there is exactly one place a Unit is built — the composition root. Adding a hook bus is a field and one line where a run is wired, not an edit to every Execute between the top and the bottom.

Two things from the plan are kept without the parameter:

**Null implementations still ship with the interface.** A capability that is absent is a field holding a null implementation, never a nil to branch on. The loop never asks whether something is there.

**Nesting still passes capabilities down.** A Unit that spawns child Units builds them, and building them is where it decides what they get — narrowed, never widened. That decision being written at the point of construction is the mandate boundary being visible rather than implied.

## What was considered instead

Adopting the plan's Runtime and amending the code was rejected on the composition rule above. Holding both — Runtime for the capabilities, fields for the rest — was rejected because two ways to give a Unit what it needs is two places to look for what a Unit can do, and the question "what may this Unit reach?" stops having one answer.

## Consequences

**product.md's Part 1 sketch is superseded on this point.** The rung table, the loop, and the null-implementation rule stand; the signature does not.

**A Unit's fields are its capability list.** What a Unit can reach is read off the type, which is what makes a Unit that could reach something it should not a thing review can see.

**Falsifier:** when a Unit has to thread more than a handful of capabilities into children it spawns, a value the parent holds and passes to the constructor earns its place — as a struct at construction, still not as a parameter on Execute. The day that value appears on the signature is the day a Unit stops being usable as a tool.
