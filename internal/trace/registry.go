package trace

import (
	"fmt"
	"sort"
	"sync"

	"github.com/missingstudio/eva/internal/core"
)

// JSONL is the name configuration selects the append-only JSONL Trace by, and
// is what a configuration that names no kind gets.
const JSONL = "jsonl"

// Options is where a Trace goes.
//
// One field, because one is what every sink so far needs and a field nobody
// fills is a field that means nothing. A sink that writes somewhere a path
// cannot name — an object store, a stream, a table — is the conversation that
// widens this, and it should be a conversation.
type Options struct {
	// Path is the file or the location a sink writes to, already expanded.
	Path string
}

// Build opens one sink.
type Build func(Options) (core.TraceSink, error)

var (
	mu    sync.RWMutex
	sinks = map[string]Build{}
)

// The JSONL sink this package ships puts itself in the set, the same way a sink
// in any other package would.
func init() {
	Register(JSONL, func(o Options) (core.TraceSink, error) { return Open(o.Path) })
}

// Register adds a sink to the set configuration can select.
//
// The Trace is the single source of truth and every projection is a fold over
// it, so where it is written is the one thing a deployment is most likely to
// need to change: a file on a laptop, a table on a Worker, an object store for a
// fleet. The interface admitted all three and the wiring admitted one.
//
// A duplicate registration panics at load, for the reason a duplicate Provider
// does: which sink a person got would otherwise depend on link order, and a
// Trace written to the wrong place is not something to discover at run time.
func Register(kind string, build Build) {
	if kind == "" {
		panic("trace: a sink registered under no name cannot be selected")
	}
	if build == nil {
		panic(fmt.Sprintf("trace: %q registered with no way to open it", kind))
	}

	mu.Lock()
	defer mu.Unlock()

	if _, dup := sinks[kind]; dup {
		panic(fmt.Sprintf("trace: %q is registered twice", kind))
	}
	sinks[kind] = build
}

// New opens the sink registered under a kind. An empty kind is JSONL, so a
// configuration that says nothing about where its Trace goes still gets one.
func New(kind string, o Options) (core.TraceSink, error) {
	if kind == "" {
		kind = JSONL
	}

	mu.RLock()
	build, known := sinks[kind]
	mu.RUnlock()

	if !known {
		return nil, fmt.Errorf("unknown trace kind %q: want %v", kind, Kinds())
	}
	return build(o)
}

// Kinds is the registered set, sorted so that the order is the same on every
// run.
func Kinds() []string {
	mu.RLock()
	defer mu.RUnlock()

	out := make([]string, 0, len(sinks))
	for kind := range sinks {
		out = append(out, kind)
	}
	sort.Strings(out)
	return out
}
