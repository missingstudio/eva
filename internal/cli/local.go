package cli

import (
	"os"
	"strings"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
	"github.com/missingstudio/eva/internal/tui"
)

// local is what this Frontend answers about its own machine. No Transport
// carries one: a program starts where a person is sitting, a build and a
// directory describe one computer, and what was checked after a turn failed was
// checked where the request was made. A Frontend driving a Server reports
// itself, which is the true answer rather than the convenient one.
type local struct {
	// editor is the program a long prompt is written in, as the configuration
	// named it. It is empty when the configuration named none, and the
	// environment answers instead — see Editor.
	editor string

	// checks is what a failed turn's remedy is established from: the
	// configuration this Frontend was started with, and the store a login lives
	// in. See Remedy for why the checking lives in this layer and the sentence
	// does not.
	checks checks
}

// local is what a console asks of its own machine, and Local is the whole of
// what it can ask. Every answer it gives is below, so what a Frontend knows
// about the machine it runs on is one file rather than a search: what is
// elsewhere is the establishing — the build in about.go, the checking in
// remedy.go — and neither of those is a question a person asks.
var _ tui.Local = (*local)(nil)

// About is what this build is and where it is running.
func (l *local) About() tui.About {
	return tui.About{
		Version: version(),
		Branch:  branch(),
		Dir:     workingDir(),
	}
}

// Editor is the program a long prompt is written in: the one the configuration
// named, or the one the environment names when it named none.
func (l *local) Editor() tui.Editor {
	named := l.editor
	for _, envvar := range []string{"VISUAL", "EDITOR"} {
		if named != "" {
			break
		}
		named = strings.TrimSpace(os.Getenv(envvar))
	}

	fields := strings.Fields(named)
	if len(fields) == 0 {
		return tui.Editor{}
	}
	return tui.Editor{Command: fields[0], Args: fields[1:]}
}

// Remedy is what was checked about this machine after a turn failed this way,
// and the one command that follows. The checking is in remedy.go, so that what
// a failed turn establishes can be put in front of a test without an assembly
// around it.
func (l *local) Remedy(class events.ErrorClass, model string) render.Remedy {
	return l.checks.remedy(class, model)
}
