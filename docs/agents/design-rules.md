# Design rules

The practices that make this codebase composable, stated once so that a change
does not have to rediscover them.

They are descriptive before they are prescriptive: almost all of this is already
in force, and it is written down because a rule nobody wrote down is a rule the
next package quietly breaks. Where one is enforced by a linter rather than by
agreement, that is said.

## Packages are domains, not layers

A package is named for what it *is* (`events`, `trace`, `providers`, `theme`), never for what pattern it plays (`services`, `handlers`, `utils`, `common`, `helpers`). The test: the package name reads as a noun from CONTEXT.md's glossary. `internal/` passes this test: the "layers" of ADR 0010 are domain packages with a fixed import direction, not horizontal strata. Every new package earns a glossary entry before it earns a directory.

A `util` package is the failure mode. It is where code goes when nobody decided what domain it belongs to, and it becomes the package everything imports and nothing can leave.

## Deep modules: small surface, real work behind it

The best packages here are already deep. `events` exposes one sealed interface and a codec, and behind them sits the registry that makes the round-trip test exhaustive by construction (`internal/events/payload.go`). `trace.Sink` is two methods hiding atomic group writes, Seq assignment, and chunk folding. Depth is the target for every package: when a package's doc comment is longer than its export list, it is deep enough.

## Interfaces belong to the consumer

Go's idiom, and the repo's best seam, is the interface defined where it is *needed*, not where it is implemented. `tui.Control` (`internal/tui/command.go:43`) is five methods the console needs, defined in `tui`, implemented by `cli` — so the frontend can be tested with a six-line stub and can never reach a Provider or the Trace. `core.TraceSink` is the same inversion: core declares, `trace` implements.

The corollary: **accept interfaces, return structs.** Constructors take the contracts they consume (`render.New(screen Screen, look theme.Theme)`) and return concrete types callers can grow with.

The second corollary: **keep interfaces small.** One to three methods. `Provider` is two. `Screen` is one. An interface that grows past four methods is usually two interfaces.

## Composition is explicit, selection is a registry

Go composes by embedding and by passing values — there is no inheritance to lean on, which is the point. Composition has two halves and both are in force:

- The *contract* half: anything can implement `Provider`, `TraceSink`, `Subscriber`.
- The *selection* half: a registry the implementations put themselves into, the standard library's own answer (`database/sql` drivers, `image` formats). `providers.Open` reads one, `trace.New` reads its own, and `Attach` appends projections rather than assigning one — so the layer that wires a run knows no implementation by name, and the error naming what a person may choose is read from the registry rather than written where it would go stale.

A registry turns "add an implementation" from four edits in three packages into one package that registers itself plus one config line. ADR 0028 holds the reasoning, and its falsifier: selection that needs more than a name and a small struct wants a factory at the composition root, not a wider registry.

## Sealed where closed, registered where open

The event kind set is closed and the compiler enforces it (unexported method on `Payload`). The provider set is open and nothing should enforce it. Knowing which of the two a type is — and making the code say so — is most of extensibility. The rule: **kernel vocabulary is sealed; capability is registered.** This is the same kernel/extension boundary Product.md Part 2 draws.

## Config flows inward as domain types, never as config types

`config.Config` is a file format. It stops at the composition root (`cli`). What crosses into a domain package is that package's own type: `theme` and `tui/keymap` define what the interface draws with, and `cli` maps TOML onto them. This is why depguard's `tui` rule holds — the console never imports `config` — while every visual choice is still configurable. A package that imports `config` to read one field has inverted the dependency.

## Comments carry rationale or they go

The repo's own rule (`AGENTS.md`): a comment states a decision in its own words, cites no document, and never narrates the next line. The test for every comment: *could the reader have written this comment themselves after reading the code?* If yes, delete it. If it names an invariant, a trap, or a rejected alternative — keep it, that is what comments are for.

## Purity and honesty gates stay

Three mechanisms make the other rules checkable rather than aspirational, and are not negotiable:

- **`core` is pure** and its allow list does not even include the standard library wholesale (ADR 0010).
- **depguard in strict mode** — every layer's imports are an allow list that fails closed.
- **One module, `./...` reaches everything** (ADR 0021) — a green check means every package is green.

---

## Where these are enforced

Only some of this is a rule a machine holds. Knowing which is which is the
difference between a contract and a habit.

| Rule | Held by |
| --- | --- |
| The import graph, and every layer's allow list | `depguard`, `list-mode: strict`, in `.golangci.yml` |
| `core` is pure | the same, with an allow list that omits the standard library |
| One module, `./...` reaches everything | ADR 0021, and CI gates on a nested `go.mod` |
| The closed set of Event kinds | the compiler, via an unexported method (ADR 0005) |
| Every kind is rendered or explicitly silent | a test over the schema's own registry |
| The base prompt's byte budget | a test (ADR 0020) |
| Everything else here | review, and this document |

A rule in the last row that keeps being broken is a rule that wants a linter,
not a stronger sentence.
