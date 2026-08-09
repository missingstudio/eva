---
status: accepted
---

# The repository is one module, and `internal` is where a package goes

One `go.mod` at the root holds every package. The binary lives in `cmd/eva`. Every layer lives in `internal/`, and the layer graph ADR 0010 fixed is unchanged: `events` at the bottom, `core` pure above it, `config`, `providers` and `trace` beside it, `cli` on top, `render` narrower than `cli` (with the console beside it in `tui`, and `theme` beside both).

This supersedes the packaging half of ADR 0010 — six modules tied by `go.work`, and no root module. It supersedes none of the graph.

## Why the modules went

A module is the unit of *publication*. Nothing here was ever published. Each of the six required its siblings at `v0.0.0` and then replaced that requirement with a relative path, which is the shape a module takes when it is a directory wearing a module's clothes.

What the six cost was not theoretical:

- Six `go.mod` and six `go.sum` files, each needing its own `go mod tidy`, and a replace block in five of them that existed only to undo the version nobody set.
- `go build ./...` from the root matched one module and reported success while another was broken. Every target in the Makefile had to loop over `go list -m` to be honest, and CI needed a step asserting the loop covered anything at all.

The boundary that does the work was never the module. It is `depguard`, and `depguard` reads file paths and import paths — both of which survive the move. The rules were rewritten, not weakened: every allow list is still strict, and still fails closed.

## What the move buys

`./...` is honest. A green `make check` now means every package is green, because there is one module and `./...` reaches all of it. The Makefile lost its loop and CI lost the step that watched the loop.

`internal/` is a stronger boundary than six unpublished modules were. Nothing prevented an outside importer from naming `github.com/missingstudio/eva/core`; it simply would not resolve. The compiler now refuses the import outright, and the refusal is a rule about where the *importer* sits rather than about what happens to be published. Eva's layers are Eva's, and the tree says so.

Promoting a package out of `internal/` later is a deliberate act that makes a promise to whoever imports it. Keeping everything in until then is what leaves that promise unmade.

## What it costs

`events` proves its kind set is sealed by compiling a package that tries to break it. That probe used to be a throwaway module named `sealed` with a replace pointing at `events/`. Under `internal/` it cannot be: an internal package is importable only from within the tree rooted at internal's parent, and that is a rule about the importing module's path. The probe therefore takes a path under this one — `github.com/missingstudio/eva/sealedprobe` — and replaces the whole repository rather than one layer of it.

The test still proves what it always proved. The seal under test is the unexported method on `Payload`, which is a property of the package, not of the directory. Standing the probe inside the tree is what keeps it testing the seal instead of testing `internal`.

## Considered options

- **Keep the six and live with the loop.** Rejected. The loop was a workaround for a split that bought nothing, and it had already grown a CI step to guard it. Two mechanisms existed to make a check honest that one module makes honest for free.
- **One module, but layers at the root rather than under `internal/`.** Rejected. The layers would be importable by anyone, which is a promise this repository is not ready to make about any of them. `internal/` costs one path element and withdraws the promise.
- **Split again later, per layer, when something is genuinely published.** Available and unchanged by this decision. A layer that earns publication moves out of `internal/`, and a layer that earns independent versioning becomes a module again. Neither is harder to reach from here than from six modules.

## Consequences

Import paths carry `internal/`, so this touched every import in the repository once. It is the same expense ADR 0010 named, paid in the other direction, and it is cheapest now for the same reason.

A new layer is a directory under `internal/` and a rule in `.golangci.yml`. There is no `go.work` entry to forget, because there is no `go.work`. A layer with no rule still falls through to depguard's standard-library-only default, so a forgotten rule still fails loudly.

A `go.mod` anywhere below the root would cut its whole subtree out of `./...` and every target would go green over less code than before — the exact failure the six modules had. CI gates on it.
