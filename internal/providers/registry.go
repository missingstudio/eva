package providers

import (
	"fmt"
	"sort"
	"sync"

	"github.com/missingstudio/eva/internal/providers/retry"
)

type Options struct {
	// Credential is how a Provider authenticates, and the mode that decides
	// what kind of secret that is. The zero value is the one a Provider that
	// sends nothing is built with.
	Credential Credential

	BaseURL string

	MaxTokens int64

	Retry retry.Policy
}

type Build func(Options) (Provider, error)

var (
	mu       sync.RWMutex
	builders = map[string]Build{}
)

// Register adds a Provider to the set configuration can select, under the name
// that selects it. It is called from an implementation's init, beside the
// implementation.
func Register(name string, build Build) {
	if name == "" {
		panic("providers: a Provider registered under no name cannot be selected")
	}

	if build == nil {
		panic(fmt.Sprintf("providers: %q registered with no way to build it", name))
	}

	mu.Lock()
	defer mu.Unlock()

	if _, dup := builders[name]; dup {
		panic(fmt.Sprintf("providers: %q is registered twice", name))
	}
	builders[name] = build
}

func Open(name string, o Options) (Provider, error) {
	mu.RLock()
	build, known := builders[name]
	mu.RUnlock()

	if !known {
		return nil, fmt.Errorf("unknown provider %q: want %s", name, choices(Names()))
	}
	return build(o)
}

// Names is the registered set, sorted so that the order is the same on every
// run.
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
		return "no Provider is registered in this build"
	case 1:
		return fmt.Sprintf("%q", names[0])
	}

	quoted := make([]string, len(names))
	for i, name := range names {
		quoted[i] = fmt.Sprintf("%q", name)
	}
	return fmt.Sprintf("%s or %s",
		join(quoted[:len(quoted)-1]), quoted[len(quoted)-1])
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
