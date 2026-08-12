package tui

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/theme"
)

// What a window affords is asked of the arithmetic rather than of a console.

func TestARoomyWindowHoldsBackWhatTheLookAsks(t *testing.T) {
	look := theme.Default(true)

	e := afford(look.Layout, 120, 40)
	if e.margin != look.Layout.Margin {
		t.Errorf("the margin is %+v, and the look asks for %+v", e.margin, look.Layout.Margin)
	}
	if e.padding != look.Layout.Padding {
		t.Errorf("the padding is %+v, and the look asks for %+v", e.padding, look.Layout.Padding)
	}
}

// A narrow window gives up the margin first, and the padding only if that was not
// enough.
func TestANarrowWindowGivesUpTheMarginBeforeThePadding(t *testing.T) {
	// A look that asks for both, so that the order is observable at all.
	look := theme.Layout{
		Margin:  theme.Space{Top: 1, Right: 2, Bottom: 1, Left: 2},
		Padding: theme.Space{Top: 1, Right: 1, Bottom: 1, Left: 1},
	}

	// Wide enough for the padding but not for both: the margin goes.
	e := afford(look, narrowest+2, 40)
	if e.margin.Left != 0 || e.margin.Right != 0 {
		t.Errorf("a window with room for one inset kept the margin: %+v", e.margin)
	}
	if e.padding.Left != 1 || e.padding.Right != 1 {
		t.Errorf("a window with room for the padding gave it up: %+v", e.padding)
	}

	// Not wide enough for either.
	e = afford(look, narrowest, 40)
	if e.wide() != 0 {
		t.Errorf("a window of %d columns held back %d of them", narrowest, e.wide())
	}
}

func TestEachAxisDecidesOnItsOwn(t *testing.T) {
	look := theme.Layout{
		Margin:  theme.Space{Top: 1, Right: 2, Bottom: 1, Left: 2},
		Padding: theme.Space{Top: 1, Right: 1, Bottom: 1, Left: 1},
	}

	// Wide, and too short.
	e := afford(look, 120, 4)
	if e.wide() == 0 {
		t.Error("a short window gave up the columns it had room for")
	}
	if e.tall() != 0 {
		t.Errorf("a window of 4 rows held back %d of them", e.tall())
	}

	// Tall, and too narrow.
	e = afford(look, 20, 40)
	if e.tall() == 0 {
		t.Error("a narrow window gave up the rows it had room for")
	}
	if e.wide() != 0 {
		t.Errorf("a window of 20 columns held back %d of them", e.wide())
	}
}

func TestAnInsetIsAllOrNothing(t *testing.T) {
	look := theme.Default(true).Layout

	for width := 1; width <= 60; width++ {
		e := afford(look, width, 40)
		if e.margin.Left != e.margin.Right {
			t.Errorf("a window of %d columns holds back %d at the left and %d at the right",
				width, e.margin.Left, e.margin.Right)
		}
		if e.padding.Left != e.padding.Right {
			t.Errorf("a window of %d columns pads %d at the left and %d at the right",
				width, e.padding.Left, e.padding.Right)
		}
		// Every inset is either what the look asked for or nothing.
		if e.margin.Left != 0 && e.margin.Left != look.Margin.Left {
			t.Errorf("a window of %d columns invented a margin of %d", width, e.margin.Left)
		}
		if e.padding.Left != 0 && e.padding.Left != look.Padding.Left {
			t.Errorf("a window of %d columns invented a padding of %d", width, e.padding.Left)
		}
	}
}

func TestTheInsetsSumToWhatTheInterfaceGivesUp(t *testing.T) {
	e := edges{
		margin:  theme.Space{Top: 1, Right: 2, Bottom: 3, Left: 4},
		padding: theme.Space{Top: 5, Right: 6, Bottom: 7, Left: 8},
	}

	if got := e.wide(); got != 2+4+6+8 {
		t.Errorf("wide() is %d, want the four side insets summed", got)
	}
	if got := e.tall(); got != 1+3+5+7 {
		t.Errorf("tall() is %d, want the four top and bottom insets summed", got)
	}
}

// A frame with no edges is handed back as it was.
func TestAFrameWithNoEdgesIsHandedBack(t *testing.T) {
	var e edges

	view := "one row\nand another"
	if got := e.frame(view); got != view {
		t.Errorf("a frame with no edges came back as %q", got)
	}
}

// The edges are held back on all four sides, and the right-hand ones too although
// only the left are visible.
func TestTheFrameHoldsBackAllFourSides(t *testing.T) {
	e := edges{
		margin:  theme.Space{Top: 1, Right: 1, Bottom: 1, Left: 1},
		padding: theme.Space{Top: 0, Right: 1, Bottom: 0, Left: 1},
	}

	rows := strings.Split(e.frame("a row"), "\n")

	// One row above and one below, from the margin's top and bottom.
	if len(rows) != 3 {
		t.Fatalf("the frame is %d rows, want the row plus one held back at each end:\n%q", len(rows), rows)
	}
	if strings.TrimSpace(rows[0]) != "" || strings.TrimSpace(rows[2]) != "" {
		t.Errorf("the rows held back at the ends are not empty:\n%q", rows)
	}

	// Two columns at the left: one of margin, one of padding.
	if !strings.HasPrefix(rows[1], "  a row") {
		t.Errorf("the row is not held back two columns at the left:\n%q", rows[1])
	}
	// And the same at the right, so every row is the same width.
	if got := lipgloss.Width(rows[1]); got != len("a row")+4 {
		t.Errorf("the row is %d columns wide, want the text plus two at each side:\n%q", got, rows[1])
	}
	for i, row := range rows {
		if got := lipgloss.Width(row); got != lipgloss.Width(rows[1]) {
			t.Errorf("row %d is %d columns and row 1 is %d, so the frame is ragged",
				i, got, lipgloss.Width(rows[1]))
		}
	}
}
