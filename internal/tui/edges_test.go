package tui

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/theme"
)

// What a window affords is asked of the arithmetic rather than of a console.
//
// Before, the only way to ask what a forty-column window holds back was to build a
// console, give it a window, and read two fields back — so the cases nobody drew at
// were the cases nobody asked about.

// A window wide and tall enough holds back everything the look asks for.
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
//
// The margin decorates nothing; the padding is part of the interface, and it is
// what a background will fill. So the order is not a preference.
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

// Each axis decides on its own.
//
// A window can be wide enough for its columns and too short for its rows, and rows
// are the scarce dimension of a terminal. One decision for both would take the
// side edges away from a window that has plenty of them.
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

// An inset is taken whole or not at all.
//
// A window losing one column at a time would be an interface whose edges depended
// on a width nobody chose, and the left and right would not match.
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

// wide and tall are the sum the interface is drawn in less.
//
// They are asked for rather than added up at the call site, because the sum was
// written out in three places — and the interface came out wider than the terminal
// the one time it was written out wrong.
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
//
// Styling it with nothing is not the same as not styling it: the first pads every
// row to the width of the longest one, which for a frame that already fills the
// window is work with nothing to show for it.
func TestAFrameWithNoEdgesIsHandedBack(t *testing.T) {
	var e edges

	view := "one row\nand another"
	if got := e.frame(view); got != view {
		t.Errorf("a frame with no edges came back as %q", got)
	}
}

// The edges are held back on all four sides, and the right-hand ones too although
// only the left are visible.
//
// A right-hand pad is what makes every row the full width of the window. A row that
// stops short is a row whose remaining cells hold whatever the terminal had there
// before.
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
