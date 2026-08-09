package providers

import (
	"fmt"
	"sort"
	"sync"
)

// Options is what a Provider is built from.
//
// It is the settings a person chose, in terms this layer can name. What a
// person wrote them in is TOML, and the layer that reads TOML is config — which
// may not import this one, and must not, or a Provider would be able to read
// the file that selects it. So the shape crossing the boundary is this, and the
// mapping from a file onto it happens once, where a run is wired.
//
// The set is deliberately small and every field is here because a Provider in
// this repository needs it. A Provider that needs a setting nobody has is a
// conversation about the field, not a map of strings to be read differently by
// each implementation.
type Options struct {
	// Credential resolves the secret a Provider authenticates with, and is
	// never the secret itself.
	//
	// It is a function because resolving one can fail, and only a Provider that
	// needs a credential should be able to fail for want of it. Resolved up
	// front instead, a recording replayed from a file would refuse to open for
	// want of an API key it never sends. It also keeps the credential out of a
	// struct that gets logged, compared, or copied on the way here.
	Credential func() (string, error)

	// Subscription says the credential is a login's short-lived access token
	// rather than an API key. A Provider that serves both resolves the
	// credential per attempt in this mode — the token renews under a long
	// session — and speaks to the endpoint the vendor serves subscriptions
	// from, which is not always the one an API key reaches.
	Subscription bool

	// BaseURL points a Provider at a gateway or a proxy. Empty is the vendor's
	// own endpoint.
	BaseURL string

	// MaxTokens caps one response. Zero leaves the cap to the Provider.
	MaxTokens int64

	// Recording is the file a replaying Provider reads, already resolved to a
	// path this process can open.
	Recording string
}

// Build makes one Provider from the settings a person chose.
type Build func(Options) (Provider, error)

var (
	mu       sync.RWMutex
	builders = map[string]Build{}
)

// Register adds a Provider to the set configuration can select, under the name
// that selects it. It is called from an implementation's init, beside the
// implementation.
//
// Selection used to be a switch in the layer that wires a run, which meant
// adding a Provider was four edits in three packages — the switch, the sentence
// listing what a person may choose, the settings it reads, and the
// implementation itself. Two of the four did not stop the build when they were
// forgotten, so the list a person was offered could be missing a Provider that
// worked.
//
// A duplicate registration panics at init rather than at the first run that
// meets it: two Providers answering to one name is a configuration that cannot
// mean one thing, and which of them a person got would depend on link order.
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

// Open builds the Provider registered under a name.
//
// The error names what a person may choose instead, read from the registry, so
// it cannot go stale the way a hand-written sentence did.
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

// choices writes a list the way a sentence reads it.
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
