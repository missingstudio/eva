---
status: accepted
---

# A replaying Provider is not a Provider a person may select

The fake Provider is removed, with the `provider.script` key that selected it and the `Recording` field that carried its file across the registry seam. What replaces it in the tests is a local server speaking a real API's own wire protocol.

## Why it went

It was built when nothing else could answer a turn, and it earned its keep for exactly that long. Two Providers answer now, and the thing the fake was for — a turn a test can run with no account, no network, and no money — is something a loopback server does better: the turn goes through the Provider that answers in production, over the frames that Provider actually parses. A recording proved the machinery *around* a Provider. A wire fake proves the Provider too.

The cost of keeping it was not the two hundred lines. It was that a second implementation of the contract could disagree with the first and be believed, because it was the one every test ran through. That already happened once: a recording with no usage table produced a `Usage` of seven absences — the exact record both network Providers refuse to emit — so an unpriced fake turn reached the Trace making the opposite claim from a real one, and every fixture in the repository happened to set a usage table, so nobody saw it.

## What a person loses, and what they get instead

A configuration can no longer name a file of recorded turns. What it can still do is point `provider.base_url` at a server of the operator's own, which is the same capability without a second Provider behind it — a gateway, a proxy, or a recording served over HTTP.

`provider.script` is therefore refused by name rather than as a typo. A setting that was real and is gone reads exactly like a misspelling to a strict decoder, and the two want different answers: one person mistyped a setting they meant, the other is carrying a file forward across the version that took the setting away.

## Consequences

`providers` no longer reads a file format, so `toml` leaves its allow list and reaches only the layer that reads the configuration — which is what ADR-0010's table said the arrangement should be, before a replaying Provider was the exception to it.

The conformance suite loses a subject. It runs against the two Providers that answer over a network, both behind a local server, and no longer against one that answers from disk — so the rules it enforces are now only ever checked against Providers that have a wire.

**Falsifier:** a Provider arrives whose wire cannot be stood up locally — one behind a protocol no `httptest` server can speak. Then a recording is the only way to test it, and this decision is the reason to reach for a fixture inside that Provider's own package rather than a Provider selectable from a configuration file.
