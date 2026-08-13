package harness

import (
	"fmt"
	"sort"
	"sync"

	"github.com/missingstudio/eva/internal/providers"
)

// Options is what any Harness may be built from. Eva reaches a Provider; a
// Harness that shells out to somebody else's tool will need something else, and
// it adds the field it needs rather than the layer growing a branch per name.
type Options struct {
	// Provider is the model a Harness that calls one reaches.
	Provider providers.Provider

	// ProviderName is what configuration selected the Provider by, and is what
	// a failure names. It is told rather than asked of the Provider: the
	// registry key is the name, and a second copy of it on the Provider would
	// be a copy that could disagree with the one a person wrote.
	ProviderName string
}

type Build func(Options) (Harness, error)

var (
	mu       sync.RWMutex
	builders = map[string]Build{}
)

// Register adds a Harness to the set configuration can select, under the name
// that selects it. It is called from an implementation's init, beside the
// implementation.
func Register(name string, build Build) {
	if name == "" {
		panic("harness: a Harness registered under no name cannot be selected")
	}

	if build == nil {
		panic(fmt.Sprintf("harness: %q registered with no way to build it", name))
	}

	mu.Lock()
	defer mu.Unlock()

	if _, dup := builders[name]; dup {
		panic(fmt.Sprintf("harness: %q is registered twice", name))
	}
	builders[name] = build
}

func Open(name string, o Options) (Harness, error) {
	mu.RLock()
	build, known := builders[name]
	mu.RUnlock()

	if !known {
		return nil, fmt.Errorf("unknown harness %q: want %s", name, choices(Names()))
	}
	return build(o)
}

// Names is the registered set, sorted so that the order is the same on every
// run. The sentence naming what a person may select is read from here, so it
// cannot go stale.
func Names() []string {
	mu.RLock()
	defer mu.RUnlock()

	out := make([]string, 0, len(builders))
	for name := range builders {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func choices(names []string) string {
	switch len(names) {
	case 0:
		return "no Harness is registered in this build"
	case 1:
		return fmt.Sprintf("%q", names[0])
	}

	quoted := make([]string, len(names))
	for i, name := range names {
		quoted[i] = fmt.Sprintf("%q", name)
	}
	return fmt.Sprintf("%s or %s", join(quoted[:len(quoted)-1]), quoted[len(quoted)-1])
}

func join(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
