---
status: accepted
---

# The OpenAI Provider speaks the Responses API with no SDK

`internal/providers/openai` answers turns from OpenAI's Responses API over a hand-rolled client: one POST, one server-sent-event body, the standard library and nothing else. One Provider carries two transports — an API key against the public API, a subscription login against the ChatGPT/Codex backend — chosen by the mode where a run is wired, identical past the dial.

## Why no SDK

The surface this Provider needs is small enough to own: build one request, read one stream. The subscription backend needs a host and headers no SDK ships with (`chatgpt-account-id`, `originator`, the beta header), so an SDK would be configured out of most of what it does. And the pull-based Stream contract — one payload per call, retries observable between pulls — is the shape the Anthropic Provider already hand-holds around its SDK; here the state machine simply owns the wire too.

The retry policy was the Anthropic Provider's shape restated, on the reasoning that the two packages may not import each other and that a third Provider would be the day it moved to a package they all share. That was the wrong trigger, and the second Provider was already it: the copies were byte-identical, so the rule they encode — half-jittered backoff, a cap that ends the retries rather than parking the turn, a server's ask that raises the floor and never lowers it — had two homes and no owner. It now lives in `internal/providers/retry`, a leaf both may import, and it gained the direct tests neither copy ever had. Naming why an attempt failed stays with each Provider, because one reads a typed error document and the other a status line.

## What the wire taught

Three behaviours are load-bearing and pinned by tests:

- **The subscription backend restates the answer.** Text arrives as deltas and then again as an assembled item, and the terminal frame omits the output array entirely — so the deltas are counted per item and the restatement contributes only what the deltas did not. A turn that streamed everything adds nothing twice; a turn that streamed nothing still answers.
- **The account rides inside the token.** The backend requires the ChatGPT account id as a header, and the id lives in a claim of the access token itself — the credential's own shape — so the Provider reads it there rather than being handed a second value that could disagree with the first. The header then always names the account of the token being sent, even when the stored one has gone stale under a renewal.
- **The books close on the terminal frame.** Usage arrives once, on `response.completed` or `response.incomplete`; a truncated answer is marked Degraded where the truncation is learned, a turn nobody priced emits a caveat rather than zeros, and the reasoning figure is recorded as the subset of output tokens it is.

## The claim reader is written twice, knowingly

Reading the account out of the token happens in two places: at login, to refuse a token that could never be spent, and per attempt, to set the header. The two are twenty-odd lines each and differ only in whose error they raise. They cannot share code — the layer that mints credentials and the layer that spends them may not import each other, and a shared home would have to be a new layer above both.

That trade was measured rather than assumed: sharing would turn forty-four lines into thirty plus a directory, an import rule, and a glossary entry. Complexity would move rather than concentrate, which is the test a new layer has to pass. Both copies are covered where they live — a token with no claim is refused at login, and a credential that is not a login's token fails the turn.

What would reopen it: a second subscription Provider. Two readers is a duplication; three is a rule nobody owns, and at that point the reader earns the layer this decision declined to build.

## Consequences

The transcript maps thinly: system Messages join into the one instructions string, user and assistant text become input items, and nothing is persisted server-side (`store: false`) because the Trace is the record. Reasoning items are not replayed across turns — the transcript Eva reconditions on is its own — which trades some cross-turn reasoning continuity for a `core.Message` that stays two fields. If that continuity ever earns its keep, the schema grows an opaque block by an ADR of its own.
