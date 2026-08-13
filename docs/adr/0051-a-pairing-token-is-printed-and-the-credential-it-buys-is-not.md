---
status: accepted
---

# A pairing token is printed, and the credential it buys is not

`eva pair` mints a short-lived, single-use token and prints it, beside how to reach this
server. The server's durable credential lives in a private file, is generated once, and
is never displayed. `eva service password` may rotate it and may not reveal it.

## The rule this obeys

`AGENTS.md`: *"A secret stays out of the record. Credentials enter at the env boundary and
never reach a trace, a log, or a context window."* And `internal/cli/login.go` already
states the operating form of it: *"What is printed is where the login lives and who it is
— never the credential itself, which is a secret the moment it exists."*

A pairing act has to put *something* on a screen, or there is nothing to pair with. So the
question is not whether to print, but what.

## Two tokens, and only one is safe to show

The durable credential authorizes every request for as long as it exists. Printing it puts
it in a terminal scrollback, a screenshot, and a shell history, and revoking it means
revoking every paired client.

The pairing token authorizes exactly one act: exchange me for a credential. It expires in
minutes and is consumed on first use. Printing it is its entire purpose, and it is
worthless afterwards.

This is the token ladder in `docs/reference/architecture.md`, applied to a frontend
instead of to a Worker. The acts are the same shape: a short single-use grant proves *you
were invited*, the credential it buys proves *which client you are*, and a narrower grant
proves *what you may do now*. A phone joining over a local network is a less trusted
principal than a build runner, so it gets the same ladder rather than a weaker one.

## What was rejected, and it is what the field ships

The common design is a static password in an environment variable, defaulting to absent,
with a warning when it is unset and the server running anyway. A tool that ships this also
prints network addresses when discovery is enabled, and flips its bind address outward to
do so.

That is the design `docs/reference/architecture.md` already rejected in writing:
*"Rotation matters more than length. A 24h credential that rotates each hour and refuses
replayed predecessors detects theft. A 90-day static token does not detect theft."*

A default of "no credential, warn, continue" also breaks rule 12: when a value hits a
bound the system rejects it visibly. So a server refuses to bind a non-loopback address
without a credential, rather than warning and binding.

## Considered options

- **Print both; a local server password is a different category.** Rejected. It is a
  bearer credential for an agent that can run commands, which is not a lesser category.
- **Print to a terminal only, never to a pipe.** Rejected. It is a real mitigation and it
  is not a boundary — a terminal is where the screenshot comes from.
- **No pairing; every client is configured by hand.** Rejected. The stated ergonomic bar
  is one command and one pasteable token.

## Consequences

**`eva pair` output is safe to photograph, paste, or render as a code.** That is what
makes a phone joining a local server a ten-second act rather than a copy of a secret.

**The credential file sits beside the auth store, and is not in it.** The auth store holds
Provider credentials and was scoped to that (ADR 0032). A server credential is a different
subject with a different lifetime. Same directory, same private mode, same atomic write,
different file.

**`eva service password` rotates.** It reports that the credential changed and which
clients must pair again. It does not report the value.

**Revocation is per client.** Because each paired client holds a credential of its own
rather than a shared password, one client can be revoked without re-pairing the rest.
