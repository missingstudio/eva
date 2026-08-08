// Package cli holds the frontend: the REPL, rendering, one-shot mode, and the
// machine-readable output path.
//
// Layer contract: cli is a pure consumer of events. Nothing imports cli — it is
// the top of the graph, and an import of it from any other layer would mean the
// core had grown a dependency on a user interface.
package cli
