package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/theme"
)

type About struct {
	Version string
	Branch  string
	Dir     string
}

func (c *Console) masthead() string {
	if c.width <= 0 {
		return ""
	}

	facts := [][2]string{
		{"version", c.about.Version},
		{"model", c.model},
		{"branch", c.about.Branch},
		{"cwd", c.about.Dir},
	}

	lines := []string{
		c.styles.said.Render(name),
		c.styles.hint.Render(tagline),
		"",
	}
	for _, fact := range facts {
		if fact[1] == "" {
			continue
		}
		lines = append(lines, c.styles.hint.Render(fmt.Sprintf("%-8s", fact[0]))+" "+fact[1])
	}

	// The hint sits under the bar rather than inside it. The bar says "this
	// block is one thing"; where to go next is not part of that block, it is
	// what to do once you have read it.
	return c.bar(lines) + "\n\n" + c.styles.hint.Render(hint())
}

func hint() string {
	for _, c := range commands() {
		if c.name == "help" {
			return "type /" + c.name + " for slash commands"
		}
	}
	// No help to point at is a console with nothing to say about itself, which
	// is better said by saying nothing than by naming a command that is gone.
	return ""
}

// name and tagline are what the console opens saying. They are constants
// because they are the program's own words about itself, and a program whose
// name a file could change is a program a repository could rename on a screen.
const (
	name    = "EVA"
	tagline = "Evidence, not claims"
)

func (c *Console) bar(lines []string) string {
	shades := theme.Shades(c.look.Colors.Person, len(lines))

	out := make([]string, len(lines))
	for i, line := range lines {
		// A look that names no accent draws the bar in the terminal's own
		// foreground. Styling it with nothing is not the same as not styling it:
		// the first is a colour instruction with no colour in it.
		mark := barMark
		if shades[i] != nil {
			mark = lipgloss.NewStyle().Foreground(shades[i]).Render(barMark)
		}
		out[i] = mark + "  " + line
	}
	return strings.Join(out, "\n")
}

// barMark is the bar's own glyph: a half-width block, so the column reads as a
// bar rather than as a run of characters.
const barMark = "▎"
