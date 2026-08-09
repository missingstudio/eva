# Rebuild — the base the house stands on

**Status: plan.** This document is the answer to one question: if Eva had to be rebuilt tomorrow, what shape would it take so the whole factory can stand on it without the base going weak? It is grounded in a full survey of the code as of 2026-08-09 and in the decisions `docs/adr/` already holds. Where it proposes to supersede a decision, it says so and names the ADR that must be written.

It does three things:

1. Fixes the design rules — the Go practices this codebase lives by, stated once.
2. Names what already holds and what is weak, with citations.
3. Gives the target shape and a staged path to it, each stage with a failable exit test.

---

## Part 1 — The rules

These are the practices that make a large Go codebase composable. Most are already in force here; they are written down so a rebuild does not rediscover them.

### Packages are domains, not layers

A package is named for what it *is* (`events`, `trace`, `providers`, `theme`), never for what pattern it plays (`services`, `handlers`, `utils`, `common`, `helpers`). The test: the package name reads as a noun from CONTEXT.md's glossary. `internal/` already passes this test — the "layers" of ADR 0010 are domain packages with a fixed import direction, not horizontal strata. The rebuild keeps that and sharpens it: every new package earns a glossary entry before it earns a directory.

A `util` package is the failure mode. It is where code goes when nobody decided what domain it belongs to, and it becomes the package everything imports and nothing can leave.

### Deep modules: small surface, real work behind it

The best packages here are already deep. `events` exposes one sealed interface and a codec, and behind them sits the registry that makes the round-trip test exhaustive by construction (`internal/events/payload.go`). `trace.Sink` is two methods hiding atomic group writes, Seq assignment, and chunk folding. Depth is the target for every package the rebuild touches: when a package's doc comment is longer than its export list, it is deep enough.

### Interfaces belong to the consumer

Go's idiom, and the repo's best seam, is the interface defined where it is *needed*, not where it is implemented. `tui.Control` (`internal/tui/command.go:43`) is five methods the console needs, defined in `tui`, implemented by `cli` — so the frontend can be tested with a six-line stub and can never reach a Provider or the Trace. `core.TraceSink` is the same inversion: core declares, `trace` implements.

The corollary: **accept interfaces, return structs.** Constructors take the contracts they consume (`ui.New(screen Screen, dark bool)`) and return concrete types callers can grow with.

The second corollary: **keep interfaces small.** One to three methods. `Provider` is two. `Screen` is one. An interface that grows past four methods is usually two interfaces.

### Composition is explicit, selection is a registry

Go composes by embedding and by passing values — there is no inheritance to lean on, which is the point. But composition has two halves and the repo only has one:

- The *contract* half is done: anything can implement `Provider`, `TraceSink`, `Subscriber`.
- The *selection* half is a hardcoded switch: `open()` in `internal/cli/app.go:336` knows every provider by name, `eva.subs` holds exactly one subscriber by assignment.

The standard library's answer is the registry: `database/sql` drivers, `image` formats. A registry turns "add an implementation" from four edits in three packages into one package that registers itself plus one config line. Part 4 applies this to providers, sinks, subscribers, and renderers.

### Sealed where closed, registered where open

The event kind set is closed and the compiler enforces it (unexported method on `Payload`). The provider set is open and nothing should enforce it. Knowing which of the two a type is — and making the code say so — is most of extensibility. The rule: **kernel vocabulary is sealed; capability is registered.** This is the same kernel/extension boundary Product.md Part 2 draws.

### Config flows inward as domain types, never as config types

`config.Config` is a file format. It stops at the composition root (`cli`). What crosses into a domain package is that package's own type: `tui` will define `Theme` and `Keymap`, and `cli` maps TOML onto them. This keeps depguard's `tui` rule exactly as it is — the console never imports `config` — while still making every visual choice configurable. A package that imports `config` to read one field has inverted the dependency.

### Comments carry rationale or they go

The repo's own rule (`AGENTS.md`): a comment states a decision in its own words, cites no document, and never narrates the next line. The survey found the codebase overwhelmingly follows this, with a short list of restatements to delete (Part 3). The test for every comment in the rebuild: *could the reader have written this comment themselves after reading the code?* If yes, delete it. If it names an invariant, a trap, or a rejected alternative — keep it, that is what comments are for.

### Purity and honesty gates stay

Three mechanisms are non-negotiable in any rebuild because they are what make the other rules checkable rather than aspirational:

- **`core` is pure** and its allow list does not even include the standard library wholesale (ADR 0010).
- **depguard in strict mode** — every layer's imports are an allow list that fails closed.
- **One module, `./...` reaches everything** (ADR 0021) — a green check means every package is green.

---

## Part 2 — What already holds

A rebuild that discards these is a rebuild that makes the base weaker. Keep, verbatim:

| Joint | Why it is right |
| --- | --- |
| `events.Payload` sealed + registry (`internal/events/payload.go:42-75`) | One table feeds `KindOf`, the decoder, and the exhaustive round-trip test. No two-switches-disagree bug is possible. |
| `Provider.Stream` yields `events.Payload` (`internal/providers/provider.go:45`) | A provider's output *is already schema*. No adapter vocabulary, no normalization step to drift. |
| `core` declares, siblings implement (ADR 0010) | `TraceSink`, `Subscriber`, `Unit` — the dependency inversion that keeps the domain pure. |
| `Recorder` embeds an unreachable `emitter` (`internal/core/recorder.go:89`) | Nobody can stamp an event without committing it. ADR 0011's invariant enforced by visibility, not review. |
| `Session.Open` prepends itself as first Subscriber (`internal/core/session.go:118`) | The transcript is a fold over commits, never a parallel write. |
| `tui.Control` (`internal/tui/command.go:43`) | The cleanest seam in the repo. A frontend is five methods. |
| The pane architecture (ADR 0023) | Three writers, each downstream of a commit or a keystroke. The live area is never stored. |
| Strict TOML decode with named-key errors (ADR 0009, `internal/config/config.go:168`) | Config errors are product surface. |
| The command table (`internal/tui/command.go:64`) | One source read by `/help`, tab completion, and dispatch. The pattern every registry in Part 4 copies. |
| The three-tier test pyramid | White-box console tests over a `Control` stub; in-process program tests read `Console.Screen()`; subprocess tests assert on the Trace file. No golden files to rot. |

---

## Part 3 — What is weak

The honest list, from a full survey. Each item names the failure it permits.

### Wiring is closed where contracts are open

- **Provider selection is a switch** (`internal/cli/app.go:336-364`). A new provider is four edits in three packages, two of which do not fail to compile when forgotten (the error string listing valid names, the config fields).
- **Exactly one subscriber can exist.** `Watch` and `show` *assign* a one-element slice (`app.go:283, 296`); a metrics tap or a second screen means editing `eva`, not registering. `Watch` also couples the attachment to a capability claim (`interrupt = true`) in one indivisible act.
- **Sink selection is a hardcoded `trace.Open`** (`app.go:148`). The interface is open; the wiring admits one implementation.

### The schema breaks its own rule once

`events.Usage` documents "nil means unreported, 0 means none" and then declares its four most-used counters as non-pointer `uint64` (`internal/events/payload.go:196-202`). The absent/zero distinction — the thing ADR 0003 exists for — is reconstructed out-of-band by one provider's `spend` accumulator (`internal/providers/anthropic/stream.go:212`). A second provider that forgets that dance emits a confident zero, which is the exact lie the schema forbids. Retyping bumps `SchemaVersion` (ADR 0006); it is cheapest now, while every trace on disk is local.

### Concrete coupling where a narrow contract belongs

- `Turn` holds `*core.Recorder` and `*core.Session` concretely (`internal/cli/turn.go:28-33`), so every `Turn` test drives two layers.
- `Console` holds `*ui.Renderer` concretely, a six-method dependency with no interface (`internal/tui/console.go:43`).
- `fake.Usage` is a field-for-field clone of `events.Usage` copied by hand (`internal/providers/fake/fake.go:70-78, 150-158`); a field added to the schema is silently dropped by the one provider tests depend on.
- The documented `*ui.Renderer`-satisfies-`Subscriber` guarantee rests on one incidental line (`app.go:207`); refactor `once` and it evaporates. One `var _ core.Subscriber = (*ui.Renderer)(nil)` in `cli` fixes it.

### Latent unsoundness

- **`Session` is a mutexless `Subscriber`** whose doc invites multiple Recorders (`internal/core/session.go:89-91, 151-175`) while `Recorder`'s doc advertises concurrency safety. The console serializes turns today; the type does not enforce what saves it.
- **A subscriber error desynchronizes every projection permanently** (`internal/core/recorder.go:280-286`) — the Trace holds the group, later subscribers never see it, nothing detects it.
- **`trace.Open` does not recover the Seq high-water mark** (`internal/trace/sink.go:59, 93-95`). The file opens `O_APPEND`, so a reused Session ID produces duplicate Seq today, not at resume-time.
- **Three projection folds are unchecked** (`session.go:156`, `ui.go:205`, `turn.go:213`). A new payload kind a person should see is simply invisible; no linter, no `Kinds()`-driven test covers them.

### The console is a god type

`tui.Console`: 1,178 lines, ~28 fields, two interfaces, owning terminal, layout, scroll, wrap, completion, captions, queueing, cancellation, and a WaitGroup over Runs. It is larger than `events` + `core/prompt` + `trace` combined. It works — the tests are good — but nothing inside it can be reused, replaced, or configured independently, and that is the opposite of the lego this plan is for.

### Look and feel are hardcoded by policy — a policy this plan supersedes

Two comments state it: "a style nobody chose is the only style there is" (`internal/ui/ui.go:83`), "a style a person had to select is a style most people never select" (`internal/tui/console.go:866`). Everything visual is inline: two greys, glamour's stock styles, border shape, `"› "`, the spinner glyph, `"…"`, the follow hint, `promptRows = 10`, the caption cadence. Keybindings are two string switches (`console.go:899, 984`) with no keymap type. There is **no project-local `.eva/` discovery at all** — `.eva` appears only as the home-directory suffix (`internal/config/config.go:261`).

The policy was right for stage 0 and is wrong for the product this becomes: a harness whose TUI the ecosystem is meant to extend (Product.md stage 6.5 ships `RegisterRenderer`; themes are named in the package manifest) cannot hold "nothing is configurable" as a permanent rule. Superseding it needs an ADR, and the ADR must keep what the policy protected: **the default requires no choice.** Zero-config stays perfect; configuration is for the person who goes looking.

### Small honesty debts

- depguard grants all of `core` to `providers`, though the intent is `core.Message` only; grants the Anthropic SDK and toml to *every* provider subpackage; has `-tests` rules for only two layers; and `core`'s `embed` allowance exists only for `core/prompt`.
- `eva -p` has no behavioural test, assumes a dark background, and never sets width.
- `Console.ask` duplicates `Control.Answer` (`console.go:37, 340`); `busy()` and `Busy()` read two different fields for one fact.
- Comment restatements to delete: `payload.go:137`, `payload.go:245`, and any comment the Part 1 test fails.

---

## Part 4 — The target shape

### The tree

One module, `internal/` layers, depguard strict — unchanged. The tree grows by splitting the two god surfaces (the console, the wiring) into domain packages, each named from the glossary:

```
cmd/eva/                 main: args in, exit code out. Imports cli only.        (unchanged)
internal/
  events/                THE schema. Sealed payloads, registry, codec.          (unchanged)
  core/                  Unit, Spec, Outcome, Recorder, Session. Pure.          (repairs only)
  core/prompt/           the compiled-in base prompt and its byte gate.         (unchanged)
  config/                resolution: defaults → home → project → env → flags.
                         Strict decode. The trust gate for repo-local files.    (grows)
  trace/                 TraceSink implementations. jsonl now; the registry
                         admits more.                                           (repairs + registry)
  providers/             Provider contract + registry.
    anthropic/           registers itself.
    openai/              stage 1, registers itself.
    fake/                registers itself; consumes events.Usage directly.
  ui/                    the fold: events in, rendered strings out.             (theme-aware)
  tui/                   the console, thinned to coordination.
    theme/               Theme: every colour, glyph, border, and style the
                         console or renderer draws with. Consumer-defined,
                         config-mapped at the root.                             (new layer + rule)
    keymap/              Keymap: named actions → chords, with the safety
                         invariant as a type, not a comment.                    (new layer + rule)
  cli/                   the composition root. Wiring only: reads config,
                         consults registries, hands domain types inward.
```

Every new directory under `internal/` lands with its `.golangci.yml` rule in the same commit — that is the existing law (`docs/agents/project-structure.md`), and it is what keeps "domain, not layer" from decaying into "directories, no boundaries".

### The registries

One pattern, four applications. The pattern is the command table the repo already has: one source, several consumers, and a test derived from the table so an unregistered thing fails the build.

**Providers.** `providers.Register(name string, build func(Options) (Provider, error))` with each implementation registering in its own package. `cli.open` becomes: look up `cfg.Provider.Name`, and the not-found error lists `providers.Names()` — a list that cannot go stale because it *is* the registry. Adding a provider becomes: one new package, one blank import at the root.

**Sinks.** Same shape over `core.TraceSink`, keyed by a new `[trace] kind` config key defaulting to `"jsonl"`. Opens the tee, the SQLite sink, and the remote sink at stage 6 without touching the root again.

**Subscribers.** `eva.subs` becomes append-only fan-out, and the capability claim separates from attachment: `Watch` splits into `Attach(sub core.Subscriber, opts ...WatchOption)` where `WithArriving(fn)` and `WithInterrupt()` are explicit. The Recorder's subscriber-error contract is repaired in the same motion (Part 5).

**Renderers.** The three unchecked payload folds get the events treatment: a per-kind display registry in `ui`, seeded from `events.Kinds()`, with a test asserting every kind either renders or is *explicitly* listed as silent. This is also the seam stage 6.5's `RegisterRenderer` publishes — built now for our own honesty, opened later for the ecosystem.

### The config surface — `.eva/*.toml`

**Resolution order, later wins, every file strict:**

1. Compiled defaults — the zero-config experience, still perfect.
2. `~/.eva/config.toml` (`$EVA_HOME` respected) — the person's standing choices.
3. `<repo>/.eva/*.toml` — found by walking up from the working directory to the VCS root. Project look-and-feel, shared by checking it in.
4. `$EVA_CONFIG` / `--config` — explicit wins over everything implicit.
5. Flags.

**The trust boundary is load-bearing and decided up front.** Product.md names `.eva/` in a cloned repo as untrusted content — a prompt-injection surface, not a convenience. So project-local files are honored by *key class*, not wholesale:

- **Appearance keys** (`theme.toml`, `keymap.toml`, layout, symbols): honored from the project. They can change what a person sees, never what a run may do.
- **Capability keys** (`provider`, `api_key_env`, `base_url`, `trace.path`, `script`): **refused from project-local files**, with an error naming the key, the file, and the file that may hold it. A repo must never be able to redirect a person's traffic, read their key from a different variable, or move their Trace.

One mechanism, stated once in `config`, tested key by key. This is the same narrow-never-widen rule hooks live under.

**The files:**

```toml
# .eva/config.toml — general keys (capability keys valid only in the home copy)
model = "claude-sonnet-4-5"

# .eva/theme.toml — everything the eye can check
[colors]      # subdued, error, accent, spinner — each an adaptive light/dark pair
[markdown]    # glamour style: "auto" | "dark" | "light" | path to a style json
[symbols]     # prompt = "› "   truncation = "…"   spinner = "minidot"
[borders]     # box = "normal" | "rounded" | "thick" | "none"
[layout]      # prompt_rows = 10   caption_seconds = 8

# .eva/keymap.toml — named actions, validated chords
[keys]
submit = "enter"
newline = ["shift+enter", "alt+enter"]
quit = "ctrl+c"
follow = "ctrl+end"
scroll_up = ["pgup", "shift+up"]
```

**Unknown key = error with migration guidance** (ADR 0009, unchanged, applied to every file in the chain — and the error names *which* file).

### Theme and keymap as domain types

`tui/theme.Theme` and `tui/keymap.Keymap` are defined in `tui`'s subtree (consumer-defined, per Part 1) and *constructed* in `cli` from config. The console and the renderer take them as values at build time; `tui` still never imports `config`, and the depguard rule proves it forever.

Two invariants move from comments into types:

- **The default is complete.** `theme.Default(dark bool)` reproduces today's exact look; every config key overrides one field of it. A person who configures nothing sees no change, this release or any after.
- **A binding cannot steal a prompt character.** Today that safety lives in a comment (`console.go:982`). `keymap.Parse` refuses any unmodified printable key for a global action — a malformed keymap is a config error at startup, never a console that eats the letter j.

### The console, thinned

`Console` keeps: the bubbletea model, message routing, the three-writer transcript pane, and the Run lifecycle. It sheds: styles (→ `theme`), key switches (→ `keymap` lookup), captions (already `caption.go`), and the ask/control duplication (one `Control` field; `busy` derived from one source of truth). The mechanical fixes ride along: `chrome()` composed once per frame, the per-call `lipgloss.NewStyle()` hoisted, `oneLine`'s byte-length column count replaced with `lipgloss.Width`.

Target: `console.go` under 700 lines, no field a test has to inject except the ones that exist for determinism (`pick`), and every literal a person can see resolved through `Theme`.

---

## Part 5 — Repairs to the kernel

These precede everything in Part 4, because a registry over an unsound core is lego on sand.

1. **`events.Usage` counters become `*uint64`** so absent and zero are distinct in the type, not in one provider's discipline. `SchemaVersion` → 2 per ADR 0006; the codec keeps reading v1 records. The anthropic `spend` accumulator shrinks; the Degraded dance stays only for what the API genuinely does not report.
2. **`Session` gets its mutex** (or a documented single-Recorder invariant enforced by construction — pick one, in an ADR; the survey favors the mutex since `Session.Open`'s doc already invites plural Recorders).
3. **Subscriber failure is contained, not contagious.** `commit` delivers to every subscriber and aggregates errors; a failing subscriber is marked desynchronized and told so on its next call, rather than silently starving every subscriber behind it.
4. **`trace.Open` recovers the high-water mark** by scanning the tail of an existing file (or refusing to append to a file whose Sessions it has not read — either is honest; silent duplicate Seq is not).
5. **`fake` consumes `events.Usage` directly** and asserts on the `Call` it receives — the one substitutable provider becomes able to verify what it was asked.
6. **depguard tightening:** a `core/prompt` rule (core drops `embed`), partitioned provider subpackage rules (fake loses the SDK, anthropic loses toml), `-tests` rules for the four layers missing them.
7. **The `var _ core.Subscriber = (*ui.Renderer)(nil)` line in `cli`**, so the documented guarantee has an owner.

---

## Part 6 — The build path

Each stage is a commit series that lands green, with an exit test that can fail. Order matters: repairs, then seams, then config, then surface. Nothing here blocks Product.md's stage 1 — this is the same base being hardened, not a detour.

### Stage R0 — Kernel repairs

Everything in Part 5.

**Exit test:** a constructed v1 trace file still decodes; a `Usage` event round-trips with `InputTokens` absent and the cost line says unreported rather than $0.00; two Recorders on one Session publish concurrently under `-race` clean; a subscriber that errors on event N still receives event N+1 with a desync mark; appending to an existing trace file continues Seq dense and gapless; `make check` passes with the tightened rules.

### Stage R1 — Registries

Providers, sinks, subscribers, renderers (Part 4). `open()`'s switch and `eva`'s single-slot assignment are deleted, not deprecated.

**Exit test:** a new provider package added in a test compiles into selection with zero edits outside its own directory plus one blank import; the unknown-provider error lists exactly `providers.Names()`; two subscribers both see every commit; a payload kind added to `events` fails the renderer-coverage test until explicitly rendered or explicitly silenced.

### Stage R2 — Config resolution and the trust gate

The five-source chain, project `.eva/` discovery to the VCS root, key-class trust enforcement.

**Exit test:** a repo-local `theme.toml` restyles the console; a repo-local `config.toml` carrying `api_key_env` exits non-zero naming the key, the file, and where the key is allowed; an unknown key in any file of the chain names its file; `EVA_HOME` and `--config` behaviour is unchanged bit-for-bit.

### Stage R3 — Theme and keymap

The two new layers with their linter rules, the console thinned, `ui` drawing through `Theme`.

**Exit test:** with no config, the rendered screen is byte-identical to before the stage (the existing console tests prove it — they assert on `Screen()`); every colour, glyph, and border in `theme.toml` provably reaches the screen (one table-driven test per key); a keymap binding `j` bare to an action is a startup error; rebinding `follow` works and the footer hint says the new chord — the hint text derives from the keymap, so help and behaviour cannot drift.

### Stage R4 — Readability pass

Applies the Part 1 comment test to every file; deletes the restatements; the `Console.ask`/`busy` duplications; the two dead exported symbols the survey found. No behaviour change.

**Exit test:** `make check` green; the diff contains no executable-code hunks except the named duplications; a reviewer can read `internal/tui/console.go` top to bottom in one sitting.

### Stage R5 — Docs repair

The docs drift a full survey found on 2026-08-09, held here as a work list. None of it is applied. Each item names its file and the repair, so the stage is executable without re-deriving the survey.

**README.md — two claims went stale when `eva -p` landed (commit `f624521`):**

- The Quick Start comment "the console, which is the whole command surface" and the paragraph "There is no prompt on the command line…" both predate `-p`. The repair: show `eva -p "<prompt>"` in the Quick Start block, and restate the paragraph so the two truths survive — `-p` answers one turn onto stdout and exits non-zero on failure, and there is still no machine-readable output mode because the Trace is the machine surface.
- The trap that made a true doc look false: the repo-root `eva` binary goes stale silently (the checked-out one predates `-p`). Verify every runnable README claim against a binary built from the same commit, and consider `.gitignore`-ing the root binary or building to a `bin/` the README names.

**README.md — the ADR index is a cache of the directory listing:**

The hand-enumerated semicolon list has gone stale once already (0023 had to be appended by hand). The ADR filenames are already sentence-titles, so the directory listing *is* the index — the same argument `docs/agents/project-structure.md` makes for `ls internal/`. The repair: replace the enumeration with the rule ("each file's name is its decision, so the directory listing is the index; an overturned clause is named in the superseded ADR's status line") and link `docs/Rebuild.md` in the Documents list.

**ADR 0011 — cites `--json`, a feature that no longer exists:**

The sentence "`--json` is a Subscriber for the same reason…" illustrates a rule with a removed feature. The rule survived the feature; the repair keeps it in present tense: any machine-readable surface is a Subscriber; `--json` was one while it existed; the Trace file is that surface now, and a reader folds what was committed.

**ADRs 0010 and 0021 — three names moved after the records were written:**

- `cli/render` became the `ui` layer (commit `695278e`, "the fold moves out of the frontend"), with the console beside it in `tui`. 0021 describes the *current* graph and says `render`; 0010's table says `cli/render` and its `cli` row says "machine-readable output", which left with `--json`. The row also says "REPL", a word CONTEXT.md has since retired for Console.
- The repair follows the pattern 0010/0015/0019 already set: a blockquote note under the existing supersession note mapping old names to current ones (`cli/render` → `ui`; machine-readable output → the Trace; REPL → Console), and one parenthetical in 0021's opening sentence. Nothing rewritten, nothing deleted.

**Standing discipline, so the drift does not recur:**

- Supersession stays clause-by-clause in the status line, blockquote-note in the body — never a silent rewrite.
- A retired-vocabulary sweep over `README.md` and `docs/` against CONTEXT.md's avoid-lists, kept as a repeatable check rather than a one-off; prose written before a retirement is the normal case, and the note pattern is the repair.
- A numbering note: no ADR 0022 ever existed — the number was skipped. Harmless, but a reader auditing the sequence should not hunt for a lost file.

**Exit test:** `make check` green over the doc edits; every command the README shows reproduces against a binary built from the same commit; a grep for `--json`, `cli/render`, and each avoid-list word over `README.md` and `docs/` returns only glossary definitions, supersession notes, and Product.md's own removal record.

### ADRs this plan requires

Written when their stage lands, in the repo's voice:

- *Look and feel are configuration, and the default requires no choice* — supersedes the two no-configuration comments; keeps their reason.
- *Project-local config is honored by key class* — the trust gate; the prompt-injection argument.
- *Selection is a registry* — providers, sinks, subscribers, renderers; the command table named as the precedent.
- *Usage counters are nullable* — the SchemaVersion 2 note.
- *One Session, many Recorders* — whichever concurrency answer stage R0 picks.

---

## Part 7 — Falsifiers

The plan is wrong, and should be revised rather than pushed through, if:

- The theme/keymap layers grow imports beyond `lipgloss` + stdlib — that means they became frontends, and the split was a layer, not a domain.
- The registry pattern needs a third mechanism (init-order tricks, reflection) to work — the command table's simplicity is the bar; miss it and hardcoded wiring was cheaper.
- Zero-config output changes in any release — the superseded policy was protecting exactly this, and losing it means the ADR failed.
- A capability key ever takes effect from a repo-local file, in any code path — that is not a bug to fix but the trust design failing closed being violated; stop and redesign.
