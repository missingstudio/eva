---
status: accepted
---

# The Console surface is a second interface document

Organizations, seats, and billing live in their own interface document, with their own
version, their own authentication, and their own address. A local Server implements none
of it.

## The constraint this satisfies

ADR 0053's second constraint: *"Console-only surface is a separate service the interface
composes."* This decides what "separate" means. It means a second document, not a second
namespace and not a reduced implementation.

## Why not a namespace in the same document

ADR 0046 says the interface document *is* the public surface. `eva api` is built on that
claim, and it earns its place by testing it: a capability `eva api` cannot reach is a
capability the document describes wrongly.

A namespace that one of two servers can never answer breaks the claim. The document would
list methods that exist on a hosted Server and not on a local one, so "what the document
says" and "what this Server can do" would be two different things — and a person reading
the document would have no way to tell which methods belonged to which.

Two documents make the boundary readable. What a local Server can do is one file. What
the Console adds is another.

## Why not a reduced implementation

The third option is worse: a local Server answering the Console methods with one implicit
organization, no seats, and no billing.

That fabricates data. A single implicit organization is an organization that does not
exist, and a billing state of nothing is not the same as no billing. This repository
marks absent data Degraded and never invents a repair, and a fake organization is exactly
the confident lie that rule forbids.

## What composes them

The interface holds two clients. One reaches the Session API on whichever Server it is
driving. The other reaches the Console, when a Console credential exists.

Nothing in the session API knows the Console exists. That is what makes ADR 0053's
third constraint testable: with no route to the Console, the second client has nothing to
reach, and every Console affordance is absent rather than broken.

## Considered options

- **A namespace in the same document, answered "not implemented" locally.** Rejected. It
  puts unanswerable methods in the surface, and breaks what `eva api` is for.
- **The same document with reduced local implementations.** Rejected. It fabricates an
  organization and a billing state.
- **No document; the Console is a web application with a private interface.** Rejected. A
  private interface is one nobody else can build against, and the stated goal is that
  other people build on this capability.

## Consequences

**Two authentications, and they do not mix.** A Session API request carries a Server
credential or runs in-process. A Console request carries a Console credential from
`eva console login` (ADR 0052). Neither is accepted by the other.

**Two version numbers on the wire**, one per document. This is the same reasoning as
ADR 0050's split rather than an exception to it: two contracts that move at different
rates are two numbers.

**Exactly one non-Go gate exists.** The Console surface is a document rather than an
interface, so it adds no build. With ADR 0058 there is one interface toolchain, which is
what lets `make verify` stay a Go command.
