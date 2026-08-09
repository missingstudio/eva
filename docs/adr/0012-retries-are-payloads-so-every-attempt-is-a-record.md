---
status: accepted, the transport failure class superseded by 0038
---

# Retries are payloads, so every attempt is a record

The Anthropic SDK retries twice by default, inside the call, where nothing outside it can see the attempts. The Provider turns that off (`option.WithMaxRetries(0)`) and retries itself, yielding an `events.Retry` payload per refused attempt.

This is the whole reason the kind exists. A retry spends money and wall clock and produces no `ToolCall`, so a client that swallows its own retries reports a turn that cost one request and in fact cost four. The Trace is the only instrument the project has, and a cost it cannot see is a cost nobody can bill.

Two smaller decisions follow from the same rule.

**The request is made on the first read, not when `Stream` is called.** A Provider that dialled eagerly would have to either hide the retries or return them out of band, because `Stream` returns a `Stream` and an error and neither is a payload. Dialling lazily means an attempt that failed is simply the next thing `Next` returns.

**A retry is yielded before the wait it caused.** `dial` makes one attempt per call: it queues the `Retry`, records what it owes, and takes the wait at the top of the next call. So the Trace holds the attempt at the moment it failed, rather than however many seconds later the answer arrived — and a reader watching the stream is told why nothing is happening while it is not happening.

## The error class comes from the error document

`Retry.ErrorClass` is read from the `type` the API puts in its error body — `rate_limit_error`, `overloaded_error`, `authentication_error` — and only falls back to the HTTP status when there is no document to read, which is the proxy that answered a 502 with a page of HTML. The API saying what happened beats this client inferring it from a status line, and the fallback exists because a gateway between the two is not obliged to speak the API's language.

Retryability is decided beside the class rather than derived from it. An auth failure and a malformed request are not retried, because the next attempt fails the same way and costs the same money. A transport failure that never reached a server is retried whatever it is classified as.

> **Amended by ADR 0038.** This said a transport failure was classified `other`, because the set had no member for "no response at all" and adding one would change the schema for a case the class does not decide. The class does decide something now: it is what a projection shows a person instead of the provider's words, and "your network" against "their servers" is the most useful distinction there is to draw. The member is `unreachable`, and the schema change was additive.

A server that said `retry-after` raises the wait and never lowers it. It knows what it is recovering from and this client does not, so a longer ask is obeyed — and a shorter one, or the `0` a server sends when it is being polite, must not turn the retry into a second request with no pause in front of it. The floor stays the jittered backoff.

Beyond `Policy.Cap` the retries end and the failure is returned, because a caller that has been told the request failed can decide to come back, and a caller parked inside a Provider for minutes can decide nothing. The cap is therefore sized for what a rate limit actually asks for — a minute — rather than for what the backoff reaches, which is four seconds. A cap under that would have turned the commonest recoverable failure there is into a turn that never retried at all.

## Usage accumulates and emits once

The API splits what a turn cost across two frames: `message_start` carries what the input cost, `message_delta` carries what the output cost. Both are cumulative rather than incremental, so a field is overwritten by the latest frame that carried it and left alone by a frame that did not — summing them would double the input tokens of every turn. One `Usage` payload emits at the end (ADR 0003).

`ReasoningTokens`, `ServerToolTokens`, and `USD` stay absent on every Anthropic turn, and each absence is a decision. Thinking tokens are billed inside `OutputTokens`, so a reasoning figure would be counted twice by anything that summed the two. The API reports server tool *requests*, which are not tokens. A dollar figure is never derived here at all.

**A stream that broke still reports what it spent.** The accumulated `Usage` is emitted before the failure, because a turn that died after `message_start` was charged for the input tokens either way. The figure is what the API last reported, not an estimate of what the turn would have cost had it finished.

## Consequences

**`provider.base_url` is a configuration key.** It points the client at a gateway, a proxy, or a local server, and empty is the public API. It is what lets a real streaming turn — a real request, real server-sent events, real status codes — be exercised without the network, a credential, or money.

**The retry policy is code, not configuration.** `Policy` is four attempts, 500ms of backoff doubling per attempt, capped at a minute, with half of each wait jittered so that a fleet of Workers that failed together does not return together. Nothing in a configuration file reaches it, and the ticket that needs a per-profile policy is the ticket that should add the key.

**The answer cap is configuration, and the default is the Provider's.** `provider.max_tokens` overrides `DefaultMaxTokens`; zero means the file said nothing. The default lives in the Provider because the Provider is what knows the API, so there is no second number in `config` to be kept in step with it. A negative cap is rejected when the file is read — it is not a smaller cap, it is a turn that cannot answer.

**Mid-stream failures are not retried.** The retry loop runs before the first frame. Resuming a half-delivered answer is not something the API offers, and re-requesting would bill the input twice and duplicate the text already recorded.

**Falsifier:** if a second network Provider turns up whose failures do not fit the fixed set — or which reports a dollar figure — then the set is wrong rather than the mapping, and `events.ErrorClass` is where the change belongs. It has grown twice on exactly that argument (ADR 0038), which is the mechanism working rather than an exception to it.
