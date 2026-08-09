// Package cli holds the frontend: the console and its commands. The fold a
// person reads a turn in is ui, which is a layer beside core rather than a
// package under this one — it holds no terminal, so it is consumed here rather
// than owned here.
//
// Layer contract: cli is a pure consumer of events. Nothing imports cli — it is
// the top of the graph, and an import of it from any other layer would mean the
// core had grown a dependency on a user interface.
package cli
