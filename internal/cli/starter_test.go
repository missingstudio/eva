package cli

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/config"
)

// setting matches a commented-out setting, so a test can turn the whole
// starter on at once.
var setting = regexp.MustCompile(`(?m)^# ([a-z_]+ +=)`)

// Every setting the starter documents is one Eva actually has.
//
// Decoding is strict, so a key that does not exist is an error naming the key —
// which means a starter file that documented a setting Eva had renamed would
// hand a person a file that fails the moment they uncomment the line it was
// written to teach them. Uncommenting all of it and loading it is the only
// assertion that covers every line.
func TestEverySettingTheStarterDocumentsIsReal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	t.Setenv(config.EnvHome, dir)
	t.Setenv(config.EnvConfig, "")

	live := setting.ReplaceAllString(starter(), "$1")
	if err := os.WriteFile(path, []byte(live), 0o600); err != nil {
		t.Fatalf("write the uncommented starter: %v", err)
	}

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("the starter does not load with every setting turned on: %v", err)
	}

	// And what it turned on is what it said it would.
	if cfg.Model != config.DefaultModel {
		t.Errorf("model = %q, want the default the starter names", cfg.Model)
	}
	if cfg.Provider.Name != config.DefaultProvider {
		t.Errorf("provider = %q, want the default the starter names", cfg.Provider.Name)
	}

	// The look and the keys it documents have to build, not just decode.
	if _, _, err := appearance(cfg); err != nil {
		t.Errorf("the look and keys the starter documents do not build: %v", err)
	}
}

// A starter that chose things on a person's behalf would pin them to today's
// defaults through every release after, with nothing to say it had.
func TestTheStarterChoosesNothing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	t.Setenv(config.EnvHome, dir)
	t.Setenv(config.EnvConfig, "")

	if err := os.WriteFile(path, []byte(starter()), 0o600); err != nil {
		t.Fatalf("write the starter: %v", err)
	}

	fromFile, err := config.Load(path)
	if err != nil {
		t.Fatalf("the starter does not load: %v", err)
	}

	empty := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatalf("write an empty configuration: %v", err)
	}
	fromNothing, err := config.Load(empty)
	if err != nil {
		t.Fatalf("an empty configuration does not load: %v", err)
	}

	// Path differs by construction; nothing else may. The keymap holds a map,
	// so the comparison is on what each field resolves to rather than on the
	// struct as a whole.
	fromFile.Path, fromNothing.Path = "", ""
	if fromFile.Model != fromNothing.Model {
		t.Errorf("model = %q from the starter and %q from no file", fromFile.Model, fromNothing.Model)
	}
	if fromFile.Provider != fromNothing.Provider {
		t.Errorf("provider = %+v from the starter and %+v from no file", fromFile.Provider, fromNothing.Provider)
	}
	if fromFile.Trace != fromNothing.Trace {
		t.Errorf("trace = %+v from the starter and %+v from no file", fromFile.Trace, fromNothing.Trace)
	}
	if fromFile.Identity != fromNothing.Identity {
		t.Errorf("identity = %+v from the starter and %+v from no file", fromFile.Identity, fromNothing.Identity)
	}
	if fromFile.Theme != fromNothing.Theme {
		t.Errorf("theme = %+v from the starter and %+v from no file", fromFile.Theme, fromNothing.Theme)
	}
	if len(fromFile.Keys.Bind) != 0 {
		t.Errorf("the starter bound %d keys, and it should bind none", len(fromFile.Keys.Bind))
	}
}

// The starter names what this build ships, read from the registries rather
// than written out, so it cannot offer a Provider that is not there.
func TestTheStarterNamesWhatThisBuildShips(t *testing.T) {
	got := starter()
	for _, want := range []string{"anthropic", "fake", "jsonl"} {
		if !strings.Contains(got, want) {
			t.Errorf("the starter does not name %q, which this build ships", want)
		}
	}
}
