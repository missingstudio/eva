package tui

import (
	"strings"

	"charm.land/lipgloss/v2"
)

// The command list: what a person may type, narrowed by what they have typed so
// far, and which of the matches is chosen.
//
// Completion cycles: a person presses tab and one name appears, presses it again
// and the next one does. That is enough when you know what you are looking for
// and nothing at all when you do not — the commands were discoverable only by
// typing a command to list them.
//
// So the list is on screen while a person picks from it, filtered by whatever
// they have typed. It is a piece of chrome rather than a block in the transcript,
// because it is a thing being used rather than a thing that happened: it takes no
// place in the record, and it is gone the moment it is used.
//
// # Why the table lives behind this
//
// Three things read the command table and each one filters it: this list, tab
// completion, and /help. The filter was written four times, and each copy had its
// own answer to the same question — what has been typed of a command name, given
// that a person may have moved on to an argument. A command that was completable
// and unlistable was a change away.
//
// So the filter is here, once, and the list and completion are the same module:
// they are two ways of choosing from one table, and they share the only rule that
// is easy to get wrong. What crosses in is the typed text, which is why nothing
// here reaches a prompt — the list can be driven with a string.
type palette struct {
	// open is whether the list is on screen.
	open bool
	// at is which of the matches is chosen, and is clamped to them whenever they
	// change — a person narrowing a filter must not be left pointing past the end
	// of what is left.
	at int

	// completing is what had been typed before tab began filling it in, and
	// completed is how far through the matches that is. Both are held because a
	// second tab has to offer the next match rather than start again from what the
	// first one wrote.
	completing string
	completed  int
}

// paletteRows is how many matches the list shows at once.
//
// Five, because the list is drawn above the prompt and every row of it is a row
// the answer does not get. There are not many commands; a person whose filter
// leaves more than five matches has typed almost nothing.
const paletteRows = 5

// paletteName is how wide the name column is, so that what each command does
// starts in the same place down the list.
const paletteName = 18

// show puts the list on screen, and hide takes it away.
//
// Both reset the chosen row. A list reopened on the row somebody left it on would
// be a list whose first key does something they cannot predict.
func (p *palette) show() {
	p.open = true
	p.at = 0
}

func (p *palette) hide() {
	p.open = false
	p.at = 0
}

// matches are the commands the filter leaves, and the filter is whatever has been
// typed after the slash.
//
// It reads the same table /help reads. A command cannot be in one and missing
// from another, which is the whole reason that table is a table.
func (p *palette) matches(typed string) []command {
	prefix := strings.TrimPrefix(named(typed), "/")

	out := make([]command, 0, len(commands()))
	for _, cmd := range commands() {
		if strings.HasPrefix(cmd.name, prefix) {
			out = append(out, cmd)
		}
	}
	return out
}

// named is what has been typed of a command name, and is empty once a person has
// moved on to an argument.
//
// It is one function because it was four, and the four did not agree: a list
// filtered on the whole line and a completion that read only the first word are
// two different answers to what a person is choosing from.
func named(typed string) string {
	if name, _, hasArgument := strings.Cut(typed, " "); hasArgument {
		return name
	}
	return typed
}

// walk moves the chosen row by one, and wraps.
//
// Wrapping rather than stopping, because the list is short: a person at the end
// of five names who presses down again means the first one, and there is nothing
// else it could mean.
func (p *palette) walk(by int, typed string) {
	matches := p.matches(typed)
	if len(matches) == 0 {
		return
	}
	p.at = (p.at + by + len(matches)) % len(matches)
}

// clamp keeps the chosen row a row that exists.
//
// It is called when the filter narrows, which is the one thing that can leave
// fewer matches than the row a person was on.
func (p *palette) clamp(typed string) {
	if matches := p.matches(typed); len(matches) > 0 {
		p.at = min(p.at, len(matches)-1)
	}
}

// chosen is what the chosen command puts in the prompt, and reports false when
// the filter left nothing to choose.
//
// It is the name and a space rather than the command run. A command may take an
// argument, and a list that sent /model the moment it was chosen would make the
// one command that takes one unusable from the list.
func (p *palette) chosen(typed string) (string, bool) {
	matches := p.matches(typed)
	if len(matches) == 0 {
		return "", false
	}
	return "/" + matches[p.at].name + " ", true
}

// fill completes a command name from however much of it has been typed, and
// offers the next match each time it is asked again. It reports false when there
// is nothing to fill in.
//
// It reads the same table the list reads, so a command cannot be completable and
// unlistable, or listable and not completable.
//
// Cycling rather than listing: what a list would need is a place to go — the
// transcript, which is for what was answered, or the status line, which is for
// what a turn is doing. The list above the prompt is that place now, and this is
// what a person reaches for when they already know the name.
func (p *palette) fill(typed string) (string, bool) {
	if p.completing == "" {
		// A slash and nothing but a name so far. Once there is a space the person
		// is writing an argument, and no table here knows what a model is called.
		if !strings.HasPrefix(typed, "/") || strings.ContainsAny(typed, " \n") {
			return "", false
		}
		p.completing = typed
		p.completed = -1
	}

	matches := p.matches(p.completing)
	if len(matches) == 0 {
		p.completing = ""
		return "", false
	}

	p.completed = (p.completed + 1) % len(matches)
	return "/" + matches[p.completed].name + " ", true
}

// typing says the person is writing again rather than choosing, so the next tab
// starts from what is there rather than from where the last one had got to.
func (p *palette) typing() { p.completing = "" }

// view draws the command list, and is empty when it is closed.
//
// The chosen row carries the person's own accent, which is the colour this
// interface already uses to mean "this is yours". Everything else is subdued: a
// list of things you might do is not a thing you are reading.
//
// The styles and the prompt's glyph are handed in. This module knows what the
// list says and not what the interface looks like, which is what lets a test read
// the list without building one.
func (p *palette) view(typed string, s styles, glyph string) string {
	if !p.open {
		return ""
	}

	matches := p.matches(typed)
	if len(matches) == 0 {
		return s.hint.Render("no command starts with " + named(typed))
	}

	shown := matches
	if len(shown) > paletteRows {
		// A window onto the matches, holding the chosen one. It slides rather than
		// starting again at the top, so a person walking down a long list sees the
		// next name arrive rather than the list jumping under them.
		from := min(max(0, p.at-paletteRows+1), len(shown)-paletteRows)
		shown = shown[from : from+paletteRows]
	}

	// A blank row above, so the list is not read as another block of the
	// transcript. It is a different kind of thing — something being used rather
	// than something that happened — and the gap is what says so.
	lines := make([]string, 0, len(shown)+1)
	lines = append(lines, "")

	for _, cmd := range shown {
		typed := "/" + cmd.name
		if cmd.argument != "" {
			typed += " " + cmd.argument
		}

		line := lipgloss.NewStyle().Width(paletteName).Render(typed) + cmd.about
		if cmd.name == matches[p.at].name {
			// The prompt's own glyph marks the chosen one, because that is what
			// choosing does: the command goes into the prompt. It is not the
			// gutter's mark — that says whose a block of the transcript is, and a
			// list of commands is nobody's.
			lines = append(lines, s.person.Render(glyph)+s.said.Render(line))
			continue
		}
		lines = append(lines, strings.Repeat(" ", lipgloss.Width(glyph))+s.hint.Render(line))
	}
	return strings.Join(lines, "\n")
}
