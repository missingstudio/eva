package cli

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"

	"github.com/missingstudio/eva/internal/tui"
)

const Version = "0.1.1"

func (e *eva) About() tui.About {
	return tui.About{
		Version: version(),
		Branch:  branch(),
		Dir:     workingDir(),
	}
}

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
		return Version + module(info)
	case modified:
		return Version + "+" + revision[:min(7, len(revision))] + ".dirty"
	default:
		return Version + "+" + revision[:min(7, len(revision))]
	}
}

// module is what the module graph knows about this build, and is empty when
// that adds nothing to the constant.
func module(info *debug.BuildInfo) string {
	switch v := info.Main.Version; v {
	case "", "(devel)", "v" + Version:
		return ""
	default:
		return " (" + v + ")"
	}
}

func versionReport(stdout io.Writer) error {
	_, err := fmt.Fprintf(stdout, "eva:      %s\ngo:       %s\nplatform: %s/%s\n",
		version(), runtime.Version(), runtime.GOOS, runtime.GOARCH)
	return err
}

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
