// Package cli holds the frontend: the console, its commands, and the rendering
// a person reads a turn in.
//
// Layer contract: cli is a pure consumer of events. Nothing imports cli — it is
// the top of the graph, and an import of it from any other layer would mean the
// core had grown a dependency on a user interface.
package cli
