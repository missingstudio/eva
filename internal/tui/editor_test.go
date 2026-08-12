package tui

import (
	"os"
	"strings"
	"testing"
)

// A machine that names no editor is told so, rather than having something guessed
// at started on its terminal.
func TestNoEditorIsSaidRatherThanGuessedAt(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)

	if cmd := c.openEditor(); cmd != nil {
		t.Error("a machine with no editor was asked to run one anyway")
	}
	if got := plain(c.kept()); !strings.Contains(got, "EDITOR") {
		t.Errorf("the console did not say how to name an editor:\n%s", got)
	}
}

func TestThePromptGoesThroughTheEditorAndComesBack(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)

	c.input.SetValue("what I had already written")
	if cmd := c.edit(Editor{Command: "true"}, c.input.Value()); cmd == nil {
		t.Fatal("an editor that exists was not run")
	}

	// The file the editor would have been given. Found rather than returned,
	// because what the console hands the library is a command and not a path.
	path := onlyPromptFile(t)
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the file the editor was given: %v", err)
	}
	if got := string(written); got != "what I had already written" {
		t.Errorf("the editor was given %q, want what was in the prompt", got)
	}

	if err := os.WriteFile(path, []byte("what I wrote instead"), 0o600); err != nil {
		t.Fatalf("stand in for the editor: %v", err)
	}
	c.wrote(edited{path: path})

	if got := c.input.Value(); got != "what I wrote instead" {
		t.Errorf("the prompt holds %q after the editor saved", got)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("the file outlived the keystroke that made it, and a prompt can hold anything a person pasted")
	}
}

func TestAnEditorThatFailedLeavesThePromptAlone(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)
	c.input.SetValue("what I had already written")

	c.wrote(edited{path: "/nonexistent/eva-prompt.md", err: os.ErrNotExist})

	if got := c.input.Value(); got != "what I had already written" {
		t.Errorf("the prompt holds %q after the editor failed", got)
	}
	if got := plain(c.kept()); !strings.Contains(got, "eva:") {
		t.Errorf("the console said nothing about an editor that failed:\n%s", got)
	}
}

// onlyPromptFile is the one prompt file in the temporary directory, and fails when
// there is not exactly one.
func onlyPromptFile(t *testing.T) string {
	t.Helper()

	prefix, suffix, _ := strings.Cut(promptFile, "*")
	entries, err := os.ReadDir(os.TempDir())
	if err != nil {
		t.Fatalf("read the temporary directory: %v", err)
	}

	var found []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, suffix) {
			found = append(found, name)
		}
	}
	if len(found) != 1 {
		t.Fatalf("%d prompt files in %s, want exactly the one this test made: %v", len(found), os.TempDir(), found)
	}
	return os.TempDir() + string(os.PathSeparator) + found[0]
}
