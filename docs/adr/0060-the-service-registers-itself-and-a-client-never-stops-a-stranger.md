---
status: accepted
---

# The Service registers itself, and a client never stops a stranger

`eva serve --register` writes a registration naming its address, its process, and its
service version. The port is ephemeral unless a person names one. A client that stops a
Service re-reads that registration before and after it signals, so it never stops a
process it did not read.

## One server, and a flag that makes it the Service

There is one server implementation. `eva serve` runs it in the foreground.
`--register` is what makes a run of it *be* the Service: it writes the registration a
client discovers it by.

`eva service` supervises and implements nothing. What it installs runs `eva serve
--register`. ADR 0053 said the unit's command is `eva serve`; this is the flag that makes
that literal, and it is the difference between one lifecycle and two.

A `service` that forked its own server would make "is the Service running" a question
with two answers, and the answers would diverge the first time one path gained a flag.

## The port is ephemeral

`--port` unset means the operating system chooses, and the registration carries the
address it chose.

This removes a class of failure rather than handling it. There is no port already in use,
no default that collides with something else, and no reason two Servers cannot run at
once. A person who needs a fixed port names one, and then owns the conflict.

A fixed default would have been the wrong choice for a process a person does not start on
purpose.

## A client never stops a stranger

Stopping a Service is: read the registration, confirm the Server it names is the one
answering, signal it, wait, and confirm again before escalating.

The confirmation is the whole point. A registration holds a process identifier, and a
process identifier is reused by the operating system. A client that signalled a stale
identifier would stop whatever inherited it, which on a developer's machine is anything at
all.

So the registration is compared before the signal and again before escalating from a
polite signal to a fatal one. A registration that no longer matches means the Service
already stopped, and there is nothing left to do.

This is taken from the prior art unchanged. It is the kind of care that is invisible when
it works and unattributable when it is missing.

## Considered options

- **A fixed default port.** Rejected. It collides, and the collision falls on a person who
  did not start the process.
- **A separate daemon implementation for the background case.** Rejected. Two servers, two
  lifecycles, and one question with two answers.
- **Signal by process identifier with no re-read.** Rejected. It stops strangers.
- **A lock file instead of a registration.** Rejected. A lock says something is running and
  a registration says how to reach it, and a client needs the second.

## Consequences

**The registration is discovered, not configured.** A client reads it rather than being
told an address. `eva --server <url>` is the path for a Server that has no local
registration, which is every remote one.

**The registration holds the service version.** ADR 0057 puts the version on the wire as
the mechanism; the copy in the registration lets the auto-start path decide without a
request.

**A stale registration is a recoverable state.** A registration naming a Server that does
not answer is replaced. A registration naming a Server that answers and disagrees is
handled by ADR 0057, which asks whether it is busy first.
