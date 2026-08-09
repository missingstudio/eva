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
func (f *fixed) Model() string         { return f.model }
func (f *fixed) UseModel(model string) { f.model = model }
func (f *fixed) Clear()                {}

// escapes matches any terminal escape sequence, so that a test can assert on
// the words a person reads rather than on the bytes that place them.
var escapes = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)

func plain(s string) string { return escapes.ReplaceAllString(s, "") }

// The footer says which model is answering, at the far end of the window.
//
// A person who has just used /model should not have to use it again to find
// out what it did.
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

// The status line says a turn is running, for how long, and how to stop it.
//
// The elapsed figure is what a person decides on: an answer that has not
// started arriving looks exactly like an interface that has stopped, and the
// difference between the two is how long it has been.
func TestTheStatusLineSaysHowLongTheTurnHasRun(t *testing.T) {
	c := &Console{
		styles: newStyles(theme.Default(true)),
		spin:   spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		since:  time.Now().Add(-3 * time.Second),
		// A Run in flight is one with something to cancel. See busy.
		cancel: func() {},
	}

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

	c.arriving.WriteString("half an answer")
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

// A turn is on screen once, not twice.
//
// The rendered turn arrives with the record that closes the Run, and the Run's
// own closing reaches the interface as a separate message afterwards. Erasing
// the chunks on the later one leaves the answer shown twice — once as what
// arrived, once as what was kept — and nothing recomposes after it, so it stays
// that way until the next turn.
func TestAnAnsweredTurnIsShownOnce(t *testing.T) {
	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(60, 12)

	// A turn arrives in chunks, and is then kept as one rendered block. The
	// words are the same either way, which is the whole difficulty.
	answer := "the answer"
	c.arriving.WriteString(answer)
	c.refresh()
	if err := c.Show(answer); err != nil {
		t.Fatalf("show the turn: %v", err)
	}
	c.close(answered{})

	if got := strings.Count(plain(c.pane.View()), answer); got != 1 {
		t.Errorf("the answer is on screen %d times, want 1:\n%s", got, plain(c.pane.View()))
	}
}

// The view is exactly the window it was given.
//
// A view a row too tall scrolls the terminal and leaves a duplicate line behind
// on every frame; a row too short leaves a band the interface never draws into.
// Neither announces itself, which is why the arithmetic is asserted rather than
// looked at — and why the chrome is measured rather than counted, since the
// status line grows a row when a prompt is queued behind a turn.
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
//
// The second half is the one that matters. The pane's own defaults bind j, k,
// space, f, b, u and d — and ctrl+d, which is how this console is left — so a
// pane holding them would make the prompt unusable and would do it silently.
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
//
// Dropping the keys was the old behaviour and it was silent: a person watched
// the characters appear, pressed enter, and had nothing to show for either.
func TestAPromptTypedDuringATurnWaitsForIt(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	// A Run in flight, without one actually running: what makes the console
	// busy is holding a way to cancel.
	_, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	t.Cleanup(cancel)

	for _, typed := range "next" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	if got := c.input.Value(); got != "next" {
		t.Fatalf("the prompt holds %q while a turn runs, want the keys that were typed", got)
	}

	c.key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if c.queued != "next" {
		t.Errorf("the queued prompt is %q, want it held until the turn closes", c.queued)
	}
	if got := plain(c.status()); !strings.Contains(got, "next") {
		t.Errorf("the status line does not show the prompt that is waiting:\n%s", got)
	}
	// Not echoed yet: the transcript reads in the order the turns happened.
	if kept := c.kept(); strings.Contains(kept, "next") {
		t.Errorf("a queued prompt was echoed before it was sent:\n%s", kept)
	}
}

// An idle ctrl+c asks before it ends a Session, and any other key answers no.
//
// It sits next to the key that interrupts a turn, and a Session is an hour of
// somebody's work by the time it is worth keeping. ctrl+d stays one press,
// because nobody types it by accident.
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
//
// It is what a scrolling pane needs and a scrollback never did: a person
// scrolled up during a streaming answer sees a screen that does not change, and
// nothing else on it tells that apart from a program that has stopped.
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

// The prompt takes more than one line, and grows to what is being written.
//
// A person writing to a model writes paragraphs and pastes stack traces. A
// single-line field scrolls all of that sideways past a fixed window, which
// leaves what they are about to send as the one thing on screen they cannot
// read.
//
// Enter still sends, so the newline is on a chord. What the pane gives up is
// what the prompt takes, exactly: the window is the window.
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

// A window that changed size takes the turns already on screen with it.
//
// An answer is wrapped by the fold that rendered it, to whatever the window was
// at the time. Nothing about that survives a resize on its own: narrow the
// window and every answer on screen overruns it, widen it and they stand in a
// column with the rest of the screen empty beside them.
//
// What a person typed is left alone. It was never wrapped to anything, and where
// it sits in the order is what makes the transcript readable.
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

	c.layout(50, 20)
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

// widest is the longest line in a block of text.
func widest(s string) int {
	over := 0
	for _, line := range strings.Split(s, "\n") {
		over = max(over, lipgloss.Width(line))
	}
	return over
}

// What is arriving and what is kept sit in the same column.
//
// They are the same answer a moment apart, so a person watching one become the
// other should see nothing move. They did move: the fold indented a finished
// document by two columns of its own while the chunks arrived at column zero, so
// every answer stepped sideways the instant its Run closed. One owner of the
// inset is what fixes that, and this is the assertion that keeps it one.
func TestAnAnswerDoesNotMoveWhenItStopsArriving(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	const answer = "short enough to stay on one line."

	c.arriving.WriteString(answer)
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

// The gutter says whose block it is: a person's mark, Eva's mark, and no mark
// at all for the interface talking about itself.
//
// The two marks differ in colour rather than in shape, because what they are for
// is being found without being read. Everything is inset by the same width, so
// the edge they stand on is straight.
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

// column is the display column the given text starts at on the line holding it.
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
//
// Without it a prompt and the answer under it are adjacent lines of one band,
// and a conversation reads as a wall. The gap is what makes each exchange a
// thing you can find. It is unmarked because a marked gap would join the two
// bands it is there to separate — while a blank line *inside* a block keeps its
// mark, since a paragraph break in one answer is not a boundary between two.
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
//
// It goes through the same fold at the same width as the turn that will replace
// it, so that when the record lands nothing on screen changes shape. It used to
// be the raw bytes: a list arrived as hyphens and re-set itself as bullets the
// instant the Run closed, which put the most visible event on the screen at the
// exact moment a person had finally got what they were waiting for.
func TestAnAnswerIsFormattedWhileItArrives(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	const answer = "- first bullet\n- second bullet"

	c.arriving.WriteString(answer)
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
//
// A footer that said "ctrl+end to follow" while ctrl+end did nothing would be a
// help text and a behaviour that had come apart, and the person reading it
// would be the one to find out.
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
//
// Forgetting the Run at the moment it was cancelled made the console idle for
// the window between ctrl+c and the close being folded in. A prompt typed in
// that window opened a second Run instead of queueing, and then the first Run's
// close arrived and cancelled the second one, reset its stream, and dropped
// whatever was queued behind it.
func TestAnInterruptedRunIsStillInHandUntilItCloses(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	// A Run in flight, without one actually running: what makes the console
	// busy is holding a way to cancel.
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
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

// The console opens saying what it is and what it is talking to.
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

// The masthead says which model is answering now, so /model changes it. Two
// places naming a model is two places to disagree, and the footer is the other.
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

// The bar down the side is the accent a person chose, in shades of it.
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

// A failed turn says what happened, and then what that means on this machine.
//
// The console cannot establish the second part and does not try. It asks the
// thing that wired the run — which can see a configuration and an auth store,
// where this layer deliberately cannot — and draws whatever came back.
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
//
// This is the ordinary case, not the edge one: most failures have no step on
// this side of the network. A console that filled the gap with a likely-looking
// suggestion would be the last place able to tell it was inventing one.
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
