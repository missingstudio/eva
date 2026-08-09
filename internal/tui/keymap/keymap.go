// Package keymap is which keys do what.
//
// It holds no terminal. What it knows is the names of the things an interface
// can be asked to do and the chords that ask for them, so a console looks up an
// action rather than matching a string.
//
// # The invariant this package exists to hold
//
// A console is a prompt. Every binding must therefore be a chord or a named
// key, because a binding on a bare printable key is a character a person cannot
// type. That rule lived in a comment beside a switch, where it bound whoever
// read the comment. Here it is Parse's to enforce, so a keymap that would eat
// the letter j is a configuration error at startup rather than a console that
// silently will not say "just".
package keymap

import (
	"fmt"
	"sort"
	"strings"
)

// Action is something an interface can be asked to do.
//
// The set is closed and small. A frontend that grows an action adds one here,
// beside the others, so that what can be bound is a list a person can read
// rather than whatever the switch happened to match.
type Action string

const (
	// Submit sends what is typed.
	Submit Action = "submit"
	// Newline puts a line break in the prompt instead of sending it.
	Newline Action = "newline"
	// Interrupt stops the turn in flight and gives the prompt back. Pressed
	// with nothing running, it is how a person leaves.
	Interrupt Action = "interrupt"
	// Leave ends the session.
	Leave Action = "leave"
	// Complete finishes the command being typed.
	Complete Action = "complete"
	// ScrollUp and ScrollDown move the transcript by a line.
	ScrollUp   Action = "scroll_up"
	ScrollDown Action = "scroll_down"
	// PageUp and PageDown move it by a screen.
	PageUp   Action = "page_up"
	PageDown Action = "page_down"
	// Top and Follow go to the start of the transcript and back to the end.
	Top    Action = "top"
	Follow Action = "follow"
)

// Actions is every action that can be bound, in the order a person reads them.
func Actions() []Action {
	return []Action{
		Submit, Newline, Interrupt, Leave, Complete,
		ScrollUp, ScrollDown, PageUp, PageDown, Top, Follow,
	}
}

// Keymap is which chords ask for which action.
//
// One action may have several chords, because a terminal that cannot send
// shift+enter can usually send alt+enter, and a person should not have to know
// which of the two theirs is.
type Keymap struct {
	bound map[Action][]string
}

// Default is the complete Keymap: exactly the keys Eva answered to before any
// of this could be configured.
func Default() Keymap {
	return Keymap{bound: map[Action][]string{
		Submit:     {"enter"},
		Newline:    {"shift+enter", "alt+enter"},
		Interrupt:  {"ctrl+c"},
		Leave:      {"ctrl+d"},
		Complete:   {"tab"},
		ScrollUp:   {"shift+up"},
		ScrollDown: {"shift+down"},
		PageUp:     {"pgup"},
		PageDown:   {"pgdown"},
		Top:        {"ctrl+home"},
		Follow:     {"ctrl+end"},
	}}
}

// Parse builds a Keymap from what a person wrote, over the defaults.
//
// An action they did not name keeps its default binding, so a file that rebinds
// one key is a file with one line in it. An action they did name replaces its
// defaults entirely rather than adding to them — a person who writes a binding
// means that binding, and a rebind that quietly kept the old chord as well
// would be a rebind that did not.
func Parse(bindings map[string][]string) (Keymap, error) {
	known := map[Action]bool{}
	for _, action := range Actions() {
		known[action] = true
	}

	out := Default()
	for name, chords := range bindings {
		action := Action(name)
		if !known[action] {
			return Keymap{}, fmt.Errorf(
				"keymap: %q is not something Eva can be asked to do (it can be asked to: %s)",
				name, names())
		}
		if len(chords) == 0 {
			return Keymap{}, fmt.Errorf("keymap: %q is bound to no keys — remove the line to keep its default", name)
		}

		for _, chord := range chords {
			if err := usable(chord); err != nil {
				return Keymap{}, fmt.Errorf("keymap: %q: %w", name, err)
			}
		}
		out.bound[action] = append([]string(nil), chords...)
	}

	if err := out.distinct(); err != nil {
		return Keymap{}, err
	}
	return out, nil
}

// usable rejects a chord a prompt could not survive.
//
// A console is a prompt, so a binding on a bare printable key takes that
// character away from whoever is typing: bind j to scroll down and a person
// cannot write "just". Every binding must therefore carry a modifier or be a
// key that types nothing.
func usable(chord string) error {
	if chord == "" {
		return fmt.Errorf("a binding needs a key")
	}

	lower := strings.ToLower(chord)

	// A bare key is judged on what it costs the prompt before anything else,
	// because that is the answer whichever case it was written in: "J" and "j"
	// are the same character taken away from whoever is typing.
	if !strings.Contains(chord, "+") && !named[lower] {
		return fmt.Errorf(
			"%q is a key a person types, so binding it would take that character away from the prompt — "+
				"use a chord (ctrl+%s) or a named key (%s)", chord, lower, list(namedKeys()))
	}

	// A terminal reports a key in lower case, so an upper-case one never fires.
	// It would also replace the action's default, which makes a written
	// "Ctrl+C" an interrupt key that does nothing and no interrupt key at all —
	// a silence, from a package whose whole job is turning a bad binding into a
	// message.
	if chord != lower {
		return fmt.Errorf("%q is not how a terminal spells a key: write it in lower case (%s)", chord, lower)
	}

	if held, key, chorded := strings.Cut(chord, "+"); chorded {
		return holds(chord, held, key)
	}
	return nil
}

// holds checks a chord's two halves.
//
// A modifier this cannot name is one no terminal reports, and a chord with
// nothing after it is a modifier held on its own. Both were accepted before,
// because "contains a plus" was the whole of the test — so "a+b" and "ctrl+"
// bound an action to a key that could never arrive.
func holds(chord, held, key string) error {
	if held == "" {
		return fmt.Errorf("%q begins with a plus, so it names no modifier and no terminal reports it", chord)
	}
	for held != "" {
		var modifier string
		modifier, held, _ = strings.Cut(held, "+")
		if !modifiers[modifier] {
			return fmt.Errorf("%q is not a key a terminal reports: %q is not a modifier (they are: %s)",
				chord, modifier, list(modifierNames()))
		}
	}
	if key == "" {
		return fmt.Errorf("%q is a modifier held on its own, and a terminal reports no such key", chord)
	}
	if strings.Contains(key, "+") {
		// Cut took the first plus, so what is left holding another is a second
		// modifier in the wrong half — "ctrl+alt+x" reaches here as key
		// "alt+x", which is well formed and recursed into.
		modifier, rest, _ := strings.Cut(key, "+")
		return holds(chord, modifier, rest)
	}
	return nil
}

// modifiers are what a terminal can report as held.
var modifiers = func() map[string]bool {
	out := map[string]bool{}
	for _, m := range modifierNames() {
		out[m] = true
	}
	return out
}()

func modifierNames() []string { return []string{"alt", "ctrl", "meta", "shift", "super"} }

// named are the keys that type nothing, so binding one costs a person no
// character.
var named = func() map[string]bool {
	out := map[string]bool{}
	for _, key := range namedKeys() {
		out[key] = true
	}
	return out
}()

func namedKeys() []string {
	return []string{
		"backspace", "delete", "down", "end", "enter", "esc", "escape", "f1", "f2", "f3",
		"f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "home", "insert", "left",
		"pgdown", "pgup", "right", "tab", "up",
	}
}

// distinct refuses one chord bound to two actions.
//
// Which of the two happened would depend on the order a switch tested them,
// which is not something a person can read off their own configuration.
func (k Keymap) distinct() error {
	by := map[string]Action{}
	for _, action := range Actions() {
		for _, chord := range k.bound[action] {
			if first, taken := by[chord]; taken {
				return fmt.Errorf("keymap: %q is bound to both %q and %q, and only one of them could happen",
					chord, first, action)
			}
			by[chord] = action
		}
	}
	return nil
}

// Action names what a chord was bound to, and reports false for a chord that
// was not bound to anything.
func (k Keymap) Action(chord string) (Action, bool) {
	for _, action := range Actions() {
		for _, bound := range k.bound[action] {
			if bound == chord {
				return action, true
			}
		}
	}
	return "", false
}

// Is reports whether a chord asks for an action.
func (k Keymap) Is(chord string, action Action) bool {
	got, bound := k.Action(chord)
	return bound && got == action
}

// Chords is what an action is bound to, for a hint that has to name a key.
//
// A footer that said "ctrl+end to follow" while ctrl+end did nothing would be a
// help text and a behaviour that had drifted apart. Reading the binding is what
// stops that being possible.
func (k Keymap) Chords(action Action) []string {
	return append([]string(nil), k.bound[action]...)
}

// Chord is the first key an action is bound to, for a hint with room for one.
// It is empty for an action bound to nothing.
func (k Keymap) Chord(action Action) string {
	if bound := k.bound[action]; len(bound) > 0 {
		return bound[0]
	}
	return ""
}

func names() string {
	out := make([]string, 0, len(Actions()))
	for _, action := range Actions() {
		out = append(out, string(action))
	}
	sort.Strings(out)
	return list(out)
}

func list(parts []string) string { return strings.Join(parts, ", ") }
