---
status: accepted
---

# The Go schema is canonical, and the wire schema is generated from it

`internal/events` stays hand-written Go and stays the source of truth. An interface
document is generated from the payload registry. Clients for other languages are
generated from that document. The schema version and the service version are two
numbers.

## The seal decides this

The closed kind set is enforced by an unexported method on `Payload` (ADR 0005). A
generated Go type cannot carry one: generated code lives in its own package, and an
unexported method is a property of the package that declares it.

So a schema compiler that owned the Go types would delete a kernel property. The kind set
would go back to being enforced by review, and `docs/reference/architecture.md` lists the
Event schema in the column that is never pluggable.

The generation therefore runs outward. The registry that ties a Kind to a type — the same
one that makes the round-trip test exhaustive by construction — is also a description of
the schema. The document is read out of it.

## What this buys and what it costs

It buys clients in other languages without a hand-maintained second schema. Four
frontends folding one stream is four chances to disagree with the Trace, and a generated
client removes three of them.

It costs a generator this repository maintains. That cost is bounded by the schema being
small and closed: eleven kinds, one envelope, and a registry that already enumerates
them.

The server gains no runtime dependency. The wire is HTTP with a server-sent Event
stream, which the standard library already carries, and every generator runs at build
time.

## Two version numbers

The schema version governs stored records. The service version governs the wire surface.

They move at different rates. A new method touches no record. A new payload field
touches no method. One number forced to do both would stamp a new version into every
stored record because an unrelated method arrived, which is a figure that reports
something that did not happen.

ADR 0006 said one integer versions *the schema*, and that is unchanged. This adds a
number for a different thing.

**The discipline is one line.** The service version never appears inside a record, and
the schema version never gates a method.

## A stale artifact fails the build

A generated document that still compiles while describing an older schema is the worst of
the three outcomes, because it is the one nothing reports. The check is that generation is
reproducible and its output matches what is committed.

## Considered options

- **A schema compiler owns the types, and Go is generated.** Rejected. It deletes the
  seal, which is a kernel property.
- **Both hand-written, with a conformance test proving they agree.** Rejected as the
  destination, available as a stepping stone. It is two artifacts to edit for one change,
  and the test reports drift rather than preventing it.
- **A binary protocol with generated types on both sides.** Rejected. It is the same
  problem as the first option, plus a runtime dependency, and the Event schema is already
  a JSON contract that adapters and extensions read.
- **No generation; every client hand-writes the schema.** Rejected. It is the four-folds
  problem this decision exists to remove.

## Consequences

**`internal/events` is edited by hand, and that is now load-bearing.** A change there
regenerates the document and every client.

**The generator is a target in `make check`.** Generation is reproducible, and a diff
against what is committed fails.

**A client in another language is a build artifact, not a promise about Go.** ADR 0046
holds why that distinction matters.
