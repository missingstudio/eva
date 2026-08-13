---
status: accepted
---

# The wire is the public surface, and `internal` stays internal

Eva exposes its capability to code it did not write. The promise is the wire protocol a
client speaks to a running Eva. No package leaves `internal/`, and there is no `pkg/`.

## Three promises, and only one is affordable

| Promise      | Shape                                | What it costs                                             |
| ------------ | ------------------------------------ | --------------------------------------------------------- |
| Go import    | `import ".../pkg/harness"`           | A version promise on Go types, and nothing migrates a type |
| Wire         | A protocol a client speaks over HTTP | A protocol version, and a reader migrates an old record   |
| Process      | Run `eva`, read the Trace            | Almost nothing, and it already works                      |

The decisive fact is that a version number already exists where the promise belongs. The
Event schema is one monotonic integer, and a reader migrates a record written under an
earlier one. Nothing gives a Go type that property. A semantic-version promise on
`core.Session` or `core.Spec` would freeze the domain against every stage above 0, and
those types are the ones every stage edits.

ADR 0021 already withdrew this promise, deliberately: *"Promoting a package out of
`internal/` later is a deliberate act that makes a promise to whoever imports it.
Keeping everything in until then is what leaves that promise unmade."* That reasoning
did not expire. It found its answer.

## The process surface is kept, not tolerated

`eva -p` answers one turn onto stdout and exits non-zero when the turn failed. The Trace
is the machine-readable record. Together they are an interface with no version and no
maintenance, and scripts already use them.

`eva api` extends the same idea to the whole wire: one request against the running
server, by operation name or by method and path. It costs little once the interface
document exists, and it tests that document — a capability it cannot reach is a
capability the document describes wrongly.

## Considered options

- **Publish `pkg/harness` and `pkg/events`.** Rejected. It is the promise with no
  migration mechanism, and `events` is the one package whose seal depends on being
  hand-written (ADR 0005).
- **Publish nothing, and let people fork.** Rejected. The stated goal is that other
  people build on this capability, and a fork is not an integration.
- **Publish a Go client generated from the wire document.** Available and expected. A
  generated client is not a promise about the domain; it is a promise about the wire,
  restated in Go. It may live outside `internal/` because breaking it breaks nothing
  the domain owns.

## Consequences

**Every layer keeps its `internal/` path and its depguard rule.** Nothing in this
decision moves a directory.

**The wire gets a version of its own**, separate from the schema version, for the reason
ADR 0050 records.

**A capability that cannot be expressed on the wire is not exposed.** That is the
constraint doing its job. An interface that needs a Go type Eva has not published is an
interface asking for a wire method that does not exist yet.
