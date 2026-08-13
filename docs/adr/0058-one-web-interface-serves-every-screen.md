---
status: accepted
---

# One web interface serves every screen

There is one web interface. The browser loads it from the Server. The desktop
application is a shell around it. A phone reaches it over a Pairing token on the local
network. There is one interface toolchain beside Go, not three.

## This follows from a decision already taken

ADR 0053 puts the web interface in the binary and requires it to do everything the
managed Console does. If that holds, a second implementation of the same fold is exactly
the drift ADR 0053's third constraint exists to detect.

Three native interfaces would be three folds over one Event stream. Every UI is a fold,
and four folds are four chances to disagree with the Trace — with nothing able to report
which one is wrong.

## The phone needs no toolchain

The Pairing token exists so a client can join a Server over a local network with one
short-lived grant (ADR 0051). A phone pointed at a paired Server gets the whole
interface. Adopting discovery makes it one step rather than two: the Server announces
itself on the local network, the phone finds it, and the token authorizes it.

Discovery and authorization stay separate. Announcing a Server is not permitting
anything, and binding a non-loopback address still requires the Credential. The prior art
conflated them — its discovery flag widens the bind address, and its credential defaults
to absent — and that is the half not adopted.

## What this cannot do, which is the falsifier

**Falsifier:** push notifications, working with no network, and a presence in an
application store are the three things a paired web interface cannot give a phone. The
day one of them is required, mobile becomes native and pays for its own toolchain and its
own gate.

Until then it does not, and the saving is not small: three toolchains, three release
paths, three signing stories, and three folds.

The desktop shell has a weaker version of the same falsifier. A shell that only hosts the
interface is a window. The day it needs the operating system — a menu bar item, a global
shortcut, a file association — it grows native code, and that code stays a shell rather
than becoming a second interface.

## Considered options

- **Three native interfaces.** Rejected. Three folds, three toolchains, and the drift
  ADR 0053 exists to detect, in exchange for capability nobody has asked for.
- **Web shared by browser and desktop; mobile native.** Rejected for now, and it is what
  the falsifier turns into. Mobile is the interface with the strongest case for going
  native, and it does not have that case yet.
- **A terminal interface only, and no web interface.** Rejected by ADR 0053, which is
  what a managed service needs to be reachable from a browser.

## Consequences

**There is one non-Go gate.** With ADR 0059 keeping the Console surface out of this
document, exactly one interface build exists. It becomes a third declared list beside
`CHECKS` and `AUDITS`: `check-list` prints it, `scripts/check-coverage.sh` requires a
workflow to run it, and `make check` stays a Go command that one person can run with no
second toolchain installed.

**The Console shares the interface, not a copy of it.** The managed Console serves the
same interface, which is what makes ADR 0053's claim about running everything locally
stay true as the Console grows.

**A phone is a first-class client and gets no reduced interface.** What it lacks is
notification and offline use, which are named above rather than discovered.
