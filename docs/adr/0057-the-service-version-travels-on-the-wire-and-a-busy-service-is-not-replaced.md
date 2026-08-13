---
status: accepted
---

# The service version travels on the wire, and a busy Service is not replaced

The Server states its service version in its health response. A client refuses to speak
a major it does not implement, and the Server rejects a request from a client that does.
The auto-start path may replace an idle Service. It never replaces one holding an open
Run.

## What is compared

The **service version**, not the build version, and the rule is additive within a major.
A client at major N works with any Server at major N.

ADR 0050 created the service version for this. Comparing build versions defeats it: a
patch release that touches no wire method would restart a Service holding live Sessions,
for nothing.

The rule is ADR 0006's rule, reused. One compatibility rule in the codebase is worth
more than a second one that is almost the same.

**What makes the rule enforceable** is the check ADR 0050 already requires. The service
version is generated from the interface document, generation is reproducible, and a diff
against what is committed fails `make check`. So a wire change that forgot to bump the
version cannot land. Without that check this rule is a promise; with it, it is enforced.

## Why the version is on the wire

The prior art keeps the version in a local registration file that the Server writes
about itself, and compares it client-side. That works for a background Service on the
same machine, and it cannot work at all for a client that reached the Server over a
network. A browser has no registration file.

Eva makes remote clients first-class: a phone paired over a local network, a browser, a
desktop application, `eva --server <url>`. So the version has to be somewhere every
client can read, and the health response is where a client already looks.

The registration file keeps the version too. It becomes an optimization — the auto-start
path can decide without a request — and not the mechanism.

## Both sides refuse, and they are different failures

A **client** that cannot speak the Server stops before it starts, and names the act that
fixes it. That is the good error message, and it is the one a person sees.

A **Server** that receives an incompatible request rejects it. That is the backstop for a
stale client, a cached page, or something in between that the client's own check did not
cover. Without it the rule is cooperative rather than true.

## A busy Service is reported, not killed

The prior art kills an incompatible Server and respawns it, with no question about
whether it is doing anything. That is cheap for a tool with no rule about interruptions.

It is expensive here. ADR 0016 closes an interrupted Run, so killing a busy Service
writes a `Finished` claim whose cause is a client upgrade. That is a failed Run in the
Trace that nobody asked for, and rule 7 says fabricated or lost Trace data poisons the
one instrument this project has.

So the auto-start path asks first. An idle Service is replaced silently, because nothing
is lost. A Service holding an open Run is reported, and the person runs `eva service
restart` — which stops it, and closes its Runs, deliberately.

## A development build never reuses a Service

A client built from a working tree always replaces the Service.

This is taken from the prior art unchanged, and it prevents the worst failure this design
has: a person edits the Server, restarts the client, and silently talks to the Server
they built an hour ago. Every symptom of that points at the code they just wrote.

It costs a restart on every run of a development build, which is the correct price.

## Considered options

- **Build version, exact, kill and respawn.** Rejected. It restarts for changes that
  touched no wire, and it kills busy Servers.
- **Service version, exact.** Rejected. It forces a restart for an additive method, which
  is the case the additive-within-major rule exists to allow.
- **Client-side check only.** Rejected. It drops the backstop for exactly the case this
  design adds, which is a client that arrived over a network.
- **Server-side rejection only.** Rejected. The client's own refusal is what produces a
  sentence a person can act on, before a request is made.

## Consequences

**The health response is no longer trivial.** It states the service version, and a client
reads it before it does anything else.

**`eva service restart` is the named act.** A person is told to run it rather than having
it happen to them, and it is the one path that stops a busy Service.

**Skew across a network is detectable.** A paired phone that was not upgraded says so,
and says what to do, rather than failing on the first method it cannot parse.
