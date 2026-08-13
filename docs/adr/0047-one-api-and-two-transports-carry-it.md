---
status: accepted
---

# One API, and two transports carry it

A frontend holds one API. A direct transport calls it in the same process. A remote
transport speaks to a server over the wire. The API, the types, the errors, and the
semantics are identical, and only the distance changes.

## The rule this satisfies

Rule 8 in `docs/explanation/the-ladder.md`: *"Keep local and remote on one code path. If
local is a special case, half of your system stays untested until the day when you need
it most."*

Two shapes satisfy the letter of that rule and one satisfies its point.

**Server always**, where every client is a remote client and bare `eva` starts a
loopback server, satisfies it literally. It also makes `eva -p` a process-lifetime
problem, and it charges serialization on the path that has to feel immediate.

**One API, two transports** satisfies it where the rule matters. There is one API
surface, one set of semantics, and one conformance suite. The console typing a prompt is
a function call. The browser typing the same prompt is a request. Neither knows which it
is.

## What makes this affordable rather than clever

"Serve" and "listen on a socket" stop being the same word.

`eva -p` builds the service in its own process, calls it, and exits. No socket, no child
process, no startup cost, and no second implementation. That is the whole reason bare
`eva` may default to a background server without making every scripted turn pay for one.

The same separation is what lets a test drive the full service without a port.

## The falsifier, and why it is a test

**Falsifier:** the day the direct transport has a behaviour the remote transport lacks,
this is two code paths wearing one name, and the answer is to delete the direct
transport and make every client remote.

That is not a sentence to be trusted. One suite runs against both transports and
asserts the same outcomes for the same inputs. A behaviour that appears on one and not
the other fails that suite, which is how this decision stays true rather than remembered.

## Considered options

- **Server always.** Rejected for the cost above, and available at any time — this
  design degenerates into it by deleting one transport, which is why the falsifier is
  cheap to act on.
- **Two paths: the console wires a Session itself, and the server wires its own.**
  Rejected. This is exactly what rule 8 forbids, and it is what the code did before this
  decision.
- **One transport, always a socket, including in-process.** Rejected. It pays
  serialization and a listener for a function call, and it makes a test need a port.

## Consequences

**The API is the unit of design, and the transport is an implementation.** A method that
cannot be expressed over the wire does not belong on the API. That constraint is
deliberate and is checked by the conformance suite rather than by review.

**Local facts do not cross.** Three of the console's needs are properties of the machine
a person sits at, and they are a separate interface for that reason. ADR 0048 holds it.

**A remote client authenticates and a direct client does not.** The direct transport runs
inside one process under one identity, so identity resolves from the process. The remote
transport is where a credential is mandatory.
