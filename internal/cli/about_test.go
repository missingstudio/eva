package cli

import (
	"bytes"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
)

// The version a person quotes in a fault report. What these hold is that it is
// never absent and never ambiguous: every build path says something, and no two
// build paths say the same thing about different code.

func TestTheModuleVersionFillsInWhereTheRevisionIsAbsent(t *testing.T) {
	cases := []struct {
		name string
		main string
		want string
	}{
		{
			// What `go install …@main` produces. The pseudo-version carries the
			// commit, so this is the one qualifier that matters.
			name: "a pseudo-version is reported, because it names the commit",
			main: "v0.1.1-0.20260810120000-78a24780b1c2",
			want: " (v0.1.1-0.20260810120000-78a24780b1c2)",
		},
		{
			name: "a version that only repeats the constant is dropped",
			main: "v" + Version,
			want: "",
		},
		{
			// A build from a working tree, where the module graph knows nothing
			// the VCS stamps do not already say better.
			name: "a development build says nothing here",
			main: "(devel)",
			want: "",
		},
		{
			name: "an absent version says nothing here",
			main: "",
			want: "",
		},
		{
			// A tag that disagrees with the constant is the one case CI is
			// supposed to make impossible. If it ever happens, saying both is
			// how somebody finds out.
			name: "a version that disagrees with the constant is reported",
			main: "v9.9.9",
			want: " (v9.9.9)",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := module(&debug.BuildInfo{Main: debug.Module{Version: c.main}})
			if got != c.want {
				t.Errorf("module(%q) = %q, want %q", c.main, got, c.want)
			}
		})
	}
}

func TestTheVersionAlwaysCarriesTheConstant(t *testing.T) {
	// Whatever the build, the constant is the part a person reads first. This
	// is the property that made it a constant rather than something read from a
	// tag, so it is the property worth a test.
	if got := version(); !strings.HasPrefix(got, Version) {
		t.Errorf("version() = %q, which does not begin with the constant %q", got, Version)
	}
}

func TestTheVersionVerbReportsTheBuildTheToolchainAndThePlatform(t *testing.T) {
	var stdout bytes.Buffer

	code := Main([]string{"version"}, strings.NewReader(""), &stdout, &bytes.Buffer{})
	if code != ExitOK {
		t.Fatalf("eva version exited %d, want %d", code, ExitOK)
	}

	// Each line is a checked fact about the running process, so each is
	// compared against the process rather than against a written-out string.
	for _, want := range []string{
		"eva:      " + version(),
		"go:       " + runtime.Version(),
		"platform: " + runtime.GOOS + "/" + runtime.GOARCH,
	} {
		if !strings.Contains(stdout.String(), want) {
			t.Errorf("eva version did not report %q, and said:\n%s", want, stdout.String())
		}
	}
}

func TestTheVersionVerbNeedsNoConfiguration(t *testing.T) {
	// The machine that asks what build this is, is usually the machine where
	// nothing else works. So this answers with the configuration pointed at a
	// file that is not there, which every other verb refuses.
	var stdout, stderr bytes.Buffer

	code := Main([]string{"version", "--config", t.TempDir() + "/absent.toml"},
		strings.NewReader(""), &stdout, &stderr)

	if code != ExitOK {
		t.Fatalf("eva version exited %d with a missing config, want %d: %s", code, ExitOK, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Errorf("eva version wrote to stderr: %s", stderr.String())
	}
}

func TestTheVersionVerbRefusesAnArgument(t *testing.T) {
	// The command line fails closed everywhere else, and this verb is not an
	// exception to it.
	var stdout, stderr bytes.Buffer

	code := Main([]string{"version", "extra"}, strings.NewReader(""), &stdout, &stderr)
	if code != ExitUsage {
		t.Fatalf("eva version extra exited %d, want %d", code, ExitUsage)
	}
	if !strings.Contains(stderr.String(), "extra") {
		t.Errorf("the refusal did not name the argument, and said:\n%s", stderr.String())
	}
}
