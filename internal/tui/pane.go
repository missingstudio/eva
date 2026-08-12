package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// pane is the window onto the transcript: the rows it holds, and where in them a
// person is looking.
//
// It takes rows rather than a piece of text, and that is the whole reason it
// exists. A frame of a streaming turn hands over the same transcript with one
// block changed, and a pane that takes text has to be told the conversation
// again on every one of them — split it, and measure the display width of every
// line of it, to answer a question about the twenty rows it is about to draw.
// That cost is proportional to how long a person has been talking, and it is
// paid twelve times a second.
//
// So this measures nothing it is not drawing. Everything below is bounded by the
// height of the window: what it costs to draw a frame is what the window shows,
// and a conversation of an hour draws exactly as fast as its first turn.
//
// What it is not is a pager. It has no bindings, no highlighting, and no
// horizontal scrolling — the console has its own keys, the transcript is wrapped
// before it arrives, and a row that overruns the window is cut rather than
// scrolled sideways. Those absences are what keep this small enough to be worth
// owning.
type pane struct {
	// rows is the whole transcript, one entry per line. It is held by
	// reference: the console composes it from drawings that mostly already
	// existed, and copying it here would put back the cost this type is for.
	//
	// Nothing here writes to it. That is the contract with the console, and it
	// is what makes handing the slice over safe.
	rows []string

	// offset is the first row on screen. It is clamped by whatever changes what
	// it is a position in, so it is never a position past the end of a
	// transcript that shrank.
	offset int

	width  int
	height int

	// cut truncates a row to the window. It is held rather than built per row
	// because the width changes far less often than the pane draws.
	cut lipgloss.Style
}

// SetContent replaces what the pane holds.
//
// The slice is kept, not copied, and the caller must not write to it after this
// returns. Copying it would be a copy of the conversation per frame, which is
// what this type exists to stop.
//
// A person reading the end goes on reading the end: the offset is clamped, so a
// transcript that got shorter — /clear, a resize that reflowed every turn —
// leaves them at the new end rather than past it.
func (p *pane) SetContent(rows []string) {
	p.rows = rows
	p.clamp()
}

// SetWidth and SetHeight fit the pane to the window.
func (p *pane) SetWidth(width int) {
	if width == p.width {
		return
	}
	p.width = max(0, width)
	p.cut = lipgloss.NewStyle().MaxWidth(p.width)
}

func (p *pane) SetHeight(height int) {
	p.height = max(0, height)
	p.clamp()
}

// Height is how many rows the pane draws, which the console needs in order to
// say how much of the transcript is below what a person is looking at.
func (p *pane) Height() int { return p.height }

// TotalLineCount is how many rows the transcript holds.
func (p *pane) TotalLineCount() int { return len(p.rows) }

// YOffset is which row is at the top of the window.
func (p *pane) YOffset() int { return p.offset }

// SetYOffset moves the window, and cannot move it past either end.
func (p *pane) SetYOffset(offset int) {
	p.offset = offset
	p.clamp()
}

// AtBottom reports whether the last row is on screen.
//
// It is what the console asks before it redraws: a pane showing the end goes on
// showing the end, and a person who has scrolled back to read something is left
// where they are.
func (p *pane) AtBottom() bool { return p.offset >= p.bottom() }

// GotoTop and GotoBottom move to the ends.
func (p *pane) GotoTop()    { p.offset = 0 }
func (p *pane) GotoBottom() { p.offset = p.bottom() }

// PageUp and PageDown move by a window, less one row.
//
// The row of overlap is deliberate. A page that moved by exactly the height
// leaves a reader with no line in common between the two screens, which is the
// one thing a person needs in order to know they have not skipped anything.
func (p *pane) PageUp()   { p.ScrollUp(max(1, p.height-1)) }
func (p *pane) PageDown() { p.ScrollDown(max(1, p.height-1)) }

// ScrollUp and ScrollDown move by rows.
func (p *pane) ScrollUp(rows int)   { p.SetYOffset(p.offset - rows) }
func (p *pane) ScrollDown(rows int) { p.SetYOffset(p.offset + rows) }

// wheelRows is how far one notch of a wheel moves the transcript. Three, which
// is what a terminal's own pager does and therefore what a hand expects.
const wheelRows = 3

// wheel moves the pane for a turn of the mouse wheel.
//
// Only the wheel. Click and drag stay the terminal's, which is what leaves a
// person their own way of selecting text — see the mouse mode the view asks for.
func (p *pane) wheel(msg tea.MouseWheelMsg) {
	switch msg.Button {
	case tea.MouseWheelUp:
		p.ScrollUp(wheelRows)
	case tea.MouseWheelDown:
		p.ScrollDown(wheelRows)
	}
}

// View is the rows on screen, and nothing else measured.
//
// A row wider than the window is cut. The transcript is wrapped before it gets
// here, so the rows this happens to are the ones nothing wrapped: a prompt
// echoed back as one long line, or a working directory in the masthead. Cutting
// is the honest answer for those — the alternative is a frame that is wider than
// the window it is drawn in, which moves everything else on the screen.
//
// A row that fits is handed back untouched rather than re-rendered, because most
// rows fit and re-rendering one costs more than asking whether it needs it.
//
// The window is filled to its height. A pane that drew fewer rows than it was
// given would leave whatever the terminal had there before, and the chrome below
// it would move up the screen as the transcript got shorter.
func (p *pane) View() string {
	if p.width <= 0 || p.height <= 0 {
		return ""
	}

	rows := make([]string, 0, p.height)
	for _, row := range p.visible() {
		if lipgloss.Width(row) > p.width {
			row = p.cut.Render(row)
		}
		rows = append(rows, row)
	}
	for len(rows) < p.height {
		rows = append(rows, "")
	}
	return strings.Join(rows, "\n")
}

// visible is the rows the window is over.
func (p *pane) visible() []string {
	if len(p.rows) == 0 {
		return nil
	}
	top := min(p.offset, len(p.rows))
	return p.rows[top:min(top+p.height, len(p.rows))]
}

// bottom is the offset at which the last row is on screen.
//
// It is zero for a transcript shorter than the window, which is what makes such
// a transcript both at the top and at the bottom — as it is: there is one screen
// and a person is looking at it.
func (p *pane) bottom() int { return max(0, len(p.rows)-p.height) }

// clamp keeps the offset a position in what the pane actually holds.
func (p *pane) clamp() { p.offset = min(max(0, p.offset), p.bottom()) }
