---
status: accepted
---

# A credential has a mode, and the mode alone decides

A Provider authenticates one of two ways, chosen by `provider.auth`: `api_key` reads the environment variable the file names, and `subscription` uses the Credential a Login stored. The configured mode alone decides which one a turn uses. There is no precedence chain — an exported key does not outrank a login, a login does not outrank a key, and nothing falls back to whatever happens to be on the machine.

## Why a mode rather than a chain

Vendor SDKs resolve credentials ambiently: a key variable, then a token variable, then a profile on disk, each silently outranking the next. The failure that produces is well known — a stale exported key wins over the login a person just completed, requests bill to an org they forgot they had a key for, and nothing says so. A mode makes the question answerable by reading the file, and `eva auth status` names a set-but-unused variable instead of letting it win.

The same reasoning rejects a fallback mode: a missing key that silently picked up a profile would authenticate as whoever that profile is, which is a tenant decision made by accident. Fail closed, fail loud — the missing credential is reported with the command or export that fixes it.

## Subscription is a per-provider capability

Only the OpenAI Provider has a subscription transport, so `auth = "subscription"` under any other name is a load error naming the supported pair. The Anthropic Provider stays on API keys by decision, not omission: its consumer-subscription OAuth client belongs to Claude Code, is not offered to third-party tools, and the backend is reported to validate Claude Code's identity — supporting it would mean impersonation, at the risk of the user's own account. Eva does not ship impersonation.

## Consequences

The defaults follow the Provider, so they are resolved after it: a file that says `name = "openai"` and nothing else runs that Provider's model and reads that Provider's variable, rather than inheriting another's. The compiled defaults therefore leave the model and the key variable empty, and normalization fills them once the name is known — a pre-filled default is indistinguishable from a choice by the time the file is decoded.

A repository may not set `provider.auth`. It decides what a run does, which is the boundary the project-settable allow list already holds.

**Falsifier:** a second Provider with a sanctioned subscription surface arrives and the pair-validation in config becomes a list. That is a line, not a redesign. If credential selection ever genuinely needs per-machine variation, that is a profile concept, and it should be designed as one rather than grown from a fallback.
