// Package keymap is which keys do what.
package keymap

import (
	"fmt"
	"sort"
	"strings"
)

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
	// Palette lists the commands, filtered by what has been typed.
	Palette Action = "palette"
	// Editor writes the prompt in the editor a person uses for everything else.
	Editor Action = "editor"
	// HistoryBack and HistoryForward recall the prompts already sent.
	HistoryBack    Action = "history_back"
	HistoryForward Action = "history_forward"
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

func Actions() []Action {
	return []Action{
		Submit, Newline, Interrupt, Leave, Complete, Palette, Editor,
		HistoryBack, HistoryForward,
		ScrollUp, ScrollDown, PageUp, PageDown, Top, Follow,
	}
}

type Keymap struct {
	bound map[Action][]string
}

func Default() Keymap {
	return Keymap{bound: map[Action][]string{
		Submit:    {"enter"},
		Newline:   {"shift+enter", "alt+enter"},
		Interrupt: {"ctrl+c"},
		Leave:     {"ctrl+d"},
		Complete:  {"tab"},
		// ctrl+p rather than a function key, because it is what a person's hands
		// already do for a command list. It is a chord the prompt would otherwise
		// use to move the cursor up a line, and the up key still does that.
		Palette: {"ctrl+p"},
		// ctrl+o is free: the prompt binds nothing to it, and no terminal reports
		// it as something else.
		Editor:         {"ctrl+o"},
		HistoryBack:    {"up"},
		HistoryForward: {"down"},
		ScrollUp:       {"shift+up"},
		ScrollDown:     {"shift+down"},
		PageUp:         {"pgup"},
		PageDown:       {"pgdown"},
		Top:            {"ctrl+home"},
		Follow:         {"ctrl+end"},
	}}
}

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

func (k Keymap) Is(chord string, action Action) bool {
	got, bound := k.Action(chord)
	return bound && got == action
}

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
