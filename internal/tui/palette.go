package tui

import (
	"strings"

	"charm.land/lipgloss/v2"
)

// The command list: what a person may type, narrowed by what they have typed so
// far, and which of the matches is chosen.
type palette struct {
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

const paletteRows = 5

// paletteName is how wide the name column is, so that what each command does
// starts in the same place down the list.
const paletteName = 18

func (p *palette) show() {
	p.open = true
	p.at = 0
}

func (p *palette) hide() {
	p.open = false
	p.at = 0
}

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

func named(typed string) string {
	if name, _, hasArgument := strings.Cut(typed, " "); hasArgument {
		return name
	}
	return typed
}

func (p *palette) walk(by int, typed string) {
	matches := p.matches(typed)
	if len(matches) == 0 {
		return
	}
	p.at = (p.at + by + len(matches)) % len(matches)
}

func (p *palette) clamp(typed string) {
	if matches := p.matches(typed); len(matches) > 0 {
		p.at = min(p.at, len(matches)-1)
	}
}

// chosen is what the chosen command puts in the prompt, and reports false when
// the filter left nothing to choose.
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
