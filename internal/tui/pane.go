package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

type pane struct {
	// rows is the whole transcript, one entry per line. It is held by
	// reference: the console composes it from drawings that mostly already
	// existed, and copying it here would put back the cost this type is for.
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

func (p *pane) SetContent(rows []string) {
	p.rows = rows
	p.clamp()
}

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

func (p *pane) Height() int { return p.height }

func (p *pane) TotalLineCount() int { return len(p.rows) }

func (p *pane) YOffset() int { return p.offset }

// SetYOffset moves the window, and cannot move it past either end.
func (p *pane) SetYOffset(offset int) {
	p.offset = offset
	p.clamp()
}

func (p *pane) AtBottom() bool { return p.offset >= p.bottom() }

func (p *pane) GotoTop()    { p.offset = 0 }
func (p *pane) GotoBottom() { p.offset = p.bottom() }

func (p *pane) PageUp()   { p.ScrollUp(max(1, p.height-1)) }
func (p *pane) PageDown() { p.ScrollDown(max(1, p.height-1)) }

func (p *pane) ScrollUp(rows int)   { p.SetYOffset(p.offset - rows) }
func (p *pane) ScrollDown(rows int) { p.SetYOffset(p.offset + rows) }

// wheelRows is how far one notch of a wheel moves the transcript. Three, which
// is what a terminal's own pager does and therefore what a hand expects.
const wheelRows = 3

func (p *pane) wheel(msg tea.MouseWheelMsg) {
	switch msg.Button {
	case tea.MouseWheelUp:
		p.ScrollUp(wheelRows)
	case tea.MouseWheelDown:
		p.ScrollDown(wheelRows)
	}
}

// View is the rows on screen, and nothing else measured.
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

func (p *pane) visible() []string {
	if len(p.rows) == 0 {
		return nil
	}
	top := min(p.offset, len(p.rows))
	return p.rows[top:min(top+p.height, len(p.rows))]
}

func (p *pane) bottom() int { return max(0, len(p.rows)-p.height) }

func (p *pane) clamp() { p.offset = min(max(0, p.offset), p.bottom()) }
