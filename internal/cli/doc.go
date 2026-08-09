// Package cli is the process surface and the assembly: what a command line may
// say, the Provider and sink and Session a run is built from, and the frontend
// that is then handed the whole of it.
//
// The console is tui and the fold a person reads a turn in is ui. Both are
// layers of their own rather than packages under this one, and what they cannot
// reach is the point: a frontend that could open a Provider or read the Trace
// could show a person a turn the record does not hold.
//
// Layer contract: cli is a pure consumer of events. Nothing imports cli — it is
// the top of the graph, and an import of it from any other layer would mean the
// core had grown a dependency on a user interface.
package cli
