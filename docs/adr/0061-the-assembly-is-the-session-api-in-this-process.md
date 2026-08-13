---
status: accepted
---

# The assembly is the session API in this process

There is no direct transport object. In one process the assembly *is* the Session API,
and the Server's half serves the interface rather than an assembly. Two things satisfy
the API — the assembly here, and the remote client over the wire — which is what a seam
with two adapters means.

## What was there instead

`api.Direct(assembly)` was five methods, each one line, each forwarding to the assembly.
Three of them existed to add a context nobody read and an error that was always nil.
`api.Handler(assembly)` then took the concrete `*harness.Assembly` and implemented the
same five operations a third time.

Five operations, three implementations, and the third was the one on the wire — the half
that most needed to be driven against something a test could hold still.

## Apply the deletion test to a pass-through and it deletes itself

Delete `Direct` and nothing reappears anywhere: the assembly answers the same five
methods, and callers that held a `Session` hold one still. What the adapter contributed
was a shape, and the shape was the API's own. So the assembly took it.

The cost is honest and small: `Model`, `UseModel`, and `Clear` on the assembly now carry
a context they do not read and return an error they cannot produce. That is the API
saying there could have been a distance here, and this time there was not. A shape that
changed with the distance would be the second code path ADR 0047 exists to prevent.

## What forced the Handler to name a concrete type

One line: the arriving chunk was stamped with `assembly.Session()`, fetched under the
assembly's mutex once per chunk, from inside the Loop's stream — and discarded by the
only client that read that stream.

It was there because the chunk crossed the wire dressed as an Event, and an Event carries
a Session. Undressing it (ADR 0062's sibling change, below) took the last reason for the
Handler to know what an assembly is.

## A chunk is not a record, and now it does not look like one

The watch stream used to write an arriving chunk as an `Event` with no Trace position,
and a client told the two apart by testing `Seq == 0`. A record with no position is a
shape the schema does not have; the rule that recovered the difference lived in a comment
on one side and an `if` on the other.

The frame now says which it is. `event` is a record the Trace holds, and only a record
moves a Cursor (ADR 0049). `chunk` is a piece of a Block arriving, written as itself.

## Considered options

- **Keep `Direct` and give the Handler the interface.** Rejected, but only just: this
  would have made `Direct` the single adapter and earned it its keep. It leaves three
  names — the API, the adapter, the assembly — where two say the same thing.
- **Keep the Handler on the concrete assembly and test it through a real one.** Rejected.
  It is what the code did, and the backpressure design underneath it had no test because
  reaching it needed a real turn, a real socket, and a client that stalls on cue.
- **Let the assembly keep in-process shapes and adapt at the seam.** Rejected. It is the
  same three names, and it puts the vestigial context in the adapter instead of in the
  method — which reads better and buys nothing.

## Consequences

**`internal/api` no longer imports `internal/harness`.** The depguard rule says so, so it
stays true. The Session API states the contract; what satisfies it is not named here.

**A test can put anything behind the Server.** The suite now serves a Session with
nothing behind it, which is how the Handler's own behaviour — a refusal, a Session that
cannot answer — is asserted without a Provider or a Trace.

**The watch backlog is a module with a name.** What a full buffer does, which is the most
subtle behaviour in the package, is three unexported methods and its own test rather than
a closure inside an HTTP handler.
