package tui

import (
	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/theme"
)

type edges struct {
	margin  theme.Space
	padding theme.Space
}

// narrowest and shortest are the least the interface will draw in before it stops
// holding cells back at its edges.
const (
	narrowest = 40
	shortest  = 6
)

func afford(layout theme.Layout, width, height int) edges {
	e := edges{margin: layout.Margin, padding: layout.Padding}

	if width-e.margin.Left-e.margin.Right-e.padding.Left-e.padding.Right < narrowest {
		e.margin.Left, e.margin.Right = 0, 0
		if width-e.padding.Left-e.padding.Right < narrowest {
			e.padding.Left, e.padding.Right = 0, 0
		}
	}

	if height-e.margin.Top-e.margin.Bottom-e.padding.Top-e.padding.Bottom < shortest {
		e.margin.Top, e.margin.Bottom = 0, 0
		if height-e.padding.Top-e.padding.Bottom < shortest {
			e.padding.Top, e.padding.Bottom = 0, 0
		}
	}
	return e
}

// wide and tall are how many columns and rows these edges take, which is what the
// interface is drawn in less.
func (e edges) wide() int { return e.margin.Left + e.margin.Right + e.padding.Left + e.padding.Right }
func (e edges) tall() int { return e.margin.Top + e.margin.Bottom + e.padding.Top + e.padding.Bottom }

func (e edges) frame(view string) string {
	// Inside first, then outside, which is what makes them two things rather than
	// one sum. The inner one is where a background will go, and it will stop
	// exactly where the outer one begins.
	if held(e.padding) {
		view = pad(e.padding).Render(view)
	}
	if held(e.margin) {
		view = pad(e.margin).Render(view)
	}
	return view
}

func pad(s theme.Space) lipgloss.Style {
	return lipgloss.NewStyle().Padding(s.Top, s.Right, s.Bottom, s.Left)
}

// held reports whether anything is held back at all, so that a frame with no edges
// is handed back rather than drawn through a style that would change nothing.
func held(s theme.Space) bool { return s.Top|s.Right|s.Bottom|s.Left != 0 }
