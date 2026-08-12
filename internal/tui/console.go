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
	"charm.land/bubbles/v2/viewport"
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
//
// It consumes and it does not drive. The core loop runs the turn and the
// Recorder publishes what it committed; those Events reach this model from
// outside its own update loop, sent in by the feed below. That is what keeps
// the interface a consumer rather than the architecture — it holds no
// Provider, no Recorder, and no way to reach the Trace, so it cannot show a
// turn the record does not hold.
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

	// arriving is the open Run's answer as it streams, and it is what the
	// live area shows. The rendered turn that replaces it comes from the
	// Renderer, once the Run has closed — a heading, a list, and a fenced
	// block are each only meaningful once they are complete.
	arriving strings.Builder

	// transcript is what has been kept: every rendered turn, every prompt
	// echoed back, and every command answered, in the order they happened. It
	// holds no arriving text — see refresh — so nothing in it came from
	// anywhere but a committed record or a person's own keystroke.
	//
	// Blocks rather than one string, because a window that changes size has to
	// be able to replace the turns without disturbing what a person typed
	// between them. See rewrap.
	transcript []block

	// pane is the window onto the transcript. It scrolls, so the transcript is
	// not truncated to fit; what a person sees is a position in it.
	pane viewport.Model

	// screen is what refresh last composed, and shown guards it. It is read
	// from outside the update loop by whoever is driving the program — see
	// Screen — and written inside it, so the two need to agree on a lock.
	shown  sync.Mutex
	screen string
	// cancel ends the Run in flight, and is nil when there is none. It is
	// under the same lock as the screen because it answers the same question
	// from two sides: the update loop asks whether a turn is running, and
	// whoever is driving the program asks from outside it. Two fields for one
	// fact were two things to keep in step, and nothing made them.
	cancel context.CancelFunc

	// running counts the Runs whose goroutine has not returned. The process
	// waits on it before it closes the sink, because a Run that is still
	// committing when its Trace closes is the one failure the project has no
	// instrument to detect.
	running sync.WaitGroup

	// width and height are the window's, and are zero until the program reports
	// them. The width is what the footer puts the model at the far end of and
	// what the answer is wrapped to; the height is kept because the pane's own
	// height is the remainder after the chrome, and the chrome does not have one
	// fixed size — see fit.
	width  int
	height int

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

	// queued is the prompt typed while a turn was still running, and is sent
	// when that turn closes. Only one is held: a person who types a second has
	// changed their mind about the first, and a console that ran both would be
	// answering a question nobody has read the answer to yet.
	//
	// It is written under the same lock as the two fields beside it, because it
	// is read from outside the update loop for the same reason: see Queued.
	queued string

	// leaving is whether an idle ctrl+c has already asked. One key should not
	// end a Session that took an hour to build, and the second press is the
	// answer to the question the first one puts on screen.
	leaving bool

	// pending is whether chunks have arrived that the pane has not been given
	// yet. See the chunk case in Update for why they wait.
	pending bool

	// interrupted is whether this console stopped the Run in flight. It is the
	// console's own act rather than a reading of the claim that closed the Run,
	// which is why it is remembered rather than worked out: a person who pressed
	// ctrl+c is owed the word for what they did, and every other way a turn ends
	// without an answer is owed the same short line as the rest.
	interrupted bool

	// completing is what had been typed before tab began filling it in, and
	// completed is how far through the matches that is. Both are held because
	// a second tab has to offer the next match rather than start again from
	// what the first one wrote. See complete.
	completing string
	completed  int

	// dark is what the terminal answered when it was asked what colour it is.
	// It starts at the assumption and is corrected by the answer.
	dark   bool
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
	// spin is the one thing here that is not subdued. A faint spinner is a
	// spinner nobody can see moving, and its whole job is to be seen moving.
	spin lipgloss.Style
	// box is the rule above and below the prompt. It is drawn in the same grey
	// as everything else here, because a border is the least of what is on
	// screen.
	//
	// Two rules rather than four sides: the prompt is a band across the window,
	// not an object sitting in it. Sides would draw a container around a line
	// of text that already runs the width of the screen, and the corners would
	// be the most emphatic thing in an interface whose subject is the answer
	// above them.
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

// inputStyles are the prompt's own: the library's, with the band of colour it
// paints behind the line the cursor is on taken out.
//
// A cursor-line highlight belongs to an editor, where it marks your place on a
// page of many lines. The prompt is one band across the bottom of the screen and
// there is nowhere else the cursor could be, so the highlight marks nothing —
// what it does instead is put a dark block under the one part of the screen a
// person is looking at while they type, and hold it there the whole time.
func inputStyles(dark bool) textarea.Styles {
	s := textarea.DefaultStyles(dark)
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
		hint: subdued,
		spin: spinStyle(look),
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

// block is one thing in the transcript, and whose it is.
//
// A turn can be drawn again at another width, because the fold still holds the
// markdown it came from. Everything else — a prompt echoed back, a command's
// answer, a failure in the interface's own voice — is a line or two of text that
// was never wrapped to anything, so there is nothing to redo.
type block struct {
	text  string
	voice voice
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
//
// Two columns for everything, and that is the whole point of it. Someone
// scrolling back through a conversation is looking for where their own questions
// were, and what makes that easy is one straight edge down the left with the
// colour of the mark changing against it. An answer inset by one amount and a
// prompt by another gives them two ragged edges and no colour worth reading.
//
// It is also why the fold no longer indents a document for itself. Two owners of
// one inset is how an answer ends up in a different column from the text that
// arrived a moment earlier as the same answer.
const gutterWidth = 2

// mark is what stands in the gutter, and is a left half block rather than a
// pipe: at one column it has to read as a band rather than as punctuation.
const mark = "▌"

// committed carries one committed Event into the update loop from outside it.
type committed struct{ event events.Event }

// chunk carries one piece of an answer into the update loop ahead of the
// record of it. It is what the live area is made of, and it is never what a
// turn leaves behind — see loop.Loop.Arriving.
type chunk struct{ text string }

// answered says a Run has closed, whatever it claimed.
type answered struct {
	outcome core.Outcome
	err     error
}

// feed carries committed Events to the interface.
//
// It is a Subscriber, so what it carries is what the Trace holds rather than
// what a producer sent, and it carries it after the commit rather than before.
// The program's own doorway for messages from other goroutines is what it
// sends through, which is the whole of the coupling between the core loop and
// the interface: one direction, one message type, and nothing shared.
type feed struct{ program *tea.Program }

var _ core.Subscriber = (*feed)(nil)

// Committed sends one Event to the interface.
//
// It cannot fail. A program that has ended takes no more messages and says so
// by returning, and a turn that is still committing to the Trace is doing the
// thing that matters whether or not anyone is watching.
func (f *feed) Committed(_ context.Context, e events.Event) error {
	f.program.Send(committed{event: e})
	return nil
}

// ended is an input stream, plus the end of it.
//
// A console reads keys until there are none left. Nothing in the program says
// an input stream has ended — it is a reader, and a reader that returns EOF
// simply stops being read — so `eva` with its input closed would sit at a
// prompt nobody can type at. This is what closes it, and it is why `eva` in a
// script exits rather than hangs.
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
//
// The streams are parameters rather than the process's own, so that the
// interface can run with its input disabled and its output redirected. That is
// what lets the interactive path be tested with no terminal attached: keys
// arrive as messages, Events arrive as messages, and what a person would have
// read lands in a buffer.
//
// It starts styled for a dark terminal, which is what an unknown terminal is
// assumed to be, and asks the real one as its first act. The answer arrives as
// a message rather than as a return value, because asking is a sequence
// written to the terminal and read back — and the program owns the terminal
// from the moment it starts. Asking beside it would mean two readers of one
// input, and the one that is not the program wins the keystrokes it should not
// have seen.
func NewConsole(ctx context.Context, backend Control, in io.Reader, out io.Writer, opts ...Option) (*tea.Program, *Console, error) {
	look, keys := theme.Default(true), keymap.Default()
	for _, opt := range opts {
		opt(&look, &keys)
	}

	// A prompt of several lines rather than one.
	//
	// A person writing to a model writes paragraphs, pastes a stack trace, and
	// sketches a list. A single-line field takes all of that and scrolls it
	// sideways past a fixed window, so what they are about to send is the one
	// thing they cannot read. This grows instead, to a bound: past ten rows the
	// prompt would be eating the answer it is about to ask about, and from there
	// it scrolls within itself.
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
	input.SetStyles(inputStyles(true))

	c := &Console{
		control: backend,
		ctx:     ctx,
		input:   input,
		spin:    spinner.New(spinner.WithSpinner(spinnerFor(look))),
		pane:    viewport.New(),
		pick:    randomPick,
		dark:    look.Dark,
		styles:  newStyles(look),
		look:    look,
		keys:    keys,
	}

	c.about = backend.About()

	// The pane is given no bindings of its own. Its defaults are a pager's — j,
	// k, space, f, b, u, d — and every one of them is a character somebody types
	// into a prompt. What scrolls this pane is the set in scroll, and holding
	// none here is what keeps that the whole set.
	c.pane.KeyMap = viewport.KeyMap{}
	// The pane does not wrap for itself, and refresh wraps what needs it before
	// handing it over. Asking the pane costs a pass over the whole transcript
	// on every frame, because a soft-wrapped pane cannot know which line an
	// offset lands on without measuring every line above it — and a turn that
	// streams in six thousand chunks redraws six thousand times. That is the
	// difference between a long answer arriving in ten seconds and in thirty.
	c.pane.SoftWrap = false

	renderer, err := render.New(c, c.look)
	if err != nil {
		return nil, nil, err
	}
	c.renderer = renderer

	// A size to draw at until the window reports its own. See initialWidth.
	c.layout(initialWidth, initialHeight)

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
	// command, and asserted nowhere. What arrives here instead is the cancelled
	// Context, which is the same thing every layer below already acts on.
	//
	// Ctrl-C is untouched by this. A terminal in raw mode delivers it as a key
	// rather than as a signal, which is why it ends a turn instead of the
	// process, and no handler on either side is involved in that.
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

// Init focuses the prompt and asks the terminal what colour it is.
//
// It says nothing else. A console that opened by listing its own keys would be
// spending the first thing a person reads on the interface rather than on their
// work — and the screen already answers it: the status line says ready, the
// footer says which model, and /help lists the commands for whoever wants them.
func (c *Console) Init() tea.Cmd {
	return tea.Batch(c.input.Focus(), tea.RequestBackgroundColor)
}

// Update folds one message into the interface.
func (c *Console) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		c.layout(msg.Width, msg.Height)

	case tea.MouseWheelMsg:
		var cmd tea.Cmd
		c.pane, cmd = c.pane.Update(msg)
		return c, cmd

	case spinner.TickMsg:
		// Only while a Run is in flight. The spinner schedules its own next
		// tick from Update, so declining to forward one is what stops it — and
		// an interface that keeps redrawing at twelve frames a second with
		// nothing happening is one that never lets a terminal go idle.
		if !c.busy() {
			return c, nil
		}
		// What arrived since the last frame is composed here, once, however
		// many chunks that was. See the chunk case.
		if c.pending {
			c.pending = false
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
		return c, c.background(msg.IsDark())

	case tea.KeyPressMsg:
		return c, c.key(msg)

	case chunk:
		// Kept, not drawn. A chunk is a few tokens and they arrive in their
		// thousands, while a screen is redrawn tens of times a second at most —
		// so composing the pane on every one is work thrown away between
		// frames, and it is work proportional to the whole transcript each
		// time. The tick below draws what has piled up. Nothing can be lost by
		// waiting: a chunk only ever arrives while a Run is open, which is
		// exactly when that tick is running.
		c.arriving.WriteString(msg.text)
		c.pending = true
		return c, nil

	case committed:
		return c, c.fold(msg.event)

	case answered:
		return c, c.close(msg)
	}

	var cmd tea.Cmd
	c.input, cmd = c.input.Update(msg)
	return c, cmd
}

// View is the whole window: the transcript in a pane, the line that says
// whether a turn is running, the prompt under it, and the footer.
//
// The turns already answered are in the pane rather than in the terminal's
// scrollback. What a transcript this program holds risks becoming is a second
// account of the conversation, and what prevents that is not where the bytes are
// drawn but who is allowed to write them: the pane has three writers — a fold
// over committed records, a prompt echoed back, and a command answering — and
// none of the three can invent a turn. What it buys is the three things a block
// handed to the terminal can never be again — re-wrapped when the window
// changes, scrolled to under the program's own control, and taken away when a
// person empties the transcript.
func (c *Console) View() tea.View {
	// Until a window has said how big it is there is no box to draw, and
	// guessing one means drawing it twice at two sizes.
	if c.width <= 0 {
		return tea.View{AltScreen: true, MouseMode: tea.MouseModeCellMotion}
	}

	view := tea.NewView(lipgloss.JoinVertical(lipgloss.Left,
		append([]string{c.pane.View()}, c.chrome()...)...))
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

// promptMark is how many columns the mark down the left of the prompt takes.
const promptMark = 2

// The size a console is built at, before a window has said what the real one
// is.
//
// It is a guess, and it is here because the alternative is worse: an interface
// that draws nothing until a size arrives is an interface that draws nothing at
// all if one never does. A program takes messages only once it is running, so
// the very first size is a message that can be missed — and what is missed is
// then the whole screen rather than one frame of it. Eighty by twenty-four is
// wrong on most terminals for the moment before the real size lands, and right
// about the thing that matters, which is that there is something to correct.
const (
	initialWidth  = 80
	initialHeight = 24
)

// layout fits the interface to the window.
//
// The answer is re-wrapped here too. A markdown renderer wraps at the width it
// was built with, so a window that changed size and a renderer that did not
// would disagree about where a paragraph ends.
func (c *Console) layout(width, height int) {
	if width <= 0 {
		return
	}
	was := c.width
	c.width = width
	c.height = height

	c.input.SetWidth(width - c.styles.box.GetHorizontalFrameSize())
	c.pane.SetWidth(width)
	// The wrapping style is built here rather than per line. refresh rewraps
	// every block of the transcript on each frame of a streaming turn, and a
	// style allocated inside that loop is one allocation per block per chunk.
	c.wrapStyle = lipgloss.NewStyle().Width(width - gutterWidth)
	c.fit()

	if err := c.renderer.Width(width - gutterWidth); err != nil {
		c.blame(err)
	}
	// Only when the width actually moved. A window dragged taller reports a new
	// size on every row it passes through, and re-rendering every turn's
	// markdown on each of those is work for a wrapping that did not change.
	if was != width {
		c.rewrap()
	}
	c.refresh()
}

// fit gives the pane the rows the chrome does not take.
//
// The chrome is measured rather than counted, because it does not have one
// height. The status line grows a row when a prompt is waiting behind the turn
// in flight, and the footer is a row a window can be too narrow to have. A
// constant would be right in one of those cases and wrong in the others, and
// wrong here means either a row of the answer scrolled off the top or a view
// drawn past the bottom of the window — the first of which is close to
// invisible, which is what makes it worth measuring.
//
// The three pieces measured are the three the view joins. They cannot disagree
// unless one of them is changed on its own, and that is the only way this stays
// true as the chrome grows.
func (c *Console) fit() {
	if c.width <= 0 || c.height <= 0 {
		return
	}

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

// live is the answer as it arrives, drawn the way the kept turn will be.
//
// It goes through the same fold at the same width, so that the moment the Run
// closes and the record replaces the stream, nothing on screen changes shape. It
// used to be the raw bytes: a heading arrived as two hashes and a word, a list
// as hyphens, and all of it re-set itself the instant the turn was over — which
// is the most visible event on the screen happening at the moment a person has
// finally got what they were waiting for.
//
// Half-written markdown renders as what it is so far, which is what an answer
// that is half-written is. If the fold cannot make anything of it, the bytes are
// shown wrapped: a live area is worth having even when it is plain.
func (c *Console) live(text string) string {
	drawn, err := c.renderer.Arriving(text)
	if err != nil {
		return c.wrap(text)
	}
	return trimBlank(drawn)
}

// wrap folds text to the window, for the one thing on screen that arrives
// unwrapped.
//
// A kept turn was wrapped by the fold that rendered it, to this same width. What
// is arriving was not: it is the provider's own bytes, and a paragraph of them
// is one line however wide the window is. Left alone the pane would cut it at
// the right-hand edge, and a person would watch an answer stream past a margin
// with most of each line behind it.
//
// It is here rather than asked of the pane because the pane would charge for it
// on the whole transcript rather than on the part that needs it. See where
// SoftWrap is set.
func (c *Console) wrap(text string) string {
	if c.width-gutterWidth <= 0 {
		return text
	}
	return c.wrapStyle.Render(text)
}

// chrome is everything the view holds but the pane, in the order it is drawn.
//
// It sheds from the outside in as the window shrinks, and the order it sheds in
// is an order of need. The footer goes first: the model's name is a convenience,
// and a person who wants it can ask. The status line goes second, which costs
// the spinner and the elapsed figure and is the reason it is not first. What
// never goes is the prompt, because a console a person cannot type into is not
// a console.
//
// A window under four rows has no room even for that, and keeps the prompt
// anyway. There is nothing better to do with three rows, and a terminal that
// small is one somebody is in the middle of resizing.
func (c *Console) chrome() []string {
	pieces := []string{c.status(), c.prompt(), c.footer()}

	// One row is kept back for the pane throughout: a view with no transcript
	// at all is a view that cannot show what it just answered.
	for len(pieces) > 1 && c.height > 0 && rows(pieces)+1 > c.height {
		if len(pieces) == 3 {
			pieces = pieces[:2]
			continue
		}
		pieces = pieces[1:]
	}
	return pieces
}

// rows is how tall a set of drawn pieces is once they are stacked.
func rows(pieces []string) int {
	total := 0
	for _, piece := range pieces {
		total += lipgloss.Height(piece)
	}
	return total
}

// prompt is what a person types into, between its two rules.
func (c *Console) prompt() string {
	return c.styles.box.Width(c.width - c.styles.box.GetHorizontalFrameSize()).Render(c.input.View())
}

// status is what the line above the prompt says: that Eva is waiting for a
// person, that it is about to be left, or that a turn is running and for how
// long.
//
// It is always at least a line, whether or not a turn is running, so that the
// prompt does not move when one starts. The elapsed figure is rounded to the
// second because it is read, not measured, and it comes free with the spinner's
// own frame rate — nothing else has to wake the interface up to keep it true.
//
// The caption beside the spinner claims nothing and is not kept; see caption.go.
// What carries the meaning is the figure next to it.
func (c *Console) status() string {
	if c.leaving {
		return c.styles.hint.Render("press ctrl+c again to leave — any other key stays")
	}
	if !c.busy() {
		return c.styles.hint.Render("ready")
	}

	line := c.styles.spin.Render(c.spin.View()) + " " +
		c.styles.hint.Render(c.caption+" "+time.Since(c.since).Round(time.Second).String()+" — ctrl+c to interrupt")
	if c.queued == "" {
		return line
	}

	// The prompt waiting behind this turn, shown because a person who cannot
	// see it has no way to tell it was taken from one that was dropped.
	return line + "\n" + c.styles.hint.Render(queuedLabel+oneLine(c.queued, c.width-lipgloss.Width(queuedLabel), c.look.Symbols.Truncation))
}

// oneLine is a prompt as a single row: its line breaks and runs of spaces
// collapsed, and the whole cut to what there is room for.
//
// A queued prompt is shown in a place that has one row for it. A multi-line one
// left as it was written would push the prompt down the screen by however many
// lines a person happened to type, which is the interface moving under someone
// who is still typing into it.
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

// refresh puts the transcript, and the turn currently arriving, into the pane.
//
// The two are concatenated rather than stored together, and that is the whole
// of the rule in one function: what is kept is the transcript, which holds only
// what the Renderer folded from committed records. Arriving text exists here
// for exactly as long as the Run does. When the Run closes, the chunks are
// dropped and the rendered turn takes their place — so a process killed
// mid-block leaves nothing behind that says it arrived.
//
// The pane follows the end of the transcript only while it is already there. A
// person who has scrolled back to read something is reading it, and an
// interface that yanked them to the bottom on the next chunk would be an
// interface they cannot read at all.
func (c *Console) refresh() {
	// The turn still arriving is composed as a block like any other, so that it
	// is spaced off the prompt above it exactly as the kept turn that replaces
	// it will be. Composed rather than appended: a person watching one become
	// the other should see nothing move, and the gap is part of that.
	blocks := c.transcript
	if arriving := trimBlank(c.arriving.String()); arriving != "" {
		blocks = append(blocks[:len(blocks):len(blocks)], block{text: c.live(arriving), voice: evaVoice})
	}

	// The masthead leads the transcript and scrolls away with it. It is
	// composed here rather than kept as a block because it is not one: it is
	// drawn from facts that do not change and a model name that can, so
	// composing it per frame is what keeps it true after /model without a
	// second thing to remember to update.
	content := strings.TrimRight(c.compose(blocks), "\n")
	if head := c.masthead(); head != "" {
		content = head + "\n\n" + content
	}

	follow := c.pane.AtBottom()
	c.pane.SetContent(content)
	if follow {
		c.pane.GotoBottom()
	}

	c.shown.Lock()
	c.screen = content
	c.shown.Unlock()
}

// Screen is everything the console has put in front of a person: the turns it
// kept, and the one arriving if there is one.
//
// It exists for a test that drives this program without a terminal, and it
// exists because the byte stream stopped being readable when the interface
// became a screen. A console that draws in place emits cursor moves and
// overwrites, so bytes with their escapes stripped are not a transcript of what
// was read — they are the fragments of one, in the order the cursor happened to
// visit them. This was already true of the colour in a turn, and it is true of
// everything else in the frame for the same reason.
//
// So the assertion moves to what the interface composed, one step before the
// terminal. It is the same string the pane is given.
func (c *Console) Screen() string {
	c.shown.Lock()
	defer c.shown.Unlock()
	return c.screen
}

// footer is the model the turns are running against, at the far end of the
// window.
//
// It is there because /model can change it and a person who has changed it
// should not have to ask what it is now. At the near end, and only while a
// person has scrolled away from it, is how much transcript is below them.
//
// It holds nothing else. A working directory and a branch would say Eva acts on
// a repository, and at this stage Eva has no tools and acts on nothing — a
// footer that implied otherwise would be the interface making a claim the
// program cannot keep.
//
// It is empty until the window has said how wide it is, because there is
// nowhere to put a right-hand end without one.
func (c *Console) footer() string {
	model := c.control.Model()
	if c.width <= 0 || lipgloss.Width(model) >= c.width {
		return ""
	}

	// What the Session has cost, at the far end beside the model.
	//
	// It is here rather than under each answer because it is one figure that
	// keeps changing rather than a series of figures each true for a moment. A
	// line printed after every turn made a conversation read as a run of
	// receipts, and stated a cumulative total that the next turn immediately
	// made stale. On the footer it is simply what the Session has spent, now.
	right := model
	if spent := c.renderer.Session(); spent != "" {
		right = spent + " · " + model
	}

	behind := c.behind()
	gap := c.width - lipgloss.Width(right) - lipgloss.Width(behind)
	if gap < 1 {
		// Not enough window for all of it. The figures go before the count of
		// what is below, and both go before the model — a person can ask for a
		// cost and cannot ask what is answering without changing it.
		right, gap = model, c.width-lipgloss.Width(model)-lipgloss.Width(behind)
	}
	if gap < 1 {
		behind, gap = "", c.width-lipgloss.Width(model)
	}
	return c.styles.hint.Render(behind + strings.Repeat(" ", gap) + right)
}

// behind is how much of the transcript is below what a person is looking at.
//
// It is empty whenever they are at the end, which is almost always — a line that
// is there the whole time is a line nobody reads.
//
// What it is for is the case a scrolling pane creates and a scrollback never
// did: a person who has scrolled up while a turn is streaming sees a screen that
// does not change, and nothing else on it distinguishes that from a program
// that has stopped. The count moving is the evidence.
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
func (c *Console) busy() bool {
	c.shown.Lock()
	defer c.shown.Unlock()
	return c.cancel != nil
}

// Busy reports whether a Run is in flight, for whoever is driving this program
// rather than typing at it.
//
// A console answers one turn at a time and takes no keys while it is answering,
// so a driver that types without asking loses the keys it typed. A person never
// has this problem: they can see the status line. This is the same answer, for a
// caller that cannot.
//
// It is read from outside the update loop, and it reports a field the update
// loop writes. The lock is the one Screen uses, because the question is the same
// one — what is on screen right now — asked of a different part of the frame.
func (c *Console) Busy() bool {
	c.shown.Lock()
	defer c.shown.Unlock()
	return c.cancel != nil
}

// Queued is the prompt waiting behind the turn in flight, and is empty when
// there is none.
//
// It is the third thing about the current frame a driver has to be able to read,
// and it is here for the reason the other two are: what a person sees of it is
// the status line, and a screen drawn in place cannot be read off its own bytes.
// A driver that could not see a queued prompt would have to guess whether the
// keys it typed had landed.
func (c *Console) Queued() string {
	c.shown.Lock()
	defer c.shown.Unlock()
	return c.queued
}

// queue takes the prompt that will be sent when the turn in flight closes, and
// hands back the one that was waiting.
//
// One function for both because they are the same field under the same lock, and
// a caller that only ever swaps cannot leave the two out of step.
func (c *Console) queue(next string) string {
	c.shown.Lock()
	defer c.shown.Unlock()

	was := c.queued
	c.queued = next
	return was
}

// Wait returns once no Run is still committing.
//
// Run does this for a caller that only wants a conversation. It is exported for
// the caller that drives the program itself — a test typing keys into it — for
// which the wait is the same obligation: a Run that is still committing when
// its Trace closes is the one failure the project has no instrument to detect.
func (c *Console) Wait() { c.running.Wait() }

// stop ends the Run in flight, if there is one.
//
// It is also what the caller uses once the program has ended, which is safe
// for the reason it would not otherwise be: the update loop runs on the
// goroutine that started the program, so by the time that call returns there
// is nothing else touching this.
func (c *Console) stop() {
	c.shown.Lock()
	cancel := c.cancel
	c.cancel = nil
	c.shown.Unlock()

	if cancel != nil {
		cancel()
	}
}

// interrupt ends the Run in flight without forgetting it.
//
// The difference from stop is the whole of what "busy" means. A cancelled Run
// is not over: its goroutine is still unwinding and its close has not been
// folded in yet. Forgetting it here would make the console idle for that
// window, so the next prompt would open a second Run instead of queueing —
// and then the first Run's close would arrive and cancel the second one, reset
// its stream, and drop its queued prompt.
//
// So the Run stays in hand until its own close clears it, which is what stop
// is for and where it is called from.
func (c *Console) interrupt() {
	c.shown.Lock()
	cancel := c.cancel
	c.shown.Unlock()

	if cancel != nil {
		cancel()
	}
}

// background takes the terminal's answer about its own colour, and restyles
// everything that follows from it.
//
// What a person configured is not discarded: the Theme is rebuilt for the
// background the terminal reported and their choices are applied over it again,
// so an answer arriving late corrects the greys without undoing a decision.
func (c *Console) background(dark bool) tea.Cmd {
	if dark == c.dark {
		return nil
	}
	c.dark = dark
	c.look = c.look.For(dark)
	c.styles = newStyles(c.look)

	c.input.SetStyles(inputStyles(dark))

	if err := c.renderer.Background(dark); err != nil {
		c.blame(err)
	}
	c.refresh()
	return nil
}

// key acts on a key press.
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

	// Complete offers the next command; any other key means the person is
	// writing again rather than choosing, so the next one starts from what is
	// there.
	if c.keys.Is(pressed, keymap.Complete) {
		c.complete()
		return nil
	}
	c.completing = ""

	if c.scroll(pressed) {
		return nil
	}

	action, bound := c.keys.Action(pressed)
	if !bound {
		var cmd tea.Cmd
		c.input, cmd = c.input.Update(k)
		return cmd
	}

	switch action {
	case keymap.Interrupt:
		// During a turn this cancels it and gives the prompt back, rather
		// than ending the Session. A long wrong answer should cost seconds,
		// and the Session is a fold over what was committed — so the part of
		// the answer that did arrive is part of the transcript, and the next
		// turn is conditioned on it.
		if c.busy() {
			c.interrupted = true
			c.interrupt()
			return nil
		}

		// Idle, it asks first. A Session is an hour of somebody's work by the
		// time it is worth keeping, and one key next to the one that interrupts
		// a turn should not be able to end it. ctrl+d stays a single press,
		// because nobody types it by accident.
		if !c.leaving {
			c.leaving = true
			return nil
		}
		return tea.Quit

	case keymap.Leave:
		c.stop()
		return tea.Quit

	case keymap.Submit:
		prompt := strings.TrimSpace(c.input.Value())
		if prompt == "" {
			return nil
		}
		c.input.Reset()

		// A turn is already running, so this one waits rather than being lost.
		// It is echoed when it is sent rather than now, so that the transcript
		// reads in the order the turns happened.
		if c.busy() {
			c.queue(prompt)
			return nil
		}
		return c.send(prompt)
	}

	var cmd tea.Cmd
	c.input, cmd = c.input.Update(k)
	return cmd
}

// send echoes a prompt and either answers it here or opens a Run for it.
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

// scroll moves the pane, and reports whether the key was one of its own.
//
// The bindings are written here rather than taken from the pane's own defaults.
// Those bind j, k, space, f, b, u and d — every one of them a character a person
// types into a prompt — and ctrl+d, which is how this console is left. A pane
// holding those would make the prompt unusable and would do it silently, so the
// pane is given no bindings at all and these are the whole set.
//
// Every one of them is a chord or a named key, for that reason: a binding that
// is also a character is a binding that steals it.
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

// start opens a Run for the prompt.
//
// The Run is counted before the goroutine is made rather than inside it: this
// happens in the update loop, which has ended by the time anything waits, so
// there is no Run the wait can miss.
func (c *Console) start(prompt string) tea.Cmd {
	ctx, cancel := context.WithCancel(c.ctx)
	c.shown.Lock()
	c.cancel = cancel
	c.shown.Unlock()

	c.arriving.Reset()
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

// fold takes one committed Event.
//
// The Renderer is fed here rather than subscribed to the Recorder directly,
// because what it produces has to go above this program's view and only the
// update loop may put it there.
// The live area is not fed from here. A Text record is a whole content block,
// which for an ordinary answer is the whole answer, and a person watching that
// arrive would watch nothing until it was over.
func (c *Console) fold(e events.Event) tea.Cmd {
	if err := c.renderer.Committed(c.ctx, e); err != nil {
		c.blame(err)
	}
	return nil
}

// close ends the turn the interface was waiting on.
func (c *Console) close(a answered) tea.Cmd {
	c.stop()

	// Show has already erased this for a turn that produced one. This is the
	// turn that did not: interrupted before a word arrived, or broken partway
	// through. What arrived is dropped rather than kept, because it is not a
	// record — and the pane is recomposed, because a reset nothing redraws is a
	// reset nobody sees.
	c.arriving.Reset()
	c.refresh()

	// A turn that did not answer says so in one line, and the line names the
	// class of failure without quoting the thing that failed.
	//
	// It was the claim's own summary once, which for a broken turn is the
	// provider's words. Those are written for whoever is debugging the provider
	// rather than for whoever asked the question — a person who typed a prompt
	// and got back a sentence about how many turns a recording holds has been
	// handed the program's internals in place of an answer.
	//
	// Then it was one line for every failure, which cost the other half: a
	// credential to fix and a network to wait out read identically, and the only
	// place to tell them apart was a Trace file. Both halves are available at
	// once because the claim carries a class beside its prose, so the line is
	// chosen from the class. Nothing on this path composes a message out of
	// anything a provider said.
	//
	// Interruption keeps its own word. It is not a failure a person needs to be
	// told about; it is the thing they just did, and the console knows it did it
	// rather than reading it back out of a claim.
	//
	// A turn that broke leaves the Session standing either way. A console that
	// ended on the first provider failure would throw away a conversation over
	// something the next prompt might not hit.
	if a.outcome.Result != events.ResultDone {
		said := render.Unanswered(a.outcome.Class)
		if c.interrupted {
			said = "interrupted"
		}
		c.put(c.styles.hint.Render(said))

		// Then what that means on this machine, and the one step that follows.
		//
		// The line above says what happened and deliberately stops there,
		// because this layer can see that a credential was refused and cannot
		// see which credential or why. The layer that wired the run can see
		// both, so it is asked — and it answers with nothing whenever it
		// checked and could not place the failure, which is most of the time.
		//
		// Interruption spends none of this. There is no remedy for the thing a
		// person just did on purpose.
		if !c.interrupted {
			if next := c.control.Remedy(a.outcome.Class).Said(); next != "" {
				c.put(c.styles.hint.Render(next))
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
	next := c.queue("")
	c.fit()

	if next == "" {
		return c.input.Focus()
	}
	return tea.Batch(c.input.Focus(), c.send(next))
}

// put adds a block to the transcript, which is what a person keeps.
//
// Nothing reduces the colour here any more. The transcript is drawn inside this
// program's own view, and a program renders its view against what the terminal
// can show — so the reduction that used to happen on the way to the scrollback
// now happens where every other styled byte's does.
func (c *Console) put(text string) {
	c.keep(block{text: text, voice: asideVoice})
}

// keep adds a block and redraws.
func (c *Console) keep(b block) {
	b.text = trimBlank(b.text)
	c.transcript = append(c.transcript, b)
	c.refresh()
}

// trimBlank drops the empty lines at either end of a block.
//
// A rendered document arrives with blank lines above and below it, which was the
// fold's way of holding one turn off the next. Spacing is the transcript's to
// decide now, and a block that brought its own would start every answer with a
// marked empty line and would space nothing evenly.
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

// kept is the transcript as one piece of text, each block past its own mark.
//
// The gutter is applied here rather than when a block is added, so that a block
// holds what it says and nothing about how it is placed. That is what lets a
// resize replace a turn's text without having to know what was drawn beside it.
func (c *Console) kept() string { return c.compose(c.transcript) }

// compose draws a set of blocks as one piece of text: each past the mark that
// says whose it is, with a blank line between them.
//
// The blank line between blocks carries no mark. What separates two things must
// not look like part of either — a marked gap would run the band from a prompt
// straight into the answer beneath it and the two would read as one block.
// Inside a block the blanks do keep the mark, which is the same argument the
// other way round: a paragraph break in one answer is not a boundary between
// two.
func (c *Console) compose(blocks []block) string {
	drawn := make([]string, 0, len(blocks))
	for _, b := range blocks {
		drawn = append(drawn, c.gutter(b.text, b.voice))
	}
	return strings.Join(drawn, "\n\n")
}

// gutter writes a block past the mark that says whose it is.
//
// Every line takes the mark, not only the first. A prompt of five lines and an
// answer of fifty are each one thing, and a mark on the first line alone would
// make everything under it look like something else — which is exactly what a
// multi-line prompt looked like before there was a gutter at all.
func (c *Console) gutter(text string, v voice) string {
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
	return strings.Join(lines, "\n")
}

// rewrap draws the turns already answered at the width the window is now.
//
// A turn was wrapped by the fold that rendered it, to whatever the window was at
// the time. Nothing about that survives a resize: narrow the window and every
// answer on screen overruns it, widen it and they stay in a column with the rest
// of the screen empty beside them. The fold still holds the markdown, so the
// turns are rendered again rather than re-flowed — re-flowing styled output
// means guessing where a heading ended and a fenced block began.
//
// What a person typed is left exactly as it was. It was never wrapped to
// anything, and its place in the order is what makes the transcript readable.
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
		at++
	}
}

// blame queues a failure to go above the view, in the interface's own voice.
// A console that swallowed one would leave a person waiting at a prompt for a
// turn that is not coming.
func (c *Console) blame(err error) {
	c.put(c.styles.hint.Render("eva: " + err.Error()))
}

// Show takes a finished turn from the Renderer. It is the Screen a Renderer
// built by newConsole writes to.
func (c *Console) Show(turn string) error {
	// The live area is erased by the thing that replaces it, here, rather than
	// a moment later when the Run is closed. The two are not the same instant:
	// the rendered turn arrives with the record that closes the Run, and the
	// Run's own closing reaches this model as a separate message afterwards.
	// Erasing on the later one leaves a frame — and, since nothing recomposed
	// after it, every frame after that — showing the answer twice: once as the
	// chunks that arrived, and once as the turn that was kept.
	c.arriving.Reset()
	c.keep(block{text: turn, voice: evaVoice})
	return nil
}

var _ render.Screen = (*Console)(nil)

// Option is what a caller says about how this console looks and what its keys
// do. A caller that says nothing gets the complete defaults.
//
// They are options rather than parameters because a console is built by a
// frontend that may have nothing to configure — a test, a first run — and
// because what a person configured arrives from a file this layer cannot read.
type Option func(*theme.Theme, *keymap.Keymap)

// WithTheme draws the interface the way a person asked.
func WithTheme(look theme.Theme) Option {
	return func(t *theme.Theme, _ *keymap.Keymap) { *t = look }
}

// WithKeymap answers the keys a person asked for.
func WithKeymap(keys keymap.Keymap) Option {
	return func(_ *theme.Theme, k *keymap.Keymap) { *k = keys }
}

// spinnerFor is the frames a Theme names.
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
