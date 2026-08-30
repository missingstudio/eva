# What Eva is for

Eva is an open-source, autonomous software factory. It runs coding work end to
end — from a spec a machine can check, through a harness that does the work,
to evidence that it was done — across the harnesses you already pay for.

It is local-first: the factory runs on your machine, the record of everything
it did stays on your machine, and nothing leaves except on an explicit share.
And it is one program with many doors — a terminal, a web page, a desktop
window, a phone, a chat channel, and a socket a script drives — all reaching
the same running factory.

## The problem

You have subscriptions to several coding harnesses. Each is a good harness.
None can tell you what a change cost, none can check another's work, and none
can run twenty tasks overnight and show you the evidence in the morning.
Switching between them means switching tools, losing history, and starting
the accounting again.

And all of them are tied to the machine you are sitting at. Close the laptop
and the work stops. Step away and nothing can reach you when a run needs a
decision.

## What Eva does about it

**One contract over every harness.** Eva's native harness and every foreign
one implement the same interface, so a task runs on any of them without being
rewritten. Eva's own harness has no privileged position.

**One trace.** Everything every harness does lands in one event schema. What a
trace cannot rebuild is a bug.

**One verifier.** Acceptance criteria are checked by Eva, not claimed by the
agent that did the work. A claim is never evidence.

**One bill.** Cost is attributed per task, per merged change, and per harness
— which makes "use this harness for this kind of work" a measurement rather
than a preference.

## Every piece is a plugin

A small kernel loads plugins, and every capability is one: the model
providers, the tools, the harnesses, the trace stores, the permission gate,
the surfaces, the themes. Anything you do not like, you replace — and the
thing you replace it with sits in the same seam the original did, with no
special case anywhere. The model layer is provider-agnostic the same way: an
API key, a subscription login where a vendor permits one, or any compatible
endpoint you name in config.

This is also how Eva grows without growing its core. A new surface, a new
harness, a new check, a new store is a plugin in a seam that already exists.
[architecture.md](architecture.md) is the shape of the whole system;
[reference/writing-plugins.md](reference/writing-plugins.md) is how you write
into it.

## Remote-ready, and why it is a property rather than a feature

Every interface Eva has is a plugin against one session API, and that API
never assumes the person is on the same machine as the work. There is no
local mode and no remote mode; there is one interface and a distance that
does not matter.

That is what makes the rest possible:

- **The work survives the window.** A session lives with the daemon and
  survives the client leaving. Close the terminal, kill the browser — the run
  continues, and any surface reconnects by trace position, so a drop costs a
  repaint rather than a Run.
- **Start work anywhere, watch it anywhere.** The terminal and the page move
  together from the first stage; the desktop and the phone build on what they
  prove. A phone pairs with a laptop and answers a permission request from a
  lock screen. A chat channel is a surface too — a phone client you already
  installed.
- **Build your own interface.** Terminal, web, phone, editor extension, or a
  script — every one is a row in the same domain, calling the same session
  API. We ship the first ones; a third party ships the next without asking.
- **Your subscriptions, from a machine that is not yours.** The harnesses
  stay installed where they are licensed. The interface does not have to be
  there.

If local were a special case, half the system would stay untested until the
day it mattered most. So there is no local special case — the terminal you
type into is the same plugin shape as the server you reach.

## From one machine to a fleet

The same program scales up without changing shape. One machine runs a daemon
that owns the work and drains a backlog overnight. Many machines enroll with
a control plane — one pasted token each — and become a fleet that takes work,
reports evidence, and stays revocable within one heartbeat. Demand arrives
from outside as signals: chat messages, issue trackers, error monitors — each
an intake that turns into a spec a machine can check, and nothing admits work
autonomously until an operator turns it on.

## The managed service

Eva is the substrate for a hosted product, and the open-source tree is the
whole of it — not a demo that a proprietary version completes.

What the service adds is operation, not capability: enrolled workers behind
NAT taking work from a control plane, per-tenant isolation, spend caps and
hard limits, an audit trail tied to a mandate that expires, and a dashboard
that answers what the factory produced this week and at what cost.

Everything it is built on — the harness contract, the trace, the verifier,
the session API, the plugin system — is in this repository and runs on your
laptop with no account. **Self-hosting is not a downgrade path.** The service
exists because running a fleet is work, not because the tree is missing
pieces.

## Who it is for

Someone who already runs coding agents and has hit the ceiling: too many
branches to review, no way to tell which harness is worth its cost, no audit
trail when something lands that should not have, and no way to keep any of it
going once they step away from the desk.

And, because the tree is open source, the builder beside them: the person who
wants a surface, a check, or a harness of their own, against contracts that
are published rather than reverse-engineered.

## What it is not

Not a model. Not an IDE. Not a replacement for the harnesses you use — Eva
drives them, and its own harness is one entry in the same registry.

## How it gets built

Stage by stage, and every stage has an exit test it can fail.
[roadmap.md](roadmap.md) says what each stage is and what it must prove.
[plan.md](plan.md) says what order they land in and what to build next. The
execution log in [development.md](development.md) says where each one stands.
And before any stage above the base layer, [ux-dx.md](ux-dx.md) says what
good use looks like at every door, and the base layer adopts it first.
