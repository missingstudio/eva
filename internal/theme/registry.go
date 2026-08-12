package theme

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// A look Eva ships with, selectable by name.
//
// Three, and each one answers a question the others cannot. Eva is what Eva has
// always looked like. Contrast is for a terminal whose greys are unreadable, or
// eyes that find them so. Mono names no hue at all, for a terminal with no
// colour and for anyone who wants none.
//
// The second and the third are the accessibility answer, and they are one line
// of configuration each. Before this, both were a block of hex a person had to
// compose themselves — which is to say they existed for whoever already knew
// what to write.
const (
	Eva      = "eva"
	Contrast = "contrast"
	Mono     = "mono"
)

// Build makes one look for a background.
//
// It takes the background because every grey in a Theme is chosen against one,
// and the terminal answers what colour it is after the interface is already up.
// A registered look is therefore a function rather than a value.
type Builder func(dark bool) Theme

var (
	mu    sync.RWMutex
	looks = map[string]Builder{}
)

// Register adds a look to the set configuration can select, under the name that
// selects it.
//
// It is a registry for the reason the Providers and the Trace sinks are: the
// error that names what a person may choose reads the registry, so it cannot go
// stale, and adding a look is one package registering itself rather than edits
// in three. What it is not is a gallery — a fourth look wants an argument about
// who cannot read the first three.
//
// A duplicate panics at init rather than at the run that meets it. Two looks
// answering to one name is a configuration that cannot mean one thing, and which
// one a person got would depend on link order.
func Register(name string, build Builder) {
	if name == "" {
		panic("theme: a look registered under no name cannot be selected")
	}
	if build == nil {
		panic(fmt.Sprintf("theme: %q registered with no way to build it", name))
	}

	mu.Lock()
	defer mu.Unlock()

	if _, dup := looks[name]; dup {
		panic(fmt.Sprintf("theme: %q is registered twice", name))
	}
	looks[name] = build
}

func init() {
	Register(Eva, Default)
	Register(Contrast, contrast)
	Register(Mono, mono)
}

// Named builds the look registered under a name.
//
// An empty name is the default look, because a person who named nothing has
// chosen nothing — and ADR 0030 holds that the default is not a choice.
func Named(name string, dark bool) (Theme, error) {
	if name == "" {
		return Default(dark), nil
	}

	mu.RLock()
	build, known := looks[name]
	mu.RUnlock()

	if !known {
		return Theme{}, fmt.Errorf("theme: %q is not a look Eva draws (it draws: %s)",
			name, strings.Join(Names(), ", "))
	}
	return build(dark), nil
}

// Names is the registered set, sorted so that the order is the same on every
// run.
func Names() []string {
	mu.RLock()
	defer mu.RUnlock()

	out := make([]string, 0, len(looks))
	for name := range looks {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// contrast is Eva with the greys raised and the marks stronger.
//
// The subdued grey is what a person reads the interface's own words in, and on a
// washed-out terminal — a projector, a bright room, a low-contrast profile — it
// is the first thing to disappear. This raises it towards the foreground rather
// than to it: the answer is still what stands out, which is the whole hierarchy
// of this interface and not something a contrast setting should overturn.
func contrast(dark bool) Theme {
	t := Default(dark)
	t.Colors.Subdued = pick(dark, contrastSubduedOnLight, contrastSubduedOnDark)
	t.Colors.Person = pick(dark, contrastPersonOnLight, contrastPersonOnDark)
	t.Colors.Eva = t.Colors.Subdued
	t.Colors.Failure = pick(dark, contrastFailureOnLight, contrastFailureOnDark)
	t.Markdown.Heading = pick(dark, contrastPersonOnLight, contrastPersonOnDark)
	return t
}

// mono names no hue at all.
//
// Every colour is nil, which is what "the terminal's own foreground" is: nothing
// is emitted for it, so the text is whatever a person has configured their
// terminal to draw. It is for a terminal with no colour, for a recording, and
// for anyone who wants an interface that does not decide.
//
// Faintness stays. It is not a hue — it is a weight the terminal applies to its
// own foreground — and without it the interface's own words would carry exactly
// as much emphasis as the answer, which would leave the hierarchy to be inferred
// from the wording.
//
// The answer is drawn plain rather than left to the renderer's own palette.
// Naming no colour for it would mean the library's choice for the background,
// which is a colour — and a look called mono whose answers arrive in four of them
// would be a look that does not do what it says.
func mono(dark bool) Theme {
	t := Default(dark)
	t.Colors = Colors{}
	t.Markdown = Markdown{Plain: true}
	return t
}

// The greys and marks the contrast look raises them to. All are true colour, and
// what reaches a terminal is downsampled to what it can show.
var (
	contrastSubduedOnLight = hexColor("#2B2B2B")
	contrastSubduedOnDark  = hexColor("#E4E4E4")
	contrastPersonOnLight  = hexColor("#0B4F9E")
	contrastPersonOnDark   = hexColor("#8FC1FF")
	contrastFailureOnLight = hexColor("#8C1002")
	contrastFailureOnDark  = hexColor("#FF9E8A")
)
