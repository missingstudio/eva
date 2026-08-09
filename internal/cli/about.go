package cli

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"

	"github.com/missingstudio/eva/internal/tui"
)

// Version is the build a person is talking to.
//
// It is a constant rather than something read from a tag, because a binary
// built from a working tree has no tag and would then have no version — and a
// version that is sometimes absent is one nobody can quote in a bug report. The
// revision below is what distinguishes two builds of one version.
const Version = "0.1.0"

// About is what the console opens saying about the run behind it.
//
// Every fact here comes from outside the program, which is why it is assembled
// in this layer: a frontend that read a repository or a process for itself
// would be a frontend reaching the world, and the whole of what it may reach is
// the five methods of tui.Control.
//
// A fact that cannot be had is left empty rather than guessed, and the masthead
// draws no line for it. Eva run outside a repository has no branch, and saying
// "unknown" would be filling a row with the absence of information.
func (e *eva) About() tui.About {
	return tui.About{
		Version: version(),
		Branch:  branch(),
		Dir:     workingDir(),
	}
}

// version is the build, and the revision when the build carries one.
//
// A binary built from a dirty tree says so. Two people reporting a fault from
// "0.1.0" who are in fact on different commits is the thing this prevents, and
// it costs seven characters.
func version() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return Version
	}

	var revision string
	var modified bool
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			modified = setting.Value == "true"
		}
	}

	switch {
	case revision == "":
		return Version
	case modified:
		return Version + "+" + revision[:min(7, len(revision))] + ".dirty"
	default:
		return Version + "+" + revision[:min(7, len(revision))]
	}
}

// branch is the branch of the repository the run is standing in, and is empty
// outside one.
//
// It reads the file rather than running git. A subprocess to learn one word
// would be a process spawned before the first frame is drawn, and it would put
// a program Eva does not control on the path between starting and showing
// something — on a machine where that program is missing, slow, or waiting on a
// lock.
//
// A detached head has no branch and says nothing, which is honest: what a
// person wants from this line is the name they would push to.
func branch() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}

	for {
		head, err := os.ReadFile(filepath.Join(dir, ".git", "HEAD"))
		if err == nil {
			ref, found := strings.CutPrefix(strings.TrimSpace(string(head)), "ref: refs/heads/")
			if !found {
				return ""
			}
			return ref
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// workingDir is where the run is standing, with the home directory written the
// way a person writes it.
//
// The home directory is shortened because the part of a path that identifies it
// is the end, and a masthead that spent half its width on /Users/somebody would
// push the part that matters off a narrow window.
func workingDir() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}

	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return dir
	}
	if rest, under := strings.CutPrefix(dir, home); under {
		return "~" + rest
	}
	return dir
}
