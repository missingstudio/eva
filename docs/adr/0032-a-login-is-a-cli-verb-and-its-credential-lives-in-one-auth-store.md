---
status: accepted
---

# A login is a CLI verb and its credential lives in one auth store

`eva login` obtains a subscription Credential; `eva auth status` reports how a turn would authenticate. Both are words on the process surface, beside `init` and `help` — neither is a console Command, and the credential both touch lives in one file, `auth.json` beside the configuration, owned by a layer of its own.

## Why the CLI and not the console

The glossary defines a Command as a line the console answers itself: it opens no Run, reaches no Provider, and leaves no record. A login reaches the network and waits on a person's browser, which is everything a Command must not be. Putting it on the CLI keeps the definition true rather than adding an exception to it — and a login is what a person does *before* anything else works, which is when there may be no console to type into and no valid configuration to open one with.

## The auth store

A subscription credential cannot live where the API key lives. It expires, it renews, and the renewed one must be written back — an environment variable can hold a value but nothing can write one back through it. So the store is a file: `0600` in a `0700` directory, written atomically through a rename, keyed by the Provider the login belongs to. Logging in again replaces the entry, which is the whole of "log out and back in" — there is no logout verb until one earns its place, and the status report prints the store's path so removing the file by hand is a discoverable act.

The store is `internal/auth`'s, a layer that talks to one thing: the vendor's authorization server. It reads no configuration (the path is passed in) and reaches no Provider, so a credential cannot select what it authenticates. The layer that wires a run is the one place auth, config, and providers meet.

## Renewal is the token source's, per attempt

A console session outlives an access token, so the Provider is handed a resolver rather than a string and calls it per attempt: the attempt made an hour in sends the token that is live an hour in. Renewal is single-flight within the process and the renewed credential is persisted before it is used, so the next process starts from the token the server currently honours. A 401 after that is a login that has genuinely died, which is an auth failure to report with its fix — never a retry, because the next attempt costs the same and fails the same.

## Consequences

Tokens are secrets the moment they exist. The login prints the account and the store path, the status report prints modes, accounts, expiries, and variable names — token material reaches no stream, no Trace, and no test fixture that asserts otherwise. The device-code flow's non-obvious behaviours (a poll answering 403 or 404 both meaning "not yet", the interval arriving as a number or a string, the server minting the PKCE verifier itself) are pinned by tests against a local server, because each one was learned the hard way somewhere.
