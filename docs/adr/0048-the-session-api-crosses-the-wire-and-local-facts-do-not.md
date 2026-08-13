---
status: accepted
---

# The session API crosses the wire, and local facts do not

`tui.Control` splits in two. The session API is what a client drives and what a
transport carries: answer a prompt, watch what happens, read the model, set the model,
and clear the transcript. Local facts are what a frontend asks of its own process: the
editor, the build, and the remedy. No transport carries the second.

## Three methods that would lie over a wire

`tui.Control` was the right interface, discovered the right way — five methods the
console needed, defined where they were needed, implemented by `cli`. It then grew to
eight, and three of them describe a machine rather than a Session.

- **`Editor`** returns a program to start, with its arguments. A program starts on the
  machine a person is sitting at, so a server's answer is useless and a zero value is a
  silent loss of the feature.
- **`About`** reports the build, the branch, and the working directory. Over a wire the
  question "whose" has no default answer, and each answer is right for a different
  reader.
- **`Remedy`** reports what was checked about *this machine* after a turn failed, and
  the one command that follows. ADR 0041 already fixed that the layer that can check a
  remedy is not the layer that states it. A wire adds a third party, and the check has to
  happen where the fix does.

Two of the three are answered by the machine a person sits at. One — `Remedy` — is
answered by the machine that made the failed request. Those are the same machine today
and are not the same machine over a wire, which is what makes a single interface wrong
rather than merely large.

## The split repairs a rule that was already broken

`docs/agents/design-rules.md` says an interface past four methods is usually two
interfaces. This one was eight, and it turned out to be two: five and three. The wire
did not create the problem. It made it visible.

## Considered options

- **Keep one interface; a remote transport answers the three about the server.**
  Rejected. It is correct for `Remedy` and wrong for `Editor`, and one interface cannot
  be both.
- **Keep one interface; a remote transport returns zero values.** Rejected. A remote
  console silently loses the editor and the remedy, and nothing reports why. This
  repository fails loudly instead.
- **Put the three on the wire and let the client ignore them.** Rejected. It puts a
  machine-local fact in a protocol, where a second implementation will send it and a
  third will trust it.

## Consequences

**The session API is five methods and is what the server implements.** It is also the
list a new frontend has to satisfy, which is short enough to read.

**A remote console reports its own machine.** That is the true answer rather than the
convenient one, and it means a person debugging a failed turn on a remote server is told
what to fix and where.

**`Remedy` needs a decision the wire forces.** A turn that failed on a server for want
of a credential has a remedy that belongs to the server's operator, not to the person
watching. Which side reports it is settled per class rather than once, and the classes
already exist.

**Two directories exist and they are not the same one.** A Session's directory travels on
the wire, because the Server needs it to select (ADR 0056). The client's own directory is
a Local fact that `About` reports, because it describes the machine a person sits at. A
remote Console in one directory driving a Session in another needs both to be true, and
one field cannot hold both.
