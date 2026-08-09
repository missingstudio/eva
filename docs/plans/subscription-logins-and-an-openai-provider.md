# Subscription logins and an OpenAI provider

Status: phases 0–2 implemented (2026-08-09) — `internal/auth`, `eva login` / `eva auth status`, `internal/providers/openai`, config `auth` mode, ADRs 0031–0033. Remaining: Phase 3 polish and Phase 4 (fake-provider retirement, §Workstream E). This document plans three features together because they share one seam:

1. **`eva login`** — log in to an OpenAI ChatGPT/Codex subscription with a device code, without ever handling an API key. The command shape (`eva login [provider]`) leaves room for more subscription providers later.
2. **An OpenAI provider** — `internal/providers/openai`, speaking the Responses API, with two transports: the public API (API key) and the ChatGPT/Codex subscription backend (OAuth token).
3. **Anthropic stays `api_key`-only** — Claude Pro/Max subscription auth was considered and cut (§A4, §7).
4. **Endgame cleanup** — once the OpenAI provider ships, the `fake` provider and its entire config surface (`script`, `chunk_delay_ms`) are retired (§Workstream E).

A reference implementation for the OpenAI half exists at `/Users/missingstudio/notshipped/neo` (module `github.com/owainlewis/neo`) and is cited throughout as `neo:<path>`. Neo has **no** Anthropic OAuth code — consistent with the decision here to keep Anthropic on API keys.

---

## 1. Where Eva is today

- One credential shape: an API key from `ANTHROPIC_API_KEY`, resolved at the single entry point `internal/config/config.go:161`, revealed exactly once at `internal/cli/app.go:355`, passed to the SDK via `option.WithAPIKey` in `internal/providers/anthropic/anthropic.go:56-81`.
- One real provider (`anthropic`) plus the `fake` replay provider. The provider factory switch is `internal/cli/app.go:336-364`.
- The `Provider`/`Stream` contract (`internal/providers/provider.go:10-49`) is pull-based: `Stream.Next(ctx)` yields one `events.Payload` per call, and retries are observable between pulls. Any new provider must be a state machine, not a buffered loop.
- No OAuth, no token store, no `login` verb, no config writer. The CLI is flags plus one word-dispatch precedent (`help`, `internal/cli/app.go:109-111`); positional args are otherwise rejected (`:128-130`).
- Layer graph is enforced by depguard (`.golangci.yml`); a new layer means a directory **and** a rule, per `docs/agents/project-structure.md`.

## 2. Vocabulary this work adds

New glossary entries (CONTEXT.md), to be pinned by ADRs before code:

- **Credential** — what authenticates Eva to a provider. It has a *shape* (`api_key` or `subscription` token) and a *source* (environment, or the auth store).
- **Login** — the act of obtaining a subscription Credential. A Login reaches the network, so it is a CLI verb (`eva login`), never a console Command — the glossary already defines a Command as opening no Run and reaching no Provider. A `/login` typed at the console may only print instructions.
- **Auth store** — the one file that holds subscription Credentials: `<Home()>/auth.json` (`~/.eva/auth.json`, honoring `EVA_HOME`). Separate from `config.toml`, which stays read-only.

## 3. Decisions to record as ADRs

| # | Decision | Rationale |
|---|---|---|
| D1 | A credential is a mode, not just a value: `provider.auth = "api_key" \| "subscription"` | Strict TOML (ADR 0009) forces the key into the schema; the mode drives model defaults, error text, and transport |
| D2 | Login is a CLI verb; the console only points at it | Preserves ADR 0015/0023 and the Command definition |
| D3 | Subscription credentials live in one auth store file owned by a new `internal/auth` layer | Config stays writer-free; secrets get one home with `0600`/atomic-write discipline |
| D4 | An expired token is refreshed before a Run, never mid-stream; a 401 after refresh is `ErrorAuthFailed`, not a retry | Keeps `classify()` honest (`internal/providers/anthropic/retry.go:121-138`) and ADR 0012 intact (every paid attempt is a record) |
| D5 | Providers receive a token *source*, not a token string, when in subscription mode | A long console session outlives a ~1h access token; the provider pulls a fresh token per dial without importing config or auth (interface defined in `providers`, implemented in `cli`) |
| D6 | The OpenAI provider hand-rolls its HTTP client (no SDK dependency) | The Responses API SSE surface is small; the Codex backend needs custom base URL + headers anyway; keeps the depguard allow list at `$gostd + events + core` |

## 4. Workstream A — `internal/auth` (new layer)

Directory + a strict `.golangci.yml` rule. Allow list: `$gostd`, `internal/config` (for `Home()` only — or take the path as a parameter and allow nothing; prefer the parameter). No imports from providers, tui, or cli.

### A1. Store

Model on `neo:internal/auth/store.go` and `neo:internal/atomicfile/atomicfile.go`:

- Path `<Home()>/auth.json`; format one JSON object `map[providerKey]Credentials`; file `0600`, parent dir `0700`, written atomically (temp file → chmod → rename).
- `Credentials{AccessToken, RefreshToken, ExpiresAt, AccountID}` — `AccountID` is OpenAI-only but harmless to share. Wrap secret fields in a store-local type mirroring `config.Secret` (redacting `String`/`MarshalJSON`), or reuse `config.Secret` if the layer imports config.
- `Expired(skew)` treats zero `ExpiresAt` as expired (`neo:internal/auth/openai.go:53-58`).
- Known limitation to document: read-modify-write with no cross-process lock (neo documents the same).

### A2. Token source

Model on `neo:internal/auth/source.go`:

- `TokenSource.Token(ctx)` — mutex-held (single-flight per process), refreshes when within a 5-minute skew of expiry, persists refreshed credentials back to the store immediately.
- Error text is product surface: `not logged in: run `eva login``, and a distinct message when the refresh token itself is dead.
- The refresh function is an injectable field so tests never touch the network.

### A3. OpenAI ChatGPT/Codex device flow

Fully transcribable from `neo:internal/auth/openai.go` — every constant below is proven working there:

| Thing | Value | neo cite |
|---|---|---|
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann` | `:25` |
| user-code request | `POST https://auth.openai.com/api/accounts/deviceauth/usercode` | `:35` |
| poll | `POST https://auth.openai.com/api/accounts/deviceauth/token` | `:36` |
| user-facing URL | `https://auth.openai.com/codex/device` | `:37` |
| redirect_uri (exchange only) | `https://auth.openai.com/deviceauth/callback` | `:38` |
| token endpoint | `POST https://auth.openai.com/oauth/token` (form-encoded) | `:39` |
| poll timeout | 15 minutes | `:40` |

Flow shape (hybrid device + PKCE — the server generates the `code_verifier` and hands it back with the `authorization_code`; the client never computes S256):

1. Request user code with `{"client_id"}` → `{device_auth_id, user_code, interval}`.
2. Poll with `{device_auth_id, user_code}` at `interval` (default 5s).
3. On success, exchange `grant_type=authorization_code` + `code` + `code_verifier` + `redirect_uri` + `client_id` at the token endpoint.
4. Extract `AccountID` from the access-token JWT: claim `https://api.openai.com/auth` → `chatgpt_account_id`; **refuse tokens lacking it** (`neo:internal/auth/openai.go:285-321`).
5. Refresh: form `grant_type=refresh_token`; if the response omits a new refresh token, keep the old one (`:103-106`).

Non-obvious details neo learned the hard way — keep all of them:

- **HTTP 403 and 404 from the poll both mean "still pending"** (`:202-209`); a dead `device_auth_id` therefore polls until the outer timeout.
- The user-code response spells the field `user_code` *or* `usercode` (`:145-148`).
- `interval` arrives as int *or* string — custom unmarshal (`:330-353`).
- Endpoints are `var`s so tests can retarget them at `httptest` servers (`:32-33`).

### A4. Anthropic (Claude) subscription — considered and cut

Decision (2026-08-09): **Anthropic connects with an API key only.** Claude Pro/Max subscription auth is not planned, for reasons worth recording:

- The Pro/Max OAuth client belongs to Claude Code; Anthropic does not offer it to third-party tools. Using it is a ToS violation that risks the *user's own account*, and it can be revoked or broken without notice.
- The subscription backend is reported to validate Claude Code's identity (system-prompt shape). Eva has its own base system prompt (`internal/core/prompt`), so making requests work would mean impersonating Claude Code on every call. Eva does not ship impersonation.

The auth store and login flow are therefore OpenAI-only for now. The per-provider store key and the `eva login <provider>` argument form exist so a second subscription provider slots in without redesign, if one ever offers a sanctioned surface.

## 5. Workstream B — `eva login` UX

CLI surface (word dispatch beside `help` in `parse()`, `internal/cli/app.go:108-132`):

```
eva login              # logs in to OpenAI — the only subscription provider
eva login openai       # explicit form (scriptable, testable)
eva auth status        # shows the login credential: account, expiry, store path
```

There is no `eva logout`. Logging out is deleting the auth store file — `eva auth status` prints its path, and running `eva login` again simply replaces the credential. A dedicated verb can be added later if it earns its place; the surface starts minimal.

- **Picker: deferred.** With one subscription provider there is nothing to pick — bare `eva login` goes straight to the OpenAI device flow (neo does the same). The `eva login <provider>` argument form is the extension point: if a second subscription provider ever exists, bare `eva login` grows a select list and the argument form keeps scripts working unchanged.
- **Device-code display** (copy modeled on `neo:cmd/neo/provider.go:97-103`):

  ```
  Log in to OpenAI with this device code:

    https://auth.openai.com/codex/device
    Code: XXXX-XXXX

  The code expires after 15 minutes. Never share it.
  Waiting for authorization to complete...
  ```

- On success: print the store path and the exact `config.toml` lines to set (provider + auth mode) — neo does this and it removes a whole class of "logged in but still broken" confusion.
- `eva auth status` reports the **login credential info**: per provider, the configured `auth` mode; for `subscription`, the logged-in account (OpenAI: the `chatgpt_account_id` extracted at login), token expiry / needs-refresh state, and the auth store path; for `api_key`, whether the env var is set (name only). It also flags a set-but-ignored env key so "I exported a key but Eva uses my login" is never a mystery. Token material itself is never printed (§9).
- The console gets a `/login` entry in the command table (`internal/tui/command.go:64-88`) that only prints "run `eva login` in a shell" — no `Control` method needed beyond what printing requires.

## 6. Workstream C — `internal/providers/openai` (new provider)

New directory + depguard rule: `$gostd`, `internal/events`, `internal/core`, `internal/providers` only (D6: no SDK).

### C1. Two transports, one provider

| Mode | Base URL | Auth | Model default |
|---|---|---|---|
| `api_key` | `https://api.openai.com/v1/responses` | `Authorization: Bearer $OPENAI_API_KEY` | configurable, e.g. `gpt-5.2` |
| `subscription` | `https://chatgpt.com/backend-api/codex/responses` | Bearer access token + headers below | the current Codex client default (`gpt-5.6-terra` as of Aug 2026 — the backend entitles a ChatGPT account to a shifting subset and 400s the rest, so this tracks the current default, not a fixed one) |

Subscription headers (`neo:internal/llm/openai/codex.go:116-121`, asserted in `codex_test.go:57-64`):

```
Authorization: Bearer <access>
chatgpt-account-id: <accountID>     # from the JWT claim, stored at login
originator: eva
OpenAI-Beta: responses=experimental
Accept: text/event-stream
```

`Options` mirrors the anthropic provider's shape: `APIKey string`, `Tokens TokenSource` (D5), `BaseURL`, `MaxTokens`, `Retry Policy` — plain strings/interfaces, provider may not import config (same justification comment as `internal/providers/anthropic/anthropic.go:27-30`).

### C2. Request mapping (`core.Message` → Responses API)

Steal neo's mapping wholesale (`neo:internal/llm/openai/responses.go`):

- System messages concatenate into the single `instructions` string (`:222-237`). **Instructions are mandatory on the Codex backend** — fall back to a non-empty default if Eva ever sends none (`:47-49`).
- Assistant text → `output_text` part; tool calls → top-level `function_call` items; tool results → `function_call_output` keyed by `call_id`.
- **Force-emit empty `output` on `function_call_output`** via custom marshal — omitting it is a 400 `missing_required_parameter` (`:96-114`).
- Tools are flat (`type/name/description/parameters` at top level), not nested under `function` (`:138-143`).
- Send `store: false` and `include: ["reasoning.encrypted_content"]`; replay `reasoning` items raw across turns (`:50-60`, `:116-134`). Eva's `core.Message` has no raw-block slot today — either add an opaque `Raw json.RawMessage` to the core block vocabulary (schema-additive, ADR 0006) or accept degraded multi-turn reasoning replay in v1. Decide in the ADR; recommend the raw slot.

### C3. Streaming — where Eva must diverge from neo

Neo buffers the whole SSE body (`io.ReadAll`) because it presents blocking results (`neo:internal/llm/openai/codex.go:103-105,128`). **Eva must not** — the console renders live and the `Stream` contract is pull-based. Build the same queue + state machine as `internal/providers/anthropic/stream.go` (`dial` one attempt per call, `pump` one SSE frame per call, `end` emits usage or a `Degraded` caveat):

- Map `response.output_text.delta` → text-delta payloads; `response.output_item.done` → block completion; `response.completed` / `response.incomplete` → end-of-turn + usage; `response.failed` / `error` → error classification.
- **Codex-backend gotcha:** `response.completed` omits the `output` array (`neo:codex.go:132-140,214-219`). Content must be assembled from per-item events; never read only the terminal event.
- Scanner buffer needs headroom (neo uses 8 MB) and `[DONE]`/malformed lines are skipped.
- Usage mapping: `input_tokens_details.cached_tokens` → cache-read (`neo:responses.go:401-410`); stop-reason normalization into the existing event vocabulary (`tool_use` if any function call, `max_tokens` on `incomplete_details.reason == "max_output_tokens"`, else `end_turn`, `neo:responses.go:390-399`).
- Retry classification mirrors the anthropic provider's policy: 429/≥500/transport retryable with `Retry-After` honored; 401/403 → `ErrorAuthFailed`, not retried (D4). Neo's classification is thinner (`neo:internal/llm/retry/attempt.go:112-114`) — Eva's is the better shape; keep it.

USD cost: the subscription backend reports token usage but no dollar figure — ADR 0003 (absence distinct from zero) already covers this; `/cost` renders usage without inventing `$0.00`.

## 7. Workstream D — Anthropic: `api_key` only (cut)

There is no Anthropic subscription mode — see §A4 for the decision and reasons. The anthropic provider keeps exactly its current construction (`option.WithAPIKey`, `internal/providers/anthropic/anthropic.go:56-81`): no bearer path, no token source, no new headers, no code change in this plan beyond the config validation below.

Two rules fall out:

- **Subscription is a per-provider capability, not a global one.** Today only `openai` supports it. `auth = "subscription"` under `name = "anthropic"` is a load error whose message names the supported combination (ADR 0009: the error is product surface).
- **A provider is always constructed with an explicit credential.** Eva never delegates credential discovery to an SDK's ambient resolution chain — a missing key silently picking up whatever profile or env token happens to be on the machine (possibly the wrong org) is exactly the fail-quiet behavior this repo forbids.

## 8. Config changes

`internal/config/config.go`, strict-decoded with product-grade errors (ADR 0009):

```toml
[provider]
name = "openai"            # existing key; new accepted value
auth = "subscription"      # NEW: api_key | subscription — subscription is valid for name = "openai" only
api_key_env = "OPENAI_API_KEY"   # existing key; default now depends on name
model = "gpt-5.6-terra"    # default derived from name + auth when unset
```

- Defaults become provider-aware: `DefaultAPIKeyEnv` per provider name; default model per (name, auth) pair — neo does exactly this (`neo:internal/config/config.go:256-272`).
- The `auth` mode alone decides which credential is used — there is no precedence chain to reason about. An env key present while `auth = "subscription"` is ignored (and `eva auth status` says so); a missing credential for the configured mode is a load error whose message names the fix (`export <env>` or `run: eva login <provider>`).
- `RequireAPIKey()` becomes `RequireCredential()` — in subscription mode the check is "auth store has an entry", and its error says `run: eva login`.
- `script` and `chunk_delay_ms` are **end-of-life**: they exist only for the fake provider and are deleted with it in Phase 4 (§Workstream E), with strict-decode errors that name the replacement.

Assembly: the factory switch (`internal/cli/app.go:336-364`) grows an `openai` case and, per provider, an auth-mode branch. `cli` constructs the `TokenSource` from `internal/auth` and hands it to the provider — the only place the two layers meet.

## 9. Secrets and the Trace

Unchanged rule, extended coverage: tokens (access *and* refresh) never enter stdout, the Trace, or a context window. The existing black-box assertion (`internal/cli/eva_test.go:873-895` — credential reaches neither stdout nor the Trace) is extended to bearer tokens and to the auth-store file contents. `eva auth status` prints sources and expiry, never token material.

## 10. Workstream E — retiring the fake provider (endgame)

Once the OpenAI and Claude subscription paths are shipped and stable, the `fake` provider is removed, along with everything that exists only to support it: `internal/providers/fake` (including the `chunk_delay_ms` pacing added in commit 56fffaf), the `script` and `chunk_delay_ms` config keys, the `fake` case in the provider factory, its registry entry (ADR 0028), and its depguard allow-list lines.

**This is a migration, not a deletion.** The fake provider is the recording/replay backbone of the black-box test suite — `fake(script)` appears 17 times in `internal/cli/eva_test.go`, and `console_test.go`, `starter_test.go`, and `config_test.go` reference it too. Order of operations:

1. **Migrate black-box fixtures to wire fakes.** Every `fake(script)` world moves to the `live(base)`/`api(t, stream, …)` pattern that already exists in `eva_live_test.go` — a real `httptest` SSE server replaying frames. The OpenAI provider work (§C3 tests) produces the equivalent OpenAI-shaped wire fake; between the two, every scripted turn the TOML recordings expressed is expressible on the wire, including pacing (the server sleeps between frames — which is what `chunk_delay_ms` simulated one layer too high).
2. **Migrate in-process tests.** `console_test.go`'s `driven` scripted provider is in-package and independent of `internal/providers/fake` — it stays. Anything in `starter_test.go`/`config_test.go` that names the fake provider or its keys moves to a real provider name or a wire fake.
3. **Delete** `internal/providers/fake`, the config keys, the factory case, the registry entry, and the depguard rule lines — one commit, after `make check` is green on wire fakes alone.
4. **Config migration guidance** (ADR 0009): strict decode already rejects unknown keys, but the error for `script` / `chunk_delay_ms` must say what happened — e.g. `the fake provider was removed; point tests at a wire fake, or use provider "anthropic"/"openai"` — not a bare unknown-key message.
5. **Docs sweep**: ADRs 0010/0028 reference the fake provider, and `.golangci.yml`'s `providers-fake` rule exists for it; each gets a superseding note or edit in the same change.

The gate for starting this workstream is explicit: both real providers in, subscription auth in, and at least one release cycle of the wire-fake test patterns proving they cover what the recordings covered.

## 11. Testing plan

Per the four established styles:

- **`internal/auth` unit tests**: `httptest` servers replaying the device flow (user-code → pending 403/404 → success → exchange) and refresh; store round-trip with permission assertions; token-source skew/single-flight. Endpoint vars retargeted per test (the reason they're vars).
- **Provider wire tests** (style of `internal/providers/anthropic/anthropic_test.go`): `serve()`-based SSE replay for the OpenAI provider — happy path, tool-call turn, the empty-`output`-on-completed case, retry-after, 401 non-retry; header assertions per transport (`Bearer` + `chatgpt-account-id` + `originator` on subscription; plain `Bearer $OPENAI_API_KEY` on api_key).
- **Command tests** (`internal/cli/command_test.go` style): `/login` prints instructions and opens no Run.
- **Black-box process tests** (`eva_test.go` style): `world` scrubs `OPENAI_API_KEY` + `ANTHROPIC_AUTH_TOKEN` and points `EVA_HOME` at a temp dir; `eva login openai` against a fake auth server driven end-to-end (stdin closed, `--no-browser` semantics); a full turn against a fake Codex SSE server; token-never-leaks assertions.

## 12. Phasing

| Phase | Ships | Depends on |
|---|---|---|
| 0 | ADRs D1–D6, glossary entries | — |
| 1 | `internal/auth`: store + token source + OpenAI device flow; `eva login` / `eva auth status` | Phase 0 |
| 2 | `internal/providers/openai`, both transports; config `name = "openai"` + `auth` mode | Phase 1 (subscription transport), else standalone for api_key |
| 3 | Polish: model defaults per mode, `/login` console hint | any |
| 4 | Retire the fake provider: migrate black-box fixtures to wire fakes, then delete `internal/providers/fake` + `script`/`chunk_delay_ms` config (§Workstream E) | Phase 2 stable for a release cycle |

Phases 1–2 deliver the headline feature: "log in to ChatGPT/Codex and use Eva without any API key."

## 13. Open questions

1. Does `core.Message` grow a `Raw` block for reasoning replay (§C2), or does v1 accept degraded multi-turn reasoning on OpenAI?
2. Multiple accounts per provider (named profiles) — out of scope; one credential per provider key in the store, matching neo.
