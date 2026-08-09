package tui

import (
	"strings"
	"testing"
)

// /help lists what a person can type.
//
// It is asserted against the command table rather than against a list written
// here, so a command added without a line in /help fails this rather than
// shipping undiscoverable.
//
// It needs no program and no terminal: /help is the table rendered as text, and
// that relation is the whole of what this checks. A zero Console is enough,
// because a style nobody set renders the words and nothing around them — which
// is what a test wants to read anyway. That a command opens no Run is a
// different claim, and it is asserted where the assembly is.
func TestHelpListsEveryCommand(t *testing.T) {
	said := new(Console).help("")

	for _, cmd := range commands() {
		if !strings.Contains(said, "/"+cmd.name) {
			t.Errorf("/help does not list /%s:\n%s", cmd.name, said)
		}
		if !strings.Contains(said, cmd.about) {
			t.Errorf("/help lists /%s with nothing to say what it does:\n%s", cmd.name, said)
		}
	}
}

// A command nobody has is answered rather than sent to the model.
//
// The console answers it, so a typo costs nothing: forwarded to a provider it
// would cost money and come back as a guess at what was meant.
func TestAnUnknownCommandNamesItself(t *testing.T) {
	said := new(Console).obey("/nonsense")

	if !strings.Contains(said, "/nonsense") {
		t.Errorf("the answer does not name the command that was typed:\n%s", said)
	}
	if !strings.Contains(said, "/help") {
		t.Errorf("the answer does not say where the commands are listed:\n%s", said)
	}
}
