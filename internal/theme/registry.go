package theme

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// A look Eva ships with, selectable by name.
const (
	Eva      = "eva"
	Contrast = "contrast"
	Mono     = "mono"
)

// Build makes one look for a background.
type Builder func(bg Background) Theme

var (
	mu    sync.RWMutex
	looks = map[string]Builder{}
)

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

func Named(name string, bg Background) (Theme, error) {
	if name == "" {
		return Default(bg), nil
	}

	mu.RLock()
	build, known := looks[name]
	mu.RUnlock()

	if !known {
		return Theme{}, fmt.Errorf("theme: %q is not a look Eva draws (it draws: %s)",
			name, strings.Join(Names(), ", "))
	}
	return build(bg), nil
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

func contrast(bg Background) Theme {
	t := Default(bg)
	t.Colors.Subdued = pick(bg, contrastSubduedOnLight, contrastSubduedOnDark)
	t.Colors.Person = pick(bg, contrastPersonOnLight, contrastPersonOnDark)
	t.Colors.Eva = t.Colors.Subdued
	t.Colors.Failure = pick(bg, contrastFailureOnLight, contrastFailureOnDark)
	t.Markdown.Heading = pick(bg, contrastPersonOnLight, contrastPersonOnDark)
	return t
}

// mono names no hue at all.
func mono(bg Background) Theme {
	t := Default(bg)
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
