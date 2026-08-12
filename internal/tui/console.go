package tui

import (
	"context"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textarea"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/term"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

// console is the interactive interface: what a person is typing, what is
// arriving, and the turns already answered.
type Console struct {
	// control is the whole of what this console can reach of the run behind it:
	// starting a turn, and what a command may change about the turns that
	// follow. What keeps a Provider and a sink out of reach is the type — see
	// Control.
	control Control

	// renderer is the projection a person reads: a fold over committed Events,
	// showing on this model rather than writing to a stream.
	renderer *render.Renderer

	// ctx is what a Run is started under. The one a turn actually runs under
	// is a cancellable child of it, which is what Ctrl-C ends.
	ctx context.Context

	input textarea.Model

	// live is the open Run's answer as it streams, and it is what the live area
	// shows. The rendered turn that replaces it comes from the Renderer, once the
	// Run has closed — a heading, a list, and a fenced block are each only
	// meaningful once they are complete.
	live live

	// transcript is what has been kept: every rendered turn, every prompt
	// echoed back, and every command answered, in the order they happened. It
	// holds no arriving text — see refresh — so nothing in it came from
	// anywhere but a committed record or a person's own keystroke.
	transcript []block

	// pane is the window onto the transcript. It scrolls, so the transcript is
	// not truncated to fit; what a person sees is a position in it.
	pane pane

	// shown is what this console has published about the current frame, for
	// whoever is driving the program rather than typing at it: the rows on screen,
	// the Run in flight, and the prompt waiting behind it. Every lock this package
	// takes is inside it — see shown.go.
	shown shown

	// rowsLastFrame is how many rows the last frame held, and is the capacity
	// the next one is built at. A frame differs from the one before it by a
	// block, so the previous count is the best guess available and it costs
	// nothing to keep.
	rowsLastFrame int

	// running counts the Runs whose goroutine has not returned. The process
	// waits on it before it closes the sink, because a Run that is still
	// committing when its Trace closes is the one failure the project has no
	// instrument to detect.
	running sync.WaitGroup

	// width and height are what the interface draws in, and are zero until the
	// program reports them. The width is what the footer puts the model at the far
	// end of and what the answer is wrapped to; the height is kept because the
	// pane's own height is the remainder after the chrome, and the chrome does not
	// have one fixed size — see fit.
	width  int
	height int

	// edges are what this window actually holds back at its sides, which is what
	// the look asks for less whatever a small window could not spare. The window's
	// own size is these plus the width and height above, and it is not kept: a
	// second number for one fact is a second number to keep in step. See edges.go.
	edges edges

	// spin turns while a Run is in flight. It is the answer to the one question
	// a live area cannot otherwise answer: an answer that has not started
	// arriving looks exactly like an interface that has stopped.
	spin spinner.Model

	// since is when the Run in flight opened, and is what the status line
	// counts up from. A person deciding whether to wait or to interrupt is
	// deciding on elapsed time, so it is on screen rather than guessed at.
	since time.Time

	// caption is the phrase beside the spinner, and captioned is when it was
	// chosen. See caption.go for what they are and why they change on a clock of
	// their own rather than with the spinner's frame.
	caption   string
	captioned time.Time

	// pick chooses one of n. It is a field so that a test can fix what a person
	// sees; nothing else has a reason to replace it, and the console never seeds
	// or shares a source of its own.
	pick func(n int) int

	// leaving is whether an idle ctrl+c has already asked. One key should not
	// end a Session that took an hour to build, and the second press is the
	// answer to the question the first one puts on screen.
	leaving bool

	// pieces is the chrome as it was drawn for this frame. drawnChrome says
	// whether it belongs to this frame at all, and chromeAt which composition of
	// the pane it was drawn against.
	pieces      []string
	drawnChrome bool
	chromeAt    int

	// refreshes counts the frames composed into the pane. It is what the chrome
	// is stamped with, and it exists for one reason: fit draws the chrome before
	// the pane is composed, so a footer kept from that moment would report the
	// transcript as it was one composition ago.
	refreshes int

	// resizes counts the window sizes reported, so that the re-render a resize
	// asks for can tell whether it is still the one being waited on. See resize.
	resizes int

	// interrupted is whether this console stopped the Run in flight. It is the
	// console's own act rather than a reading of the claim that closed the Run,
	// which is why it is remembered rather than worked out: a person who pressed
	// ctrl+c is owed the word for what they did, and every other way a turn ends
	// without an answer is owed the same short line as the rest.
	interrupted bool

	past recall

	palette palette

	bg     theme.Background
	styles styles

	// look and keys are what a person configured, or the complete defaults when
	// they configured nothing. They are held rather than read from a file
	// because this layer cannot read a file: the layer that wires a run maps one
	// onto these and hands them in.
	look theme.Theme
	keys keymap.Keymap

	// about is what the masthead says of the run behind this console. It is
	// told at build, because a frontend does not read a version or a
	// repository for itself.
	about About

	// wrapStyle folds a block to the window. It is held rather than built per
	// call because refresh wraps every block on every frame of a streaming
	// turn, and it changes only when the window does.
	wrapStyle lipgloss.Style
}

var _ tea.Model = (*Console)(nil)

// styles are the interface's own, which are not the answer's. The answer is
// styled by the Renderer, and everything here is subordinate to it: a prompt
// echoed back and a status line are landmarks a person navigates by, not
// things they read.
type styles struct {
	said lipgloss.Style
	hint lipgloss.Style
	// failure is the line a turn that produced no answer leaves, and the checked
	// step under it. It is apart from hint because it is the one thing the
	// interface says about itself that a person must not skip — and in the hint's
	// grey it read as one more thing they could.
	failure lipgloss.Style
	// spin is the one thing here that is not subdued. A faint spinner is a
	// spinner nobody can see moving, and its whole job is to be seen moving.
	spin lipgloss.Style
	// box is the rule above and below the prompt. It is drawn in the same grey
	// as everything else here, because a border is the least of what is on
	// screen.
	box lipgloss.Style

	// person and eva are the marks down the left of the transcript, and they
	// are the one place in this interface where a second colour earns what it
	// costs. Everything else here is grey on purpose, because the answer is
	// what a person came for. The gutter is the exception: scrolling back is
	// looking for a boundary rather than reading, and a hue is what the eye
	// finds without reading.
	person lipgloss.Style
	eva    lipgloss.Style
}

func inputStyles(bg theme.Background) textarea.Styles {
	s := textarea.DefaultStyles(bg == theme.Dark)
	s.Focused.CursorLine = s.Focused.CursorLine.UnsetBackground()
	s.Blurred.CursorLine = s.Blurred.CursorLine.UnsetBackground()
	return s
}

func newStyles(look theme.Theme) styles {
	subdued := look.Subdued()
	return styles{
		said: lipgloss.NewStyle().Bold(true),
		// The same grey the cost line is written in. Both are subordinate to
		// the answer, and both read it off one Theme, so they cannot be two
		// decisions that happen to agree.
		hint:    subdued,
		failure: look.Failing(),
		spin:    spinStyle(look),
		box: lipgloss.NewStyle().
			Border(look.Border, true, false, true, false).
			BorderForeground(subdued.GetForeground()),

		// The person's mark carries the colour and Eva's does not, because
		// there is far more of Eva on the screen. A hue down the side of every
		// answer would be a hue nobody sees; a hue down the side of the four
		// things a person said is a landmark.
		person: lipgloss.NewStyle().Foreground(look.Colors.Person),
		eva:    lipgloss.NewStyle().Faint(true).Foreground(look.Colors.Eva),
	}
}

// spinStyle is plain unless a Theme named a colour for it. The spinner is the
// one thing here that is not subdued — a faint spinner is a spinner nobody can
// see moving — and plain is what that was before a colour could be chosen.
func spinStyle(look theme.Theme) lipgloss.Style {
	if look.Colors.Spinner == nil {
		return lipgloss.NewStyle()
	}
	return lipgloss.NewStyle().Foreground(look.Colors.Spinner)
}

type block struct {
	text  string
	voice voice

	lines []string
}

// voice is whose a block is, which is what the gutter beside it says.
type voice int

const (
	// evaVoice is a turn: what the fold made of committed records, and the text
	// arriving that is about to become one.
	evaVoice voice = iota
	// personVoice is a prompt echoed back.
	personVoice
	// asideVoice is the interface talking about itself — a command's answer, a
	// failure it has to report. It carries no mark, because it is not part of
	// the conversation and a mark would say that it was.
	asideVoice
)

// The gutter every block in the transcript is written past: a mark saying whose
// the block is, and a space.
const gutterWidth = 2

// mark is what stands in the gutter, and is a left half block rather than a
// pipe: at one column it has to read as a band rather than as punctuation.
const mark = "▌"

type committed struct{ event events.Event }

// chunk carries one piece of an answer into the update loop ahead of the
// record of it. It is what the live area is made of, and it is never what a
// turn leaves behind — see loop.Loop.Arriving.
type chunk struct{ text string }

type answered struct {
	outcome core.Outcome
	err     error
}

type feed struct{ program *tea.Program }

var _ core.Subscriber = (*feed)(nil)

func (f *feed) Committed(_ context.Context, e events.Event) error {
	f.program.Send(committed{event: e})
	return nil
}

type ended struct {
	// The whole file rather than a reader over it. A program takes the
	// terminal into raw mode by its descriptor, and it looks for the
	// descriptor on what it was handed — so a wrapper that hid one would
	// leave the terminal in cooked mode, where a line only arrives on enter,
	// where the terminal echoes it, and where Ctrl-C is a signal that kills
	// the process rather than a key that ends a turn.
	*os.File

	quit func()
}

func (e ended) Read(p []byte) (int, error) {
	n, err := e.File.Read(p)
	if errors.Is(err, io.EOF) {
		e.quit()
	}
	return n, err //nolint:wrapcheck // a reader's error is the reader's.
}

// endedFile is ended's counterpart for a descriptor [pollable] says cannot be
// handed over: the same "quit on EOF" behaviour, but as a bare reader, so the
// program never learns this input had a descriptor to begin with.
type endedFile struct {
	io.Reader
	quit func()
}

func (e endedFile) Read(p []byte) (int, error) {
	n, err := e.Reader.Read(p)
	if errors.Is(err, io.EOF) {
		e.quit()
	}
	return n, err //nolint:wrapcheck // a reader's error is the reader's.
}

// pollable is whether the operating system can watch this descriptor for
// readiness rather than fabricate it: a terminal or a pipe say so honestly, but
// a plain file and the null device report readiness without meaning it, and
// asking the OS to watch one for it fails outright rather than degrading. That
// failure is the program's to avoid, not the input's to surface, so this is
// checked before the descriptor is ever handed over.
func pollable(file *os.File) bool {
	if term.IsTerminal(file.Fd()) {
		return true
	}
	info, err := file.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&(os.ModeNamedPipe|os.ModeSocket) != 0
}

// newConsole builds the interactive program, and the interface behind it.
func NewConsole(ctx context.Context, backend Control, in io.Reader, out io.Writer, opts ...Option) (*tea.Program, *Console, error) {
	look, keys := theme.Default(theme.Dark), keymap.Default()
	for _, opt := range opts {
		opt(&look, &keys)
	}

	// A prompt of several lines rather than one.
	input := textarea.New()
	input.Placeholder = look.Symbols.Placeholder
	// The mark goes on the first line only, and the rest are indented under it.
	// Repeated down the side it stops meaning "here is the prompt" and starts
	// meaning "here is another one" — five lines of one thought would read as
	// five things about to be sent.
	input.SetPromptFunc(promptMark, func(line textarea.PromptInfo) string {
		if line.LineNumber == 0 {
			return look.Symbols.Prompt
		}
		return "  "
	})
	input.DynamicHeight = true
	input.MinHeight = 1
	input.MaxHeight = look.Layout.PromptRows
	// Line numbers belong to an editor. This is a prompt.
	input.ShowLineNumbers = false
	// Enter sends, so the newline is on the chord — see key. Terminals that
	// cannot report shift+enter report alt+enter, and the ones that can report
	// both.
	input.KeyMap.InsertNewline.SetKeys(keys.Chords(keymap.Newline)...)
	input.SetStyles(inputStyles(look.Background))

	c := &Console{
		control: backend,
		ctx:     ctx,
		input:   input,
		spin:    spinner.New(spinner.WithSpinner(spinnerFor(look))),
		pick:    randomPick,
		bg:      look.Background,
		styles:  newStyles(look),
		look:    look,
		keys:    keys,
	}

	// The Live area is given the console's own fold and the share of the clock the
	// Theme allows it. It reaches nothing else: see live.go.
	c.live = newLive(c.arriving, look.Layout.LiveShare)

	c.about = backend.About()

	// WithTiming because this is a screen a person reads: a turn may say how long
	// it took. The one-shot command asks for no such thing, because what it draws
	// a turn into is a script's input.
	renderer, err := render.New(c, c.look, render.WithTiming())
	if err != nil {
		return nil, nil, err
	}
	c.renderer = renderer

	// A size to draw at until the window reports its own. See initialWidth. The
	// fold is told the same width here rather than on a settle, because there is
	// no window to wait for yet and nothing kept to redraw.
	c.layout(initialWidth, initialHeight)
	c.reflow()

	// The program does not exist until the model does, and the reader has to
	// be able to end the program it is read by. The closure is what ties the
	// knot; it is called from the read loop, which the program starts.
	var program *tea.Program
	if file, isFile := in.(*os.File); isFile {
		quit := func() { program.Quit() }
		if pollable(file) {
			in = ended{File: file, quit: quit}
		} else {
			in = endedFile{Reader: file, quit: quit}
		}
	}
	// WithoutSignalHandler because the process surface owns being asked to
	// stop, and two owners is one too many. The library installs its own
	// handler by default and turns a signal into a message of its own, which
	// made the console's ability to stop cleanly a property of this dependency
	// rather than of Eva — true for the console, absent for the one-shot
	// command, and asserted nowhere.
	program = tea.NewProgram(c,
		tea.WithContext(ctx),
		tea.WithInput(in),
		tea.WithOutput(out),
		tea.WithoutSignalHandler(),
	)

	// Two supplies, one doorway. The Recorder publishes to the feed and the
	// turn tells the second what is arriving; both reach the interface as a
	// message from outside the update loop, and the interface keeps them apart
	// because they are different claims.
	backend.Watch(
		&feed{program: program},
		func(text string) { program.Send(chunk{text: text}) },
	)

	return program, c, nil
}

func (c *Console) Init() tea.Cmd {
	return tea.Batch(c.input.Focus(), tea.RequestBackgroundColor)
}

func (c *Console) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	c.drawnChrome = false

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		return c, c.resize(msg.Width, msg.Height)

	case resized:
		// Only the newest. A drag leaves one of these behind per column, and
		// every one but the last is an answer to a question about a window that
		// has since changed again.
		if msg.at == c.resizes {
			c.reflow()
		}
		return c, nil

	case tea.MouseWheelMsg:
		c.pane.wheel(msg)
		return c, nil

	case spinner.TickMsg:
		// Only while a Run is in flight. The spinner schedules its own next
		// tick from Update, so declining to forward one is what stops it — and
		// an interface that keeps redrawing at twelve frames a second with
		// nothing happening is one that never lets a terminal go idle.
		if !c.busy() {
			return c, nil
		}
		// What arrived since the last frame is composed here, once, however
		// many chunks that was. See the chunk case, and live.due.
		if c.live.due() {
			c.refresh()
		}
		// The caption rides on this tick rather than on a timer of its own. It
		// changes on a clock a hundred times slower, so all this costs is the
		// comparison — and it costs no second reason to wake the interface.
		if c.captionDue() {
			c.recaption()
		}
		var cmd tea.Cmd
		c.spin, cmd = c.spin.Update(msg)
		return c, cmd

	case tea.BackgroundColorMsg:
		return c, c.background(theme.BackgroundOf(msg.IsDark()))

	case tea.KeyPressMsg:
		return c, c.key(msg)

	case chunk:
		// Kept, not drawn — see live.write. Nothing can be lost by waiting: a
		// chunk only ever arrives while a Run is open, which is exactly when the
		// tick above is running.
		c.live.write(msg.text)
		return c, nil

	case committed:
		return c, c.fold(msg.event)

	case answered:
		return c, c.close(msg)

	case edited:
		return c, c.wrote(msg)
	}

	var cmd tea.Cmd
	c.input, cmd = c.input.Update(msg)
	return c, cmd
}

func (c *Console) View() tea.View {
	// Until a window has said how big it is there is no box to draw, and
	// guessing one means drawing it twice at two sizes.
	if c.width <= 0 {
		return tea.View{AltScreen: true, MouseMode: tea.MouseModeCellMotion}
	}

	view := tea.NewView(c.edges.frame(lipgloss.JoinVertical(lipgloss.Left,
		append([]string{c.pane.View()}, c.chrome()...)...)))
	view.AltScreen = true
	// Cell motion is the least that carries a wheel, which is the only mouse
	// event this uses. Anything more would take click and drag away from the
	// terminal, and with them a person's own way of selecting text.
	view.MouseMode = tea.MouseModeCellMotion
	return view
}

// How far the queued line is indented past the word that labels it, so that a
// prompt waiting behind a turn is cut to a width that leaves room for the label.
const queuedLabel = "queued: "

const promptMark = 2

// The size a console is built at, before a window has said what the real one
// is.
const (
	initialWidth  = 80
	initialHeight = 24
)

const resizeSettle = 80 * time.Millisecond

// resized says a window has stopped changing size. The count is which resize
// asked, so that the answer to an earlier one is ignored.
type resized struct{ at int }

func (c *Console) resize(width, height int) tea.Cmd {
	if width <= 0 {
		return nil
	}
	was := c.width
	c.layout(width, height)

	// Only a width change re-wraps anything. A window dragged taller reports a
	// new size on every row it passes through, and no answer wraps differently
	// for it.
	if was == width {
		return nil
	}

	c.resizes++
	at := c.resizes
	return tea.Tick(resizeSettle, func(time.Time) tea.Msg { return resized{at: at} })
}

func (c *Console) reflow() {
	if err := c.renderer.Width(c.width - gutterWidth); err != nil {
		c.blame(err)
	}
	c.live.stale()
	c.rewrap()
	c.refresh()
}

// layout fits the interface to the window, and draws nothing again that it does
// not have to.
func (c *Console) layout(width, height int) {
	if width <= 0 {
		return
	}
	c.edges = afford(c.look.Layout, width, height)
	c.width = width - c.edges.wide()
	c.height = height - c.edges.tall()

	// Everything below is fitted to c.width, which is the window less the margin.
	// Reading the window here instead is how the frame came out wider than the
	// terminal it was drawn in, with every row of it hanging two columns past the
	// right-hand edge.
	c.input.SetWidth(c.width - c.styles.box.GetHorizontalFrameSize())
	c.pane.SetWidth(c.width)
	// The wrapping style is built here rather than per line, because the live
	// area falls back on it per frame and a style allocated in that path is an
	// allocation per frame for a width that did not change.
	c.wrapStyle = lipgloss.NewStyle().Width(c.width - gutterWidth)
	c.fit()
	c.refresh()
}

// fit gives the pane the rows the chrome does not take.
func (c *Console) fit() {
	if c.width <= 0 || c.height <= 0 {
		return
	}

	// The chrome is drawn again here, whatever was drawn before. Fitting happens
	// exactly when the chrome may have changed shape — a keystroke that grew the
	// prompt, a window that changed size, a turn that closed and took the status
	// line's second row with it — and measuring the one drawn before that would
	// give the pane the rows the last shape left it.
	c.drawnChrome = false

	left := c.height - rows(c.chrome())
	if left < 1 {
		// A window with no room for a transcript still gets one row of it. A
		// pane of no height draws nothing at all, which leaves a person a
		// prompt and no evidence that anything was ever answered — worse than a
		// view that overruns a window nobody can read anyway.
		left = 1
	}

	// A pane that was showing the end goes on showing it. Growing the prompt
	// under a person who is typing must not scroll the answer they are typing
	// about off the top.
	follow := c.pane.AtBottom()
	c.pane.SetHeight(left)
	if follow {
		c.pane.GotoBottom()
		return
	}
	// Setting the height does not move the offset, so a pane that shrank can be
	// left scrolled past the end of what it holds. Re-offering the offset is
	// what clamps it.
	c.pane.SetYOffset(c.pane.YOffset())
}

// arriving is the answer so far, folded and written past Eva's mark. It is what
// the Live area is given at build, and the whole of what that module reaches of
// this one.
func (c *Console) arriving(text string) []string {
	return c.gutterLines(c.folded(text), evaVoice)
}

func (c *Console) folded(text string) string {
	drawn, err := c.renderer.Arriving(text)
	if err != nil {
		return c.wrap(text)
	}
	return trimBlank(drawn)
}

func (c *Console) wrap(text string) string {
	if c.width-gutterWidth <= 0 {
		return text
	}
	return c.wrapStyle.Render(text)
}

func (c *Console) chrome() []string {
	if c.drawnChrome && c.chromeAt == c.refreshes {
		return c.pieces
	}
	c.pieces = c.composeChrome()
	c.drawnChrome = true
	c.chromeAt = c.refreshes
	return c.pieces
}

func (c *Console) composeChrome() []string {
	list := c.palette.view(c.input.Value(), c.styles, c.look.Symbols.Prompt)
	prompt, footer, queued := c.prompt(), c.footer(), c.queuedLine()

	// One row is kept back for the pane throughout: a view with no transcript at
	// all is a view that cannot show what it just answered.
	for _, shed := range []*string{&list, &queued, &footer} {
		pieces := stacked(list, prompt, footer, queued)
		if c.height <= 0 || rows(pieces)+1 <= c.height {
			return pieces
		}
		*shed = ""
	}
	return stacked(list, prompt, footer, queued)
}

func stacked(pieces ...string) []string {
	out := make([]string, 0, len(pieces))
	for _, piece := range pieces {
		if piece != "" {
			out = append(out, piece)
		}
	}
	return out
}

func rows(pieces []string) int {
	total := 0
	for _, piece := range pieces {
		total += lipgloss.Height(piece)
	}
	return total
}

func (c *Console) prompt() string {
	return c.styles.box.Width(c.width - c.styles.box.GetHorizontalFrameSize()).Render(c.input.View())
}

// status is what the row under the prompt says at its near end: that Eva is
// waiting for a person, that it is about to be left, or that a turn is running
// and for how long.
func (c *Console) status() string {
	if c.leaving {
		return c.styles.hint.Render("press ctrl+c again to leave — any other key stays")
	}
	if !c.busy() {
		return c.styles.hint.Render("ready")
	}

	return c.styles.spin.Render(c.spin.View()) + " " +
		c.styles.hint.Render(c.caption+" "+time.Since(c.since).Round(time.Second).String()+" — ctrl+c to interrupt")
}

// queuedLine is the prompt waiting behind the turn in flight, and is empty when
// there is none.
func (c *Console) queuedLine() string {
	if c.shown.waiting() == "" {
		return ""
	}
	return c.styles.hint.Render(queuedLabel +
		oneLine(c.shown.waiting(), c.width-lipgloss.Width(queuedLabel), c.look.Symbols.Truncation))
}

func oneLine(s string, room int, ellipsis string) string {
	s = strings.Join(strings.Fields(s), " ")
	if room < 1 {
		return ""
	}

	runes := []rune(s)
	if len(runes) <= room {
		return s
	}
	return string(runes[:room-1]) + ellipsis
}

func (c *Console) refresh() {
	// Lines rather than one piece of text, all the way to the pane. What a
	// frame is is a list of rows, most of which were drawn on an earlier frame
	// and are handed on by reference — see block.lines. Joining them into a
	// string would copy the whole transcript for the sake of a shape nothing
	// downstream wants.
	lines := make([]string, 0, c.rowsLastFrame)

	// The masthead leads the transcript and scrolls away with it. It is
	// composed here rather than kept as a block because it is not one: it is
	// drawn from facts that do not change and a model name that can, so
	// composing it per frame is what keeps it true after /model without a
	// second thing to remember to update.
	if head := c.masthead(); head != "" {
		lines = append(lines, strings.Split(head, "\n")...)
		lines = append(lines, "")
	}

	lines = append(lines, c.composed(c.transcript)...)

	// The turn still arriving is drawn as a block like any other, so that it is
	// spaced off the block above it exactly as the kept turn that replaces it
	// will be. A person watching one become the other should see nothing move,
	// and the gap is part of that.
	if arriving := c.live.rows(); len(arriving) > 0 {
		if len(c.transcript) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, arriving...)
	}

	// A trailing blank row is a row of the pane spent on nothing. The blocks
	// arrive trimmed, so this is only ever the gap this function added above a
	// transcript that turned out to be empty.
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	c.rowsLastFrame = len(lines)
	c.refreshes++

	follow := c.pane.AtBottom()
	c.pane.SetContent(lines)
	if follow {
		c.pane.GotoBottom()
	}

	c.shown.show(lines)
}

func (c *Console) Screen() string { return c.shown.frame() }

func (c *Console) footer() string {
	model := c.control.Model()
	if c.width <= 0 || lipgloss.Width(model) >= c.width {
		return ""
	}

	// What is happening, at the near end. What the Session has cost and what is
	// answering, at the far end.
	left := c.status()
	right := model
	if spent := c.renderer.Session(); spent != "" {
		right = spent + " · " + model
	}

	// What does not fit is given up in an order of need: the cost, then how much is
	// below, then the model, and last of all what is happening. The model goes
	// before the status because a person can ask for it — a bare /model reports
	// without switching — and nothing can be asked for the spinner and the elapsed
	// figure. They are only true now.
	behind := c.behind()
	for _, shed := range []*string{&right, &behind, &right, &left} {
		if gap := c.width - lipgloss.Width(left) - lipgloss.Width(behind+right); gap >= 1 {
			// The left is styled already — the spinner is not drawn in the grey
			// the words beside it are — so only the right is styled here.
			return left + strings.Repeat(" ", gap) + c.styles.hint.Render(behind+right)
		}
		if shed == &right && *shed != model {
			// The cost goes first and the model stays, rather than the pair going.
			*shed = model
			continue
		}
		*shed = ""
	}
	return left
}

func (c *Console) behind() string {
	if c.pane.AtBottom() {
		return ""
	}
	rows := c.pane.TotalLineCount() - c.pane.YOffset() - c.pane.Height()
	if rows < 1 {
		return ""
	}
	return "↓ " + strconv.Itoa(rows) + " more · " + c.keys.Chord(keymap.Follow) + " to follow"
}

// busy reports whether a Run is in flight.
func (c *Console) busy() bool { return c.shown.busy() }

// Busy reports whether a Run is in flight, for whoever is driving this program
// rather than typing at it.
func (c *Console) Busy() bool { return c.shown.busy() }

// Queued is the prompt waiting behind the turn in flight, and is empty when
// there is none.
func (c *Console) Queued() string { return c.shown.waiting() }

// Wait returns once no Run is still committing.
func (c *Console) Wait() { c.running.Wait() }

// stop ends the Run in flight, if there is one.
func (c *Console) stop() {
	if cancel := c.shown.release(); cancel != nil {
		cancel()
	}
}

// interrupt ends the Run in flight without forgetting it.
func (c *Console) interrupt() {
	if cancel := c.shown.holding(); cancel != nil {
		cancel()
	}
}

func (c *Console) background(bg theme.Background) tea.Cmd {
	if bg == c.bg {
		return nil
	}
	c.bg = bg
	c.look = c.look.For(bg)
	c.styles = newStyles(c.look)
	// Re-read rather than assumed to have survived. The Theme is rebuilt here, so
	// a second copy of anything it holds is a second copy that can disagree with
	// it.
	c.live.share = c.look.Layout.LiveShare

	c.input.SetStyles(inputStyles(bg))
	c.restyle()

	if err := c.renderer.Background(bg); err != nil {
		c.blame(err)
	}
	c.refresh()
	return nil
}

func (c *Console) key(k tea.KeyPressMsg) tea.Cmd {
	pressed := k.String()

	// The prompt is as tall as what it holds, so any key can change how many
	// rows the chrome takes: a newline grows it, a backspace gives a row back,
	// sending empties it. The pane is refitted on the way out rather than at
	// each of the places below that might have caused it, because the one that
	// gets forgotten is the one where the prompt grows past the bottom of the
	// window and takes the line being typed with it.
	defer c.fit()

	// Anything but a second interrupt withdraws the question the first one
	// asked. A person who went on typing has answered it.
	if c.leaving && !c.keys.Is(pressed, keymap.Interrupt) {
		c.leaving = false
	}

	// The list, while it is open, is what the movement keys and enter mean. It is
	// the one modal thing in this interface, and it is modal for the length of one
	// decision: a person looking at a list of commands is choosing from it, and
	// the same keys walking the list and moving a cursor would do neither well.
	if c.palette.open {
		if cmd, answered := c.choosing(pressed, k); answered {
			return cmd
		}
	}

	if c.completing(pressed) {
		return nil
	}

	if c.scroll(pressed) {
		return nil
	}

	action, bound := c.keys.Action(pressed)
	if !bound {
		return c.typed(k)
	}
	if cmd, answered := c.act(action); answered {
		return cmd
	}

	// A key the interface has an action for and did not act on is typing, and
	// typing ends a recall: what is in the prompt is now this person's sentence
	// rather than a place in the list of their old ones.
	c.past.done()
	return c.typed(k)
}

// completing offers the next command. Any other key means the person is writing
// rather than choosing, so the next offer starts from what is there.
func (c *Console) completing(pressed string) bool {
	if c.keys.Is(pressed, keymap.Complete) {
		c.complete()
		return true
	}
	c.palette.typing()
	return false
}

// act runs the action a key is bound to, and says whether it acted. A false
// answer means the key belongs to the prompt after all.
func (c *Console) act(action keymap.Action) (tea.Cmd, bool) {
	switch action {
	case keymap.Interrupt:
		return c.interrupting(), true

	case keymap.Leave:
		c.stop()
		return tea.Quit, true

	case keymap.Palette:
		c.openPalette()
		return nil, true

	case keymap.Editor:
		return c.openEditor(), true

	case keymap.HistoryBack:
		return c.recallBack()

	case keymap.HistoryForward:
		return c.recallForward()

	case keymap.Submit:
		return c.submitted(), true
	}
	return nil, false
}

func (c *Console) interrupting() tea.Cmd {
	// During a turn this cancels it and gives the prompt back, rather than
	// ending the Session. A long wrong answer should cost seconds, and the
	// Session is a fold over what was committed — so the part of the answer
	// that did arrive is part of the transcript, and the next turn is
	// conditioned on it.
	if c.busy() {
		c.interrupted = true
		c.interrupt()
		return nil
	}

	// Idle, it asks first. A Session is an hour of somebody's work by the time
	// it is worth keeping, and one key next to the one that interrupts a turn
	// should not be able to end it. ctrl+d stays a single press, because nobody
	// types it by accident.
	if !c.leaving {
		c.leaving = true
		return nil
	}
	return tea.Quit
}

// recallBack walks back through the prompts already sent, and only from the
// first row. Anywhere else the key belongs to the prompt, which has a line
// above the cursor to move to — a recall that took it would make a prompt of
// ten lines uneditable.
func (c *Console) recallBack() (tea.Cmd, bool) {
	if c.input.Line() > 0 {
		return nil, false
	}
	if was, there := c.past.back(c.input.Value()); there {
		c.input.SetValue(was)
		c.input.MoveToEnd()
	}
	return nil, true
}

func (c *Console) recallForward() (tea.Cmd, bool) {
	if c.input.Line() < c.input.LineCount()-1 {
		return nil, false
	}
	if next, there := c.past.forward(); there {
		c.input.SetValue(next)
		c.input.MoveToEnd()
	}
	return nil, true
}

func (c *Console) submitted() tea.Cmd {
	prompt := strings.TrimSpace(c.input.Value())
	if prompt == "" {
		return nil
	}
	c.input.Reset()
	c.past.remember(prompt)
	c.palette.hide()

	// A turn is already running, so this one waits rather than being lost. It is
	// echoed when it is sent rather than now, so that the transcript reads in
	// the order the turns happened.
	if c.busy() {
		c.shown.queue(prompt)
		return nil
	}
	return c.send(prompt)
}

func (c *Console) typed(k tea.KeyPressMsg) tea.Cmd {
	var cmd tea.Cmd
	c.input, cmd = c.input.Update(k)
	return cmd
}

func (c *Console) choosing(pressed string, k tea.KeyPressMsg) (tea.Cmd, bool) {
	switch {
	case c.keys.Is(pressed, keymap.HistoryBack):
		c.palette.walk(-1, c.input.Value())
		return nil, true
	case c.keys.Is(pressed, keymap.HistoryForward):
		c.palette.walk(1, c.input.Value())
		return nil, true
	case c.keys.Is(pressed, keymap.Submit), c.keys.Is(pressed, keymap.Complete):
		c.chosen()
		return nil, true
	case c.keys.Is(pressed, keymap.Palette), c.keys.Is(pressed, keymap.Interrupt):
		// The key that opened it closes it, and so does the key that stops
		// anything else. A person who opened a list they did not want should not
		// have to work out which of the two ends it.
		c.palette.hide()
		return nil, true
	}

	// Anything else narrows the list. The chosen row is clamped, because the
	// filter may have left fewer matches than the row a person was on.
	var cmd tea.Cmd
	c.input, cmd = c.input.Update(k)
	c.palette.clamp(c.input.Value())
	return cmd, true
}

func (c *Console) openPalette() {
	c.palette.show()
	if c.input.Value() == "" {
		c.input.SetValue("/")
		c.input.MoveToEnd()
	}
}

func (c *Console) chosen() {
	if filled, there := c.palette.chosen(c.input.Value()); there {
		c.input.SetValue(filled)
		c.input.MoveToEnd()
	}
	c.palette.hide()
}

// complete fills the prompt in from the command list, and leaves it alone when
// there is nothing to fill in.
func (c *Console) complete() {
	if filled, there := c.palette.fill(c.input.Value()); there {
		c.input.SetValue(filled)
	}
}

func (c *Console) openEditor() tea.Cmd {
	editor := c.control.Editor()
	if editor.Command == "" {
		c.put(c.styles.hint.Render("no editor is set — export EDITOR, or write editor in your configuration"))
		return nil
	}
	return c.edit(editor, c.input.Value())
}

func (c *Console) send(prompt string) tea.Cmd {
	c.keep(block{text: c.styles.said.Render(prompt), voice: personVoice})

	// A slash is a person addressing eva rather than the model, and what it
	// asks for happens here: no Run opens, nothing is committed, and the
	// Trace holds no record of a turn that never ran.
	if strings.HasPrefix(prompt, "/") {
		// A command with nothing to say puts nothing. /clear is the one, and
		// an empty block would be a blank line sitting where it had just
		// finished taking every other line away.
		if said := c.obey(prompt); said != "" {
			c.put(said)
		}
		return nil
	}
	return c.start(prompt)
}

func (c *Console) scroll(pressed string) bool {
	action, bound := c.keys.Action(pressed)
	if !bound {
		return false
	}

	switch action {
	case keymap.PageUp:
		c.pane.PageUp()
	case keymap.PageDown:
		c.pane.PageDown()
	case keymap.ScrollUp:
		c.pane.ScrollUp(1)
	case keymap.ScrollDown:
		c.pane.ScrollDown(1)
	case keymap.Top:
		c.pane.GotoTop()
	case keymap.Follow:
		c.pane.GotoBottom()
	default:
		return false
	}
	return true
}

func (c *Console) start(prompt string) tea.Cmd {
	ctx, cancel := context.WithCancel(c.ctx)
	c.shown.hold(cancel)

	c.live.forget()
	c.since = time.Now()
	c.interrupted = false
	c.recaption()
	c.running.Add(1)

	turn := func() tea.Msg {
		defer c.running.Done()
		defer cancel()

		outcome, err := c.control.Answer(ctx, prompt)
		return answered{outcome: outcome, err: err}
	}

	// The spinner is started here rather than at Init, so that it turns only
	// while there is something to wait for. It stops on its own: see the tick
	// in Update.
	return tea.Batch(turn, c.spin.Tick)
}

func (c *Console) fold(e events.Event) tea.Cmd {
	if err := c.renderer.Committed(c.ctx, e); err != nil {
		c.blame(err)
	}
	return nil
}

func (c *Console) close(a answered) tea.Cmd {
	c.stop()

	// Show has already erased this for a turn that produced one. This is the
	// turn that did not: interrupted before a word arrived, or broken partway
	// through. What arrived is dropped rather than kept, because it is not a
	// record — and the pane is recomposed, because a reset nothing redraws is a
	// reset nobody sees.
	c.live.forget()
	c.refresh()

	// A turn that did not answer says so in one line, and the line names the
	// class of failure without quoting the thing that failed.
	if a.outcome.Result != events.ResultDone {
		if c.interrupted {
			// Interruption keeps the subdued grey. It is not a failure to be found
			// on a screen — it is the thing the person just did, and they were
			// looking at the key while they did it.
			c.put(c.styles.hint.Render("interrupted"))
		} else {
			c.put(c.styles.failure.Render(render.Unanswered(a.outcome.Class)))
		}

		// Then what that means on this machine, and the one step that follows.
		if !c.interrupted {
			if next := c.control.Remedy(a.outcome.Class).Said(); next != "" {
				c.put(c.styles.failure.Render(next))
			}
		}
	}

	// An error is not an Outcome. It is the record failing, which is the one
	// thing a person cannot be shown from the Trace.
	if a.err != nil {
		c.blame(a.err)
	}

	// The status line has lost the turn it was reporting, and with it the row
	// that was holding a queued prompt. The pane takes back what they were using
	// before either is drawn again.
	next := c.shown.queue("")
	c.fit()

	if next == "" {
		return c.input.Focus()
	}
	return tea.Batch(c.input.Focus(), c.send(next))
}

func (c *Console) empty() {
	c.control.Clear()
	c.renderer.Cleared()

	// Back to the top before the content goes, so that a person who had scrolled
	// up is not left at an offset into a transcript that no longer reaches that
	// far.
	c.transcript = nil
	c.pane.GotoTop()
	c.refresh()
}

// put adds a block to the transcript, which is what a person keeps.
func (c *Console) put(text string) {
	c.keep(block{text: text, voice: asideVoice})
}

func (c *Console) keep(b block) {
	b.text = trimBlank(b.text)
	c.transcript = append(c.transcript, b)
	c.refresh()
}

func trimBlank(text string) string {
	lines := strings.Split(text, "\n")
	// Measured rather than compared to the empty string: a line the fold left
	// behind can be a reset escape and nothing else, which reads as blank and
	// is not.
	for len(lines) > 0 && lipgloss.Width(lines[0]) == 0 {
		lines = lines[1:]
	}
	for len(lines) > 0 && lipgloss.Width(lines[len(lines)-1]) == 0 {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}

func (c *Console) kept() string { return c.compose(c.transcript) }

func (c *Console) compose(blocks []block) string {
	return strings.Join(c.composed(blocks), "\n")
}

func (c *Console) composed(blocks []block) []string {
	lines := make([]string, 0, c.rowsLastFrame)
	for i := range blocks {
		if i > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, c.drawn(&blocks[i])...)
	}
	return lines
}

func (c *Console) drawn(b *block) []string {
	if b.lines == nil {
		b.lines = c.gutterLines(b.text, b.voice)
	}
	return b.lines
}

// restyle drops every drawing, so that the next frame makes them again.
func (c *Console) restyle() {
	for i := range c.transcript {
		c.transcript[i].lines = nil
	}
	c.live.stale()
}

func (c *Console) gutter(text string, v voice) string {
	return strings.Join(c.gutterLines(text, v), "\n")
}

func (c *Console) gutterLines(text string, v voice) []string {
	edge := strings.Repeat(" ", gutterWidth)
	switch v {
	case personVoice:
		edge = c.styles.person.Render(mark) + " "
	case evaVoice:
		edge = c.styles.eva.Render(mark) + " "
	case asideVoice:
	}

	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = edge + line
	}
	return lines
}

func (c *Console) rewrap() {
	drawn, err := c.renderer.Kept()
	if err != nil {
		c.blame(err)
		return
	}

	at := 0
	for i, b := range c.transcript {
		if b.voice != evaVoice {
			continue
		}
		if at >= len(drawn) {
			// The fold holds fewer turns than the transcript shows, which is
			// what /clear leaves behind for exactly as long as it takes the
			// pane to be emptied too. Nothing to redraw them from, so they
			// stay as they are.
			break
		}
		c.transcript[i].text = trimBlank(drawn[at])
		c.transcript[i].lines = nil
		at++
	}
}

// blame queues a failure to go above the view, in the interface's own voice.
// A console that swallowed one would leave a person waiting at a prompt for a
// turn that is not coming.
func (c *Console) blame(err error) {
	c.put(c.styles.failure.Render("eva: " + err.Error()))
}

func (c *Console) Show(turn string) error {
	// The live area is erased by the thing that replaces it, here, rather than
	// a moment later when the Run is closed. The two are not the same instant:
	// the rendered turn arrives with the record that closes the Run, and the
	// Run's own closing reaches this model as a separate message afterwards.
	c.live.forget()
	c.keep(block{text: turn, voice: evaVoice})
	return nil
}

var _ render.Screen = (*Console)(nil)

// Option is what a caller says about how this console looks and what its keys
// do. A caller that says nothing gets the complete defaults.
type Option func(*theme.Theme, *keymap.Keymap)

func WithTheme(look theme.Theme) Option {
	return func(t *theme.Theme, _ *keymap.Keymap) { *t = look }
}

func WithKeymap(keys keymap.Keymap) Option {
	return func(_ *theme.Theme, k *keymap.Keymap) { *k = keys }
}

func spinnerFor(look theme.Theme) spinner.Spinner {
	switch look.Symbols.Spinner {
	case theme.SpinnerDot:
		return spinner.Dot
	case theme.SpinnerLine:
		return spinner.Line
	case theme.SpinnerPulse:
		return spinner.Pulse
	case theme.SpinnerPoints:
		return spinner.Points
	default:
		return spinner.MiniDot
	}
}
