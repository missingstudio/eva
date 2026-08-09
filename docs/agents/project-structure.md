# Project Structure

One module at the root. `cmd/` holds the binaries, `internal/` holds every layer, and the layer graph is the one ADR 0010 fixed.

`ls internal/` tells you what exists faster than this document can. This is for where the next thing goes, and for the three things the checks will not say out loud.

## Where a new thing goes

**A package inside an existing layer** — a directory under that layer, such as `internal/providers/openai`. The layer's depguard rule already covers it, because the rules match on path. Its imports are the layer's imports. Needing more is the layer's allow list widening, and that widening is the reviewable act.

**A new layer** — a directory under `internal/`, and a rule in `.golangci.yml`. Both, every time. The rule is neither optional nor inferred.

**A new binary** — a directory under `cmd/`, holding a `main` that reads its arguments, calls into the frontend, and returns an exit code. Its allow list is the standard library and `internal/cli`. A binary that wants more than the frontend exposes is telling you the frontend should expose it, because a second place that knows how a run is wired is a second place for the wiring to drift.

The root holds the module, the Makefile, the linter config, and the docs.

## What the checks will not say out loud

**A layer with no rule fails closed, but the message names the import.** Every rule is `list-mode: strict`, and a file matching no rule falls through to a standard-library-only default. A new layer without a rule therefore fails on its first Eva import, and the error says that import is not allowed — not that the rule is missing. When a layer you just added rejects an import that is plainly fine, the missing rule is why.

**`internal` is a rule about the importer, not the import.** A package under `internal/` is importable only from inside the tree rooted at internal's parent, and that tree is decided by the importing module's path. This is why the sealed-payload probe in `internal/events` builds a throwaway module named `github.com/missingstudio/eva/sealedprobe` and replaces the whole repository: a module named anything else cannot reach an internal package, whatever it replaces. See ADR 0021.

**A `go.mod` below the root would go green over less code.** `./...` reaches one module, so a nested `go.mod` cuts its whole subtree out and every target still passes — over fewer packages than the run before it. CI gates on this. Nothing local does.

## Where the graph is written

`.golangci.yml` holds one rule per layer, and every line of every allow list carries the reason it is there. ADR 0010 holds the layer graph and the purity rule; ADR 0021 holds the packaging and why the six modules became one.

Widening an allow list is a deliberate act, and the comment beside the new line is what keeps it reviewable. A line that arrives without one is a boundary that moved without a reason.
