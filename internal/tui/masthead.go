package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/theme"
)

// About is what a console can say about the run behind it before anyone has
// asked anything.
//
// It is told rather than discovered, for the reason everything else here is: a
// frontend that read a version out of a build, a branch out of a repository, or
// a directory out of the process would be a frontend reaching the outside
// world, and what it may reach is a list a reader can finish. Every field is
// optional, and a field nobody filled is a line the masthead does not draw.
type About struct {
	// Version is the build a person is talking to.
	Version string
	// Branch is the branch of the repository the run is standing in, and is
	// empty outside one.
	Branch string
	// Dir is the working directory, already shortened for reading.
	Dir string
}

// masthead is what a console opens with: what it is, and the four facts a
// person checks before they trust an answer.
//
// It is drawn once, at the top of the transcript, and scrolls away with it. A
// banner fixed to the screen would spend four rows of every window on
// information that stops being news after the first turn — and one printed and
// forgotten could not be redrawn when the window changed width.
//
// # Why this does not make the pane a second account
//
// ADR 0023 caps the pane's writers at three, each downstream of a commit or of
// a person's own keystroke, so that the pane cannot claim a turn the Trace does
// not hold. This is a fourth, and it is not that kind of writer: it is composed
// from a version, a branch, a directory, and a model name, and there is no
// arrangement of those that says anything about a turn. It cannot invent one
// because it cannot mention one.
func (c *Console) masthead() string {
	if c.width <= 0 {
		return ""
	}

	facts := [][2]string{
		{"version", c.about.Version},
		{"model", c.control.Model()},
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

// hint is the one line that tells a person there is more than a prompt here.
//
// It names the command by reading the table the console dispatches on, so a
// command that is renamed renames itself here too. A hint that named a command
// Eva no longer answers to would be the first thing a person tried and the
// first thing that failed them.
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

// bar draws the accent down the left of the masthead, one shade per row.
//
// It is a gradient rather than a rule because a rule is a border and this is
// not a box: what the bar says is "this block is one thing, and it starts
// here". The shades come from the accent a person chose, so the masthead is
// their colour without them naming a second one.
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
