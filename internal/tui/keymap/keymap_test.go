package keymap_test

import (
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/tui/keymap"
)

// A console is a prompt, so a binding on a bare printable key takes that
// character away from whoever is typing. Bind j to scroll down and a person
// cannot write "just".
//
// This is the rule this package exists to hold. It lived in a comment beside a
// switch, where it bound whoever read the comment.
func TestABarePrintableKeyIsRefused(t *testing.T) {
	for _, chord := range []string{"j", "k", "q", " ", "/", "1", "J"} {
		t.Run(chord, func(t *testing.T) {
			_, err := keymap.Parse(map[string][]string{"scroll_down": {chord}})
			if err == nil {
				t.Fatalf("binding %q was allowed, and it is a character a person types", chord)
			}
			if !strings.Contains(err.Error(), "prompt") {
				t.Errorf("the refusal does not say what it costs the prompt: %v", err)
			}
		})
	}
}

// A chord and a key that types nothing are both fine, because neither costs a
// person a character.
func TestAChordOrANamedKeyIsAccepted(t *testing.T) {
	for _, chord := range []string{"ctrl+j", "alt+k", "shift+left", "home", "f5", "esc", "insert"} {
		t.Run(chord, func(t *testing.T) {
			keys, err := keymap.Parse(map[string][]string{"scroll_down": {chord}})
			if err != nil {
				t.Fatalf("binding %q was refused: %v", chord, err)
			}
			if !keys.Is(chord, keymap.ScrollDown) {
				t.Errorf("%q does not scroll down after being bound to it", chord)
			}
		})
	}
}

// An action a person did not name keeps its default, so a file that rebinds one
// key is a file with one line in it.
func TestAnUnnamedActionKeepsItsDefault(t *testing.T) {
	keys, err := keymap.Parse(map[string][]string{"follow": {"ctrl+g"}})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if !keys.Is("ctrl+g", keymap.Follow) {
		t.Error("the rebound chord does not follow")
	}
	if !keys.Is("enter", keymap.Submit) {
		t.Error("enter stopped sending, and nobody asked it to")
	}
	if !keys.Is("ctrl+c", keymap.Interrupt) {
		t.Error("ctrl+c stopped interrupting, and nobody asked it to")
	}
}

// A person who writes a binding means that binding. A rebind that quietly kept
// the old chord as well would be a rebind that did not.
func TestARebindReplacesTheDefaultRatherThanAddingToIt(t *testing.T) {
	keys, err := keymap.Parse(map[string][]string{"follow": {"ctrl+g"}})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if _, bound := keys.Action("ctrl+end"); bound {
		t.Error("the default chord still follows after being replaced")
	}
}

// One chord cannot ask for two things: which happened would depend on the order
// a switch tested them, and that is not something a person can read off their
// own configuration.
func TestOneChordBoundToTwoActionsIsRefused(t *testing.T) {
	_, err := keymap.Parse(map[string][]string{
		"follow": {"ctrl+g"},
		"top":    {"ctrl+g"},
	})
	if err == nil {
		t.Fatal("one chord was bound to two actions")
	}
	for _, want := range []string{"ctrl+g", "follow", "top"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal does not name %q: %v", want, err)
		}
	}
}

// An action Eva does not have is refused by name, and the message says what it
// does have — a typo is the likely cause and a list is what answers it.
func TestAnUnknownActionIsRefusedByName(t *testing.T) {
	_, err := keymap.Parse(map[string][]string{"scrolldown": {"ctrl+j"}})
	if err == nil {
		t.Fatal("an action Eva does not have was accepted")
	}
	if !strings.Contains(err.Error(), "scrolldown") {
		t.Errorf("the refusal does not name what was written: %v", err)
	}
	if !strings.Contains(err.Error(), string(keymap.ScrollDown)) {
		t.Errorf("the refusal does not offer the action that was meant: %v", err)
	}
}

// An action bound to nothing is a mistake rather than an instruction. A person
// who wants the default leaves the line out.
func TestAnActionBoundToNothingIsRefused(t *testing.T) {
	if _, err := keymap.Parse(map[string][]string{"follow": {}}); err == nil {
		t.Fatal("an action was bound to no keys at all")
	}
}

// The defaults are what Eva answered to before any of this could be configured.
func TestTheDefaultsAreTheKeysEvaAlwaysAnsweredTo(t *testing.T) {
	keys := keymap.Default()

	for chord, want := range map[string]keymap.Action{
		"enter":       keymap.Submit,
		"shift+enter": keymap.Newline,
		"alt+enter":   keymap.Newline,
		"ctrl+c":      keymap.Interrupt,
		"ctrl+d":      keymap.Leave,
		"tab":         keymap.Complete,
		"pgup":        keymap.PageUp,
		"pgdown":      keymap.PageDown,
		"shift+up":    keymap.ScrollUp,
		"shift+down":  keymap.ScrollDown,
		"ctrl+home":   keymap.Top,
		"ctrl+end":    keymap.Follow,
	} {
		if !keys.Is(chord, want) {
			got, _ := keys.Action(chord)
			t.Errorf("%q asks for %q, want %q", chord, got, want)
		}
	}
}

// Every default binding obeys the rule the package enforces on a person's.
func TestNoDefaultBindingStealsAPromptCharacter(t *testing.T) {
	keys := keymap.Default()
	for _, action := range keymap.Actions() {
		for _, chord := range keys.Chords(action) {
			if _, err := keymap.Parse(map[string][]string{string(action): {chord}}); err != nil {
				t.Errorf("the default binding for %q would be refused from a file: %v", action, err)
			}
		}
	}
}

// Every action has a binding. An action Eva can be asked to do that no key asks
// for is an action nobody can reach.
func TestEveryActionIsBound(t *testing.T) {
	keys := keymap.Default()
	for _, action := range keymap.Actions() {
		if len(keys.Chords(action)) == 0 {
			t.Errorf("%q is bound to no key, so nothing can ask for it", action)
		}
	}
}
