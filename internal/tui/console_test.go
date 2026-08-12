package tui

import (
	"bytes"
	"context"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

// These tests draw the interface and read what it drew. Nothing here runs a
// turn: what a turn does is asserted where the assembly is, and what is left
// for this package is the part a person looks at.

// fixed is a Control that never answers. It is what the console draws against
// when the drawing is the whole of the question — which is the seam Control
// exists for: a frontend needs a model's name and nothing behind it.
type fixed struct {
	model string
	// remedy is what this machine would have checked, for the tests that ask
	// what the console does with one. The zero value is a machine nothing could
	// be established about, which is what most failures leave behind.
	remedy render.Remedy
	editor Editor
}

var _ Control = (*fixed)(nil)

func (f *fixed) Answer(context.Context, string) (core.Outcome, error) {
	return core.Outcome{}, nil
}
func (f *fixed) Watch(core.Subscriber, func(string)) {}
func (f *fixed) About() About                        { return About{} }
func (f *fixed) Remedy(events.ErrorClass) render.Remedy {
	return f.remedy
}
func (f *fixed) Editor() Editor        { return f.editor }
func (f *fixed) Model() string         { return f.model }
func (f *fixed) UseModel(model string) { f.model = model }
func (f *fixed) Clear()                {}

// escapes matches any terminal escape sequence, so that a test can assert on
// the words a person reads rather than on the bytes that place them.
var escapes = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)

func plain(s string) string { return escapes.ReplaceAllString(s, "") }

func TestTheFooterPutsTheModelAtTheFarEnd(t *testing.T) {
	// A whole console, because the footer now reads what the Session has spent
	// and the fold is what knows.
	c := drawn(t)
	c.control = &fixed{model: "claude-sonnet-4-5"}
	c.layout(40, 12)

	got := plain(c.footer())
	if !strings.HasSuffix(got, "claude-sonnet-4-5") {
		t.Errorf("the footer does not end with the model:\n%q", got)
	}
	if !strings.HasPrefix(got, "ready") {
		t.Errorf("the row does not begin with what is happening:\n%q", got)
	}
	if w := lipgloss.Width(got); w != 40 {
		t.Errorf("the footer is %d columns wide, want the window's 40:\n%q", w, got)
	}
}

// A window that has not said how wide it is has no far end to put anything at,
// and a model too long for the window would push the line onto a second row —
// which would move the prompt every time the name changed.
func TestTheFooterKeepsQuietWhenItHasNoRoom(t *testing.T) {
	for _, c := range []struct {
		name  string
		width int
	}{
		{name: "the window has not reported a width", width: 0},
		{name: "the model is wider than the window", width: 6},
	} {
		t.Run(c.name, func(t *testing.T) {
			console := &Console{control: &fixed{model: "claude-sonnet-4-5"}, width: c.width, styles: newStyles(theme.Default(true))}
			if got := console.footer(); got != "" {
				t.Errorf("the footer drew %q, want nothing", got)
			}
		})
	}
}

func TestTheStatusLineSaysHowLongTheTurnHasRun(t *testing.T) {
	c := &Console{
		styles: newStyles(theme.Default(true)),
		spin:   spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		since:  time.Now().Add(-3 * time.Second),
	}
	// A Run in flight is one with something to cancel. See shown.busy.
	c.shown.hold(func() {})

	got := plain(c.status())
	for _, want := range []string{"3s", "ctrl+c to interrupt"} {
		if !strings.Contains(got, want) {
			t.Errorf("the status line does not say %q:\n%s", want, got)
		}
	}
	if frame := c.spin.View(); !strings.Contains(got, frame) {
		t.Errorf("the status line does not carry the spinner frame %q:\n%s", frame, got)
	}
}

// With no Run in flight the same line says so, rather than disappearing. A
// status line that came and went would move the prompt under a person's hands
// every time a turn started.
func TestTheStatusLineIsStillALineWhenNothingIsRunning(t *testing.T) {
	c := &Console{styles: newStyles(theme.Default(true)), spin: spinner.New()}

	if got := plain(c.status()); got != "ready" {
		t.Errorf("the status line reads %q, want %q", got, "ready")
	}
}

// The live area is erased when the Run closes, and what is kept is the fold
// over what the Trace holds. So arriving chunks reach the pane without ever
// reaching the transcript, and the transcript is what survives them.
func TestArrivingTextIsShownWithoutBeingKept(t *testing.T) {
	// Built the way a run builds it, so that the pane, the renderer and the
	// styles are the ones a person would be looking at. The program it returns
	// is never started: nothing here needs a turn.
	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(40, 12)

	c.live.write("half an answer")
	c.refresh()
	if got := plain(c.pane.View()); !strings.Contains(got, "half an answer") {
		t.Errorf("the pane does not show what is arriving:\n%s", got)
	}
	if kept := c.kept(); strings.Contains(kept, "half an answer") {
		t.Errorf("the transcript kept an arriving chunk:\n%s", kept)
	}

	// What the Run closing does: the rendered turn arrives, and showing it is
	// what erases the chunks.
	if err := c.Show("the whole answer"); err != nil {
		t.Fatalf("show the turn: %v", err)
	}
	if got := plain(c.pane.View()); strings.Contains(got, "half an answer") {
		t.Errorf("the pane still shows arriving text after the Run closed:\n%s", got)
	}
	if got := plain(c.pane.View()); !strings.Contains(got, "the whole answer") {
		t.Errorf("the pane does not show the turn that was kept:\n%s", got)
	}
}

func TestAnAnsweredTurnIsShownOnce(t *testing.T) {
	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(60, 12)

	// A turn arrives in chunks, and is then kept as one rendered block. The
	// words are the same either way, which is the whole difficulty.
	answer := "the answer"
	c.live.write(answer)
	c.refresh()
	if err := c.Show(answer); err != nil {
		t.Fatalf("show the turn: %v", err)
	}
	c.close(answered{})

	if got := strings.Count(plain(c.pane.View()), answer); got != 1 {
		t.Errorf("the answer is on screen %d times, want 1:\n%s", got, plain(c.pane.View()))
	}
}

func TestTheViewIsExactlyTheWindow(t *testing.T) {
	for _, size := range []struct{ width, height int }{
		{80, 24}, {120, 60}, {200, 15}, {40, 10}, {30, 6}, {24, 5}, {20, 4},
	} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			c := drawn(t)
			c.layout(size.width, size.height)

			if got := lipgloss.Height(c.View().Content); got != size.height {
				t.Errorf("the view is %d rows in a window of %d:\n%s",
					got, size.height, plain(c.View().Content))
			}
		})
	}
}

// The view is never wider than the window, and it is inset from both edges while
// the window can spare it.
func TestTheViewFitsTheWindowAndIsInsetFromItsEdges(t *testing.T) {
	for _, size := range []struct{ width, height int }{
		{120, 30}, {88, 24}, {60, 12}, {44, 9}, {40, 8}, {36, 8}, {24, 6}, {20, 4},
	} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			c := drawn(t)
			c.layout(size.width, size.height)
			c.keep(block{text: "an answer with enough words in it to reach the edge of a narrow window", voice: evaVoice})

			for i, line := range strings.Split(plain(c.View().Content), "\n") {
				if got := lipgloss.Width(line); got > size.width {
					t.Fatalf("row %d is %d columns wide in a window of %d:\n%q", i, got, size.width, line)
				}
			}

			// What the look asks for at the left, and what this window could afford.
			asked := c.look.Layout.Margin.Left + c.look.Layout.Padding.Left
			inset := c.edges.margin.Left + c.edges.padding.Left

			if size.width-2*asked < narrowest {
				if inset != 0 {
					t.Errorf("a window of %d columns held back %d at the left, and it cannot spare one",
						size.width, inset)
				}
				return
			}
			if inset != asked {
				t.Fatalf("a window of %d columns holds back %d at the left, and the look asks for %d",
					size.width, inset, asked)
			}
			for i, line := range strings.Split(plain(c.View().Content), "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				if !strings.HasPrefix(line, strings.Repeat(" ", inset)) {
					t.Errorf("row %d starts at the window's edge:\n%q", i, line)
				}
			}
		})
	}
}

// A window too small for all of the chrome sheds it from the outside in, and
// keeps the prompt. A console a person cannot type into is not a console.
func TestASmallWindowKeepsThePrompt(t *testing.T) {
	c := drawn(t)
	c.layout(40, 5)

	if got := plain(c.View().Content); !strings.Contains(got, "›") {
		t.Errorf("a five-row window dropped the prompt:\n%s", got)
	}
}

// The transcript scrolls by key, and the keys that scroll it are never keys
// that also type.
func TestTheTranscriptScrollsWithoutStealingCharacters(t *testing.T) {
	c := drawn(t)
	c.layout(40, 10)
	for i := range 100 {
		c.put(fmt.Sprintf("line %d", i))
	}

	if !c.pane.AtBottom() {
		t.Fatal("the pane does not start at the end of the transcript")
	}
	c.key(tea.KeyPressMsg{Code: tea.KeyPgUp})
	if c.pane.AtBottom() {
		t.Error("pgup did not move the pane")
	}

	// Every character the pane's defaults would have taken reaches the prompt.
	for _, typed := range "jkfbud " {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	if got := c.input.Value(); got != "jkfbud " {
		t.Errorf("the prompt holds %q — the pane took characters from it", got)
	}
}

// A prompt typed while a turn is running waits for it rather than being lost.
func TestAPromptTypedDuringATurnWaitsForIt(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	// A Run in flight, without one actually running: what makes the console
	// busy is holding a way to cancel.
	_, cancel := context.WithCancel(context.Background())
	c.shown.hold(cancel)
	t.Cleanup(cancel)

	for _, typed := range "next" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	if got := c.input.Value(); got != "next" {
		t.Fatalf("the prompt holds %q while a turn runs, want the keys that were typed", got)
	}

	c.key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if c.Queued() != "next" {
		t.Errorf("the queued prompt is %q, want it held until the turn closes", c.Queued())
	}
	// Its own row, under the one that says what the turn is doing: that row shares
	// its width with the figures at the far end, and a prompt is a sentence.
	if got := plain(c.queuedLine()); !strings.Contains(got, "next") {
		t.Errorf("nothing on screen shows the prompt that is waiting:\n%s", got)
	}
	if got := plain(c.View().Content); !strings.Contains(got, "next") {
		t.Errorf("the queued prompt is not in the window:\n%s", got)
	}
	// Not echoed yet: the transcript reads in the order the turns happened.
	if kept := c.kept(); strings.Contains(kept, "next") {
		t.Errorf("a queued prompt was echoed before it was sent:\n%s", kept)
	}
}

func TestAnIdleCtrlCAsksBeforeItLeaves(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	if cmd := c.key(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}); cmd != nil {
		t.Fatal("the first ctrl+c ended the Session without asking")
	}
	if got := plain(c.status()); !strings.Contains(got, "again to leave") {
		t.Errorf("the first ctrl+c did not ask:\n%s", got)
	}

	// Carrying on typing is an answer.
	c.key(tea.KeyPressMsg{Code: 'x', Text: "x"})
	if c.leaving {
		t.Error("a key that was not ctrl+c left the question standing")
	}
	if cmd := c.key(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}); cmd != nil {
		t.Fatal("ctrl+c after another key left without asking again")
	}
	if cmd := c.key(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}); cmd == nil {
		t.Error("the second ctrl+c did not leave")
	}
}

// The footer says how much transcript is below a person who has scrolled away
// from the end, and says nothing while they are at it.
func TestTheFooterSaysHowMuchIsBelow(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)
	for i := range 100 {
		c.put(fmt.Sprintf("line %d", i))
	}

	if got := plain(c.footer()); strings.Contains(got, "more") {
		t.Errorf("the footer counts what is below while a person is at the end:\n%s", got)
	}

	c.key(tea.KeyPressMsg{Code: tea.KeyPgUp})
	if got := plain(c.footer()); !strings.Contains(got, "more") {
		t.Errorf("the footer says nothing after a person scrolled away:\n%s", got)
	}
}

// drawn is a console built the way a run builds one, so that the pane, the
// renderer and the styles are the ones a person would be looking at. The
// program it returns is never started: nothing here needs a turn.
func drawn(t *testing.T) *Console {
	t.Helper()

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	// What the program does before it draws anything. Without it the prompt is
	// unfocused, and an unfocused prompt takes no keys — so a test that typed
	// into one would be asserting about a console no person ever sees.
	c.Init()
	return c
}

func TestThePromptGrowsWithoutTakingTheWindow(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)

	was := c.pane.Height()
	for _, typed := range "first" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}

	// The chord, rather than enter, which sends.
	c.key(tea.KeyPressMsg{Code: tea.KeyEnter, Mod: tea.ModShift})
	for _, typed := range "second" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}

	if got := c.input.Value(); got != "first\nsecond" {
		t.Fatalf("the prompt holds %q, want two lines", got)
	}
	if len(c.transcript) != 0 {
		t.Errorf("the chord sent the prompt instead of breaking the line:\n%s", c.kept())
	}

	// No refit asked for here. Growing the prompt has to take its row from the
	// pane by itself, on the keystroke that grew it — otherwise the view is a
	// row taller than the window, and what falls off the bottom is the line
	// being typed.
	if now := c.pane.Height(); now != was-1 {
		t.Errorf("the pane is %d rows and was %d — the second prompt row came from somewhere else", now, was)
	}
	if got := lipgloss.Height(c.View().Content); got != 20 {
		t.Errorf("the view is %d rows in a window of 20", got)
	}

	// And enter still sends the whole of it.
	c.key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if kept := c.kept(); !strings.Contains(kept, "first") {
		t.Errorf("enter did not send the prompt:\n%s", kept)
	}
}

func TestAResizedWindowRewrapsTheTurnsAlreadyAnswered(t *testing.T) {
	c := drawn(t)
	c.layout(100, 20)

	// A turn, the way one actually gets kept: folded from committed records and
	// handed to this console as the Screen.
	long := strings.TrimSpace(strings.Repeat("wrapping is the whole question here. ", 12))
	c.keep(block{text: c.styles.said.Render("ask something"), voice: personVoice})
	for _, e := range []events.Event{
		{Kind: events.KindStarted, Payload: events.Started{}},
		{Kind: events.KindText, Payload: events.Text{Chunk: long}},
		{Kind: events.KindFinished, Payload: events.Finished{}},
	} {
		if err := c.renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("fold %s: %v", e.Kind, err)
		}
	}

	if over := widest(plain(c.kept())); over > 100 {
		t.Fatalf("a line is %d columns wide in a window of 100", over)
	}

	settle(t, c, 50, 20)
	if over := widest(plain(c.kept())); over > 50 {
		t.Errorf("a line is %d columns wide after the window narrowed to 50:\n%s", over, plain(c.kept()))
	}

	// And the prompt that was echoed is still where it was, unchanged.
	if !strings.Contains(plain(c.kept()), "ask something") {
		t.Errorf("the resize lost what a person typed:\n%s", plain(c.kept()))
	}
	if c.transcript[0].voice != personVoice {
		t.Error("an echoed prompt is not in a person's voice, so a resize would redraw it as a turn")
	}
}

func TestEveryLookDrawsAWholeScreen(t *testing.T) {
	for _, name := range theme.Names() {
		t.Run(name, func(t *testing.T) {
			look, err := theme.Named(name, true)
			if err != nil {
				t.Fatalf("build the %q look: %v", name, err)
			}

			_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithTheme(look))
			if err != nil {
				t.Fatalf("build the interface: %v", err)
			}
			c.Init()
			c.about = About{Version: "0.1.1", Branch: "main", Dir: "~/eva"}
			c.layout(80, 24)

			c.keep(block{text: "what I asked", voice: personVoice})
			c.keep(block{text: "## an answer\n\nwith a paragraph", voice: evaVoice})
			c.live.write("and one still arriving")
			c.openPalette()
			c.refresh()
			c.close(answered{outcome: core.Outcome{Result: events.ResultFailed, Class: events.ErrorRateLimit}})

			if got := c.View().Content; strings.TrimSpace(plain(got)) == "" {
				t.Errorf("the %q look drew nothing", name)
			}
			if got := lipgloss.Height(c.View().Content); got != 24 {
				t.Errorf("the %q look drew %d rows in a window of 24", name, got)
			}
		})
	}
}

// A turn that produced no answer is not drawn in the grey the interface says
// everything else about itself in.
func TestAFailedTurnIsNotDrawnAsAHint(t *testing.T) {
	t.Setenv("CLICOLOR_FORCE", "1")

	// The default look, because that is the one nearly everybody reads. A
	// configured colour reaching the screen is asserted where a configured Theme
	// is; what matters here is that a person who configured nothing can find the
	// line.
	look := theme.Default(true)

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithTheme(look))
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.Init()
	c.layout(80, 20)

	c.close(answered{outcome: core.Outcome{Result: events.ResultFailed, Class: events.ErrorAuthFailed}})

	failure := c.kept()
	if !strings.Contains(failure, opens(c.styles.failure)) {
		t.Errorf("the failure line is not drawn in the failure colour:\n%q", failure)
	}
	if strings.Contains(failure, opens(c.styles.hint)) {
		t.Errorf("the failure line is drawn in the grey the hints use:\n%q", failure)
	}

	// And the same turn, interrupted, is.
	c.transcript = nil
	c.interrupted = true
	c.close(answered{outcome: core.Outcome{Result: events.ResultFailed}})

	if got := strings.TrimSpace(plain(c.kept())); got != "interrupted" {
		t.Fatalf("an interrupted turn said %q", got)
	}
	if !strings.Contains(c.kept(), opens(c.styles.hint)) {
		t.Errorf("an interruption is drawn as a failure rather than as the thing a person just did:\n%q", c.kept())
	}
}

// opens is the sequence a style begins with, so that a test can ask which style
// drew a line rather than re-render the line and compare.
func opens(style lipgloss.Style) string {
	drawn := style.Render("x")
	opening, _, _ := strings.Cut(drawn, "x")
	return opening
}

func TestTheFooterIsOneRowWhetherOrNotSomebodyHasScrolled(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	for i := range 20 {
		c.keep(block{text: fmt.Sprintf("turn %d, with enough words in it to wrap in a narrow window", i), voice: evaVoice})
	}

	if got := lipgloss.Height(c.footer()); got != 1 {
		t.Errorf("the footer is %d rows at the end of the transcript", got)
	}

	c.pane.GotoTop()
	if got := lipgloss.Height(c.footer()); got != 1 {
		t.Errorf("the footer is %d rows after somebody scrolled back:\n%s", got, plain(c.footer()))
	}
	if !strings.Contains(plain(c.footer()), "more") {
		t.Errorf("the footer says nothing about what is below, from the top of a transcript of 20:\n%s",
			plain(c.footer()))
	}
}

func settle(t *testing.T, c *Console, width, height int) {
	t.Helper()

	_, cmd := c.Update(tea.WindowSizeMsg{Width: width, Height: height})
	if cmd == nil {
		t.Fatalf("a window of %dx%d asked for nothing to be drawn again", width, height)
	}
	if _, cmd = c.Update(cmd()); cmd != nil {
		t.Fatal("the settled resize answered with something else to run")
	}
}

func TestADraggedWindowIsDrawnAgainOnceAtTheWidthItStopsOn(t *testing.T) {
	c := drawn(t)
	c.layout(100, 20)

	long := strings.TrimSpace(strings.Repeat("wrapping is the whole question here. ", 12))
	for _, e := range []events.Event{
		{Kind: events.KindStarted, Payload: events.Started{}},
		{Kind: events.KindText, Payload: events.Text{Chunk: long}},
		{Kind: events.KindFinished, Payload: events.Finished{}},
	} {
		if err := c.renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("fold %s: %v", e.Kind, err)
		}
	}

	// The drag: every width from 100 down to 60, none of them settled.
	var last tea.Cmd
	for width := 100; width >= 60; width-- {
		_, last = c.Update(tea.WindowSizeMsg{Width: width, Height: 20})
	}

	if over := widest(plain(c.kept())); over <= 60 {
		t.Errorf("the turns were re-wrapped during the drag: the widest line is %d columns", over)
	}
	// The pane fits the window as the drag happens, less whatever is held back at
	// its edges. It is the cheap half of a resize and it is the half that has to
	// keep up.
	if c.pane.width != c.width || c.width >= 60 {
		t.Errorf("the pane is %d columns wide during a drag to 60, and the interface draws in %d",
			c.pane.width, c.width)
	}

	// The last width settles, and it is the only one that draws anything again.
	if _, cmd := c.Update(last()); cmd != nil {
		t.Fatal("the settled resize answered with something else to run")
	}
	if over := widest(plain(c.kept())); over > 60 {
		t.Errorf("a line is %d columns wide after the drag ended at 60:\n%s", over, plain(c.kept()))
	}
}

func widest(s string) int {
	over := 0
	for _, line := range strings.Split(s, "\n") {
		over = max(over, lipgloss.Width(line))
	}
	return over
}

func TestAnAnswerDoesNotMoveWhenItStopsArriving(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	const answer = "short enough to stay on one line."

	c.live.write(answer)
	c.refresh()
	streaming := column(t, plain(c.pane.View()), answer)

	// And now the way the fold hands it over when the Run closes.
	for _, e := range []events.Event{
		{Kind: events.KindStarted, Payload: events.Started{}},
		{Kind: events.KindText, Payload: events.Text{Chunk: answer}},
		{Kind: events.KindFinished, Payload: events.Finished{}},
	} {
		if err := c.renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("fold %s: %v", e.Kind, err)
		}
	}
	kept := column(t, plain(c.pane.View()), answer)

	if streaming != kept {
		t.Errorf("the answer arrives at column %d and is kept at column %d — it steps sideways when the Run closes",
			streaming, kept)
	}
	if streaming != gutterWidth {
		t.Errorf("the answer sits at column %d, want the gutter's %d", streaming, gutterWidth)
	}
}

// An arriving answer that costs a lot to draw is drawn less often, and it is
// never left undrawn.
func TestAnExpensiveAnswerIsDrawnLessOftenAndIsNotLost(t *testing.T) {
	c := drawn(t)
	c.layout(80, 20)

	c.live.write("the first words")
	c.refresh()
	if !strings.Contains(plain(c.Screen()), "the first words") {
		t.Fatalf("a cheap answer was not drawn at all:\n%s", plain(c.Screen()))
	}

	// A drawing that cost a second, a moment ago. The share is eight, so the
	// next one is not due for eight seconds.
	c.live.cost = time.Second
	c.live.at = time.Now()

	c.live.write(" and the next ones")
	// Taken, so that what the frame owes afterwards is the frame's own answer
	// rather than the chunk's.
	c.live.due()
	c.refresh()

	if strings.Contains(plain(c.Screen()), "and the next ones") {
		t.Errorf("an expensive answer was redrawn inside its own cost:\n%s", plain(c.Screen()))
	}
	if !c.live.due() {
		t.Error("the frame declined to draw and did not say it was behind, so the newest text waits for a chunk that may never come")
	}

	// Long enough that the next drawing is due.
	c.live.at = time.Now().Add(-time.Minute)
	c.refresh()

	if !strings.Contains(plain(c.Screen()), "and the next ones") {
		t.Errorf("the answer was still not drawn once its cost had been paid for:\n%s", plain(c.Screen()))
	}
}

func TestTheDrawingOfAnArrivingAnswerDoesNotOutliveItsTurn(t *testing.T) {
	c := drawn(t)
	c.layout(80, 20)

	c.live.write("what the last turn was saying")
	c.refresh()

	c.live.forget()
	c.refresh()

	if got := plain(c.Screen()); strings.Contains(got, "what the last turn was saying") {
		t.Errorf("the drawing outlived the turn that was arriving:\n%s", got)
	}
}

func TestABlockKeptFromAnEarlierFrameIsStillTrue(t *testing.T) {
	c := drawn(t)
	c.layout(80, 20)

	c.keep(block{text: "what I asked", voice: personVoice})
	c.keep(block{text: "## An answer\n\nwith a paragraph in it", voice: evaVoice})
	c.keep(block{text: "what the console said", voice: asideVoice})

	// fresh is the transcript drawn with nothing kept, which is what the cached
	// drawing has to equal.
	fresh := func() string {
		for i := range c.transcript {
			c.transcript[i].lines = nil
		}
		return c.compose(c.transcript)
	}

	at := func(when string) {
		t.Helper()
		cached := c.compose(c.transcript)
		if again := fresh(); cached != again {
			t.Errorf("%s the kept drawing is not what a fresh one would be:\ncached:\n%s\nfresh:\n%s",
				when, plain(cached), plain(again))
		}
	}

	c.refresh()
	at("after a block is kept,")

	c.layout(50, 20)
	at("after the window narrowed,")

	c.background(!c.dark)
	at("after the terminal answered about its colour,")
}

// The gutter says whose block it is: a person's mark, Eva's mark, and no mark
// at all for the interface talking about itself.
func TestTheGutterSaysWhoseBlockItIs(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	person := c.gutter("what I asked", personVoice)
	eva := c.gutter("what Eva answered", evaVoice)
	aside := c.gutter("what the console said", asideVoice)

	for _, marked := range []string{person, eva} {
		if !strings.HasPrefix(plain(marked), mark) {
			t.Errorf("a block in the conversation carries no mark:\n%q", plain(marked))
		}
	}
	if strings.Contains(plain(aside), mark) {
		t.Errorf("an aside carries a mark, which says it is part of the conversation:\n%q", plain(aside))
	}

	// Different colours, same glyph: the escapes differ, the plain text does not.
	if person == eva {
		t.Error("a person's mark and Eva's are drawn identically — the gutter segregates nothing")
	}

	// One straight edge: every voice starts its text in the same column.
	for _, block := range []struct {
		drawn string
		text  string
	}{
		{person, "what I asked"},
		{eva, "what Eva answered"},
		{aside, "what the console said"},
	} {
		if got := column(t, plain(block.drawn), block.text); got != gutterWidth {
			t.Errorf("%q starts at column %d, want the gutter's %d", block.text, got, gutterWidth)
		}
	}
}

func column(t *testing.T, screen, text string) int {
	t.Helper()

	for _, line := range strings.Split(screen, "\n") {
		if i := strings.Index(line, text); i >= 0 {
			return lipgloss.Width(line[:i])
		}
	}
	t.Fatalf("%q is not on screen:\n%s", text, screen)
	return 0
}

// One blank line stands between blocks, and it carries no mark.
func TestBlocksAreSpacedApartAndTheGapCarriesNoMark(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	c.keep(block{text: "what I asked", voice: personVoice})
	c.keep(block{text: "first paragraph\n\nsecond paragraph", voice: evaVoice})

	lines := strings.Split(plain(c.kept()), "\n")
	want := []string{
		mark + " what I asked",
		"",
		mark + " first paragraph",
		mark + " ",
		mark + " second paragraph",
	}
	if len(lines) != len(want) {
		t.Fatalf("the transcript drew %d lines, want %d:\n%q", len(lines), len(want), lines)
	}
	for i, line := range lines {
		if strings.TrimRight(line, " ") != strings.TrimRight(want[i], " ") {
			t.Errorf("line %d is %q, want %q", i, line, want[i])
		}
	}
}

// A block brings no blank lines of its own. The fold pads a rendered document
// above and below, which would put a marked empty line at the top of every
// answer and space nothing evenly.
func TestABlockIsTrimmedOfTheBlankLinesItArrivedWith(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	c.keep(block{text: "\n\n  padded above and below  \n\n", voice: evaVoice})

	if got := plain(c.kept()); got != mark+"   padded above and below  " {
		t.Errorf("the block kept the blank lines it arrived with:\n%q", got)
	}
}

// An answer is formatted while it arrives, not only once it is over.
func TestAnAnswerIsFormattedWhileItArrives(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	const answer = "- first bullet\n- second bullet"

	c.live.write(answer)
	c.refresh()
	streaming := plain(c.pane.View())

	if strings.Contains(streaming, "- first bullet") {
		t.Errorf("the answer arrives as raw markdown:\n%s", streaming)
	}
	if !strings.Contains(streaming, "• first bullet") {
		t.Errorf("the arriving answer is not formatted:\n%s", streaming)
	}

	// And the turn that replaces it draws the same lines.
	for _, e := range []events.Event{
		{Kind: events.KindStarted, Payload: events.Started{}},
		{Kind: events.KindText, Payload: events.Text{Chunk: answer}},
		{Kind: events.KindFinished, Payload: events.Finished{}},
	} {
		if err := c.renderer.Committed(context.Background(), e); err != nil {
			t.Fatalf("fold %s: %v", e.Kind, err)
		}
	}

	kept := plain(c.pane.View())
	for _, bullet := range []string{"• first bullet", "• second bullet"} {
		if column(t, streaming, bullet) != column(t, kept, bullet) {
			t.Errorf("%q sits at column %d while arriving and %d once kept",
				bullet, column(t, streaming, bullet), column(t, kept, bullet))
		}
	}
}

// What a person configured is what they see. Each of these is a value that
// reaches the screen through a different part of the interface, so a Theme that
// were held and not drawn with would fail here rather than in a person's
// terminal.
func TestAConfiguredThemeReachesTheScreen(t *testing.T) {
	prompt, placeholder := "» ", "say the thing"
	look, err := theme.Build(true, theme.Settings{
		Prompt:      &prompt,
		Placeholder: &placeholder,
		Person:      "#ABCDEF",
	})
	if err != nil {
		t.Fatalf("build the Theme: %v", err)
	}

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithTheme(look))
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(60, 20)

	if got := plain(c.prompt()); !strings.Contains(got, prompt) {
		t.Errorf("the prompt does not carry the chosen mark %q:\n%s", prompt, got)
	}
	if got := plain(c.prompt()); !strings.Contains(got, placeholder) {
		t.Errorf("the prompt does not carry the chosen placeholder %q:\n%s", placeholder, got)
	}

	// The mark down the left of what a person said carries the chosen hue, so
	// the styled bytes differ from the ones the default would have produced.
	_, plainConsole, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the default interface: %v", err)
	}
	if c.styles.person.Render("x") == plainConsole.styles.person.Render("x") {
		t.Error("a chosen colour draws the same bytes as the default one")
	}
}

// A rebound key does what it was bound to, and the key it replaced does not.
func TestAReboundKeyIsTheKeyThatWorks(t *testing.T) {
	keys, err := keymap.Parse(map[string][]string{"follow": {"ctrl+g"}})
	if err != nil {
		t.Fatalf("parse the keymap: %v", err)
	}

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithKeymap(keys))
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(40, 10)

	// Enough transcript to have somewhere to scroll from.
	for range 40 {
		c.keep(block{text: "a line of transcript", voice: evaVoice})
	}
	c.refresh()

	c.key(tea.KeyPressMsg{Code: 'g', Mod: tea.ModCtrl})
	if !c.pane.AtBottom() {
		t.Error("the rebound chord did not follow the transcript")
	}

	c.pane.GotoTop()
	c.key(tea.KeyPressMsg{Code: tea.KeyEnd, Mod: tea.ModCtrl})
	if c.pane.AtBottom() {
		t.Error("the replaced chord still follows the transcript")
	}
}

// The hint naming a key reads the binding, so help and behaviour cannot drift.
func TestTheFollowHintNamesTheKeyThatFollows(t *testing.T) {
	keys, err := keymap.Parse(map[string][]string{"follow": {"ctrl+g"}})
	if err != nil {
		t.Fatalf("parse the keymap: %v", err)
	}

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithKeymap(keys))
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(80, 10)

	for range 40 {
		c.keep(block{text: "a line of transcript", voice: evaVoice})
	}
	c.refresh()
	c.pane.GotoTop()

	got := plain(c.footer())
	if !strings.Contains(got, "ctrl+g") {
		t.Errorf("the hint does not name the key that follows:\n%s", got)
	}
	if strings.Contains(got, "ctrl+end") {
		t.Errorf("the hint still names the key that was replaced:\n%s", got)
	}
}

// An interrupted Run is not an ended one, and the console stays busy until its
// close arrives.
func TestAnInterruptedRunIsStillInHandUntilItCloses(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	// A Run in flight, without one actually running: what makes the console
	// busy is holding a way to cancel.
	ctx, cancel := context.WithCancel(context.Background())
	c.shown.hold(cancel)
	t.Cleanup(cancel)

	c.key(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})

	if ctx.Err() == nil {
		t.Error("the interrupt did not cancel the Run in flight")
	}
	if !c.busy() {
		t.Error("the console is idle while the Run it cancelled is still unwinding")
	}

	// So a prompt typed now waits rather than opening a second Run.
	for _, typed := range "next" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	c.key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if got := c.Queued(); got != "next" {
		t.Errorf("the prompt typed after an interrupt is %q, want it queued behind the closing Run", got)
	}

	// The close is what releases it, and the prompt that waited is sent rather
	// than dropped. The Run that sends it is a new one: the old Run's close must
	// not reach into it.
	c.close(answered{})
	if got := c.Queued(); got != "" {
		t.Errorf("the queued prompt is still %q after the Run it waited for closed", got)
	}
	c.stop()
}

func TestTheConsoleOpensWithItsMasthead(t *testing.T) {
	c := drawn(t)
	c.about = About{Version: "9.9.9", Branch: "some-branch", Dir: "~/somewhere"}
	c.layout(80, 24)

	got := plain(c.pane.View())
	for _, want := range []string{"EVA", "9.9.9", "m", "some-branch", "~/somewhere"} {
		if !strings.Contains(got, want) {
			t.Errorf("the masthead does not carry %q:\n%s", want, got)
		}
	}
}

// A fact the run does not have draws no row. Eva outside a repository has no
// branch, and a line reading "unknown" spends a row on the absence of one.
func TestAMissingFactDrawsNoRow(t *testing.T) {
	c := drawn(t)
	c.about = About{Version: "9.9.9"}
	c.layout(80, 24)

	got := plain(c.pane.View())
	if strings.Contains(got, "branch") {
		t.Errorf("the masthead names a branch the run does not have:\n%s", got)
	}
	if !strings.Contains(got, "9.9.9") {
		t.Errorf("the masthead lost the facts it does have:\n%s", got)
	}
}

func TestTheMastheadFollowsTheModel(t *testing.T) {
	c := drawn(t)
	c.about = About{Version: "9.9.9"}
	c.layout(80, 24)

	c.control.UseModel("a-different-model")
	c.refresh()

	if got := plain(c.pane.View()); !strings.Contains(got, "a-different-model") {
		t.Errorf("the masthead still names the old model:\n%s", got)
	}
}

func TestTheMastheadBarIsTheChosenAccent(t *testing.T) {
	look, err := theme.Build(true, theme.Settings{Person: "#FF00FF"})
	if err != nil {
		t.Fatalf("build the Theme: %v", err)
	}

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithTheme(look))
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.about = About{Version: "9.9.9"}
	c.layout(80, 24)

	head := c.masthead()
	if !strings.Contains(head, barMark) {
		t.Fatal("the masthead draws no bar")
	}
	// Rendered against the chosen accent, the bar's bytes differ from the same
	// bar drawn against the default one.
	plainConsole := drawn(t)
	plainConsole.about = About{Version: "9.9.9"}
	plainConsole.layout(80, 24)
	if head == plainConsole.masthead() {
		t.Error("the bar draws the same bytes whichever accent was chosen")
	}
}

func TestAFailedTurnDrawsTheCheckedNextStep(t *testing.T) {
	c := drawn(t)
	c.control = &fixed{model: "m", remedy: render.Remedy{
		Because: "no openai login is stored",
		Do:      "eva login",
	}}
	c.layout(60, 12)

	c.close(answered{outcome: core.Outcome{Result: events.ResultFailed, Class: events.ErrorAuthFailed}})

	got := plain(c.kept())
	for _, want := range []string{
		render.Unanswered(events.ErrorAuthFailed),
		"no openai login is stored",
		"eva login",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the transcript does not say %q:\n%s", want, got)
		}
	}
}

// A machine nothing could be established about gets the one line and no more.
func TestAFailureWithNothingCheckedDrawsNoStep(t *testing.T) {
	c := drawn(t)
	c.control = &fixed{model: "m"}
	c.layout(60, 12)

	c.close(answered{outcome: core.Outcome{Result: events.ResultFailed, Class: events.ErrorOverloaded}})

	if got := strings.TrimSpace(plain(c.kept())); got != render.Unanswered(events.ErrorOverloaded) {
		t.Errorf("the transcript reads %q, want the failure line alone", got)
	}
}

// Interruption spends none of this. There is no remedy for the thing a person
// just did on purpose, and offering one would answer a question nobody asked.
func TestAnInterruptedTurnIsGivenNoRemedy(t *testing.T) {
	c := drawn(t)
	c.control = &fixed{model: "m", remedy: render.Remedy{
		Because: "no openai login is stored",
		Do:      "eva login",
	}}
	c.layout(60, 12)
	c.interrupted = true

	c.close(answered{outcome: core.Outcome{Result: events.ResultFailed, Class: events.ErrorAuthFailed}})

	if got := strings.TrimSpace(plain(c.kept())); got != "interrupted" {
		t.Errorf("an interrupted turn reads %q, want %q alone", got, "interrupted")
	}
}
