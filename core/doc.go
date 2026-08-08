// Package core holds Eva's domain: Unit, Spec, Outcome, the loop, and the
// interfaces the outer layers implement — including TraceSink.
//
// Layer contract: core is pure. It imports events and nothing else from within
// Eva, and it never reaches the outside world — no filesystem, no network, no
// terminal, no subprocesses. Implementations that do those things live beside
// core, not inside it, and satisfy an interface declared here.
package core
