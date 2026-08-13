---
status: accepted
---

# The web interface ships in the binary, and it needs no Console

`eva serve` runs the API and the web interface. The interface is compiled into the binary.
It never calls an endpoint the local server lacks, Console-only surface is a separate
service it composes, and a test drives a full turn against a local server with no route to
the Console.

## Why it is in the binary

One checksummed artifact is the whole install story. A cask, a script that verifies
against release checksums, and `go install` all deliver one file, and an install that then
fetches its own interface has two failure modes the install script cannot check.

The customers who most want a managed service are the ones who least want to run
infrastructure, and some of them have machines with no route out. An interface that has to
fetch itself is an interface those machines do not get.

## The three constraints, and why they are constraints

**It never calls an endpoint the local server lacks.** The moment one Console-only call
appears in a shared path, "run everything locally" becomes false, and it becomes false
quietly — the local interface renders an error nobody attributes.

**Console-only surface is a separate service the interface composes.** Organizations,
seats, and billing are not extensions of the session API. They are a different service
with a different lifetime and a different authority. Putting them on the session API would
mean a local server implementing endpoints it can never answer.

**A test drives a full turn with no route to the Console.** Without it the first two
constraints decay the first time a feature is easier to write against the Console. This is
an exit test, in the same form as every other one here: if the demo does not work, the
constraint is not held, whatever the code says.

## The Console is not a second product

It is this service, with tenancy, billing, and someone else's uptime. That is the whole of
what it sells.

Stating it this way is what keeps the local interface honest. A hosted Console that grew
its own interface would be a second implementation of the same fold, and the two would
disagree — which is `docs/explanation/the-ladder.md` rule 5 arriving one layer early.

## Considered options

- **Serve the interface from disk or a network location.** Rejected. Two failure modes the
  install cannot check, and no offline case.
- **One interface that detects capability and shows Console features when a Console is
  connected.** Rejected here. It is the more flexible design and it weakens the first
  constraint from *never call* to *never require*, which is a boundary review has to hold
  rather than a test. Available later, and it would supersede this.
- **Two interfaces sharing components.** Rejected. It guarantees the drift the third
  constraint exists to detect.

## Consequences

**The binary grows.** The current binary is about 25 MB. A small-framework interface adds
one to three megabytes, and a large framework adds more. A size budget belongs beside the
prompt-byte budget, for the same reason: what ships is a reviewed figure rather than a
surprise.

**A stale embedded artifact must fail the build.** An interface that compiles while
predating its source is the failure nothing reports. Generation is reproducible and a diff
against what is committed fails.

**`make verify` stays a Go command.** What gates the interface's own build is settled with
the Console surface, and is recorded as open in `docs/explanation/the-service-seam.md`. The
constraint that holds meanwhile: one person with a Go toolchain can run `make verify`.
