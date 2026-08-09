package tui

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/term"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/ui"
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
	// ask runs one turn and returns when the Run is closed. It is held as a
	// function because that is the whole of what starting a turn is, and a
	// command never needs it.
	ask func(ctx context.Context, prompt string) (core.Outcome, error)

	// control is what a command may change about the turns that follow. What
	// keeps a Provider and a sink out of reach is now the type: see Control.
	control Control

	// renderer is the projection a person reads: a fold over committed Events,
	// showing on this model rather than writing to a stream.
	renderer *ui.Renderer

	// ctx is what a Run is started under. The one a turn actually runs under
	// is a cancellable child of it, which is what Ctrl-C ends.
	ctx context.Context

	input textinput.Model

	// arriving is the open Run's answer as it streams, and it is what the
	// live area shows. The rendered turn that replaces it comes from the
	// Renderer, once the Run has closed — a heading, a list, and a fenced
	// block are each only meaningful once they are complete.
	arriving strings.Builder

	// transcript is what has been kept: every rendered turn, every prompt
	// echoed back, and every command answered. It holds no arriving text — see
	// refresh — so nothing in it came from anywhere but a committed record.
	transcript strings.Builder

	// pane is the window onto the transcript. It scrolls, so the transcript is
	// not truncated to fit; what a person sees is a position in it.
	pane viewport.Model

	// screen is what refresh last composed, and shown guards it. It is read
	// from outside the update loop by whoever is driving the program — see
	// Screen — and written inside it, so the two need to agree on a lock.
	shown  sync.Mutex
	screen string
	// answering mirrors busy under the same lock, for Busy.
	answering bool

	// cancel ends the Run in flight, and is nil when there is none.
	cancel context.CancelFunc

	// running counts the Runs whose goroutine has not returned. The process
	// waits on it before it closes the sink, because a Run that is still
	// committing when its Trace closes is the one failure the project has no
	// instrument to detect.
	running sync.WaitGroup

	// width is the window's, and is zero until the program reports one. It is
	// what the footer puts the model at the far end of, and what the answer is
	// wrapped to.
	width int

	// spin turns while a Run is in flight. It is the answer to the one question
	// a live area cannot otherwise answer: an answer that has not started
	// arriving looks exactly like an interface that has stopped.
	spin spinner.Model

	// since is when the Run in flight opened, and is what the status line
	// counts up from. A person deciding whether to wait or to interrupt is
	// deciding on elapsed time, so it is on screen rather than guessed at.
	since time.Time

	// dark is what the terminal answered when it was asked what colour it is.
	// It starts at the assumption and is corrected by the answer.
	dark   bool
	styles styles
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
	// box is the border around the prompt. It is drawn in the same grey as
	// everything else here, because a border is the least of what is on screen.
	box lipgloss.Style
}

func newStyles(dark bool) styles {
	subdued := ui.Subdued(dark)
	return styles{
		said: lipgloss.NewStyle().Bold(true),
		// The same grey the cost line is written in. Both are subordinate to
		// the answer, so both are one decision rather than two that happen to
		// agree — see ui.Subdued.
		hint: subdued,
		spin: lipgloss.NewStyle(),
		box: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(subdued.GetForeground()),
	}
}

// committed carries one committed Event into the update loop from outside it.
type committed struct{ event events.Event }

// chunk carries one piece of an answer into the update loop ahead of the
// record of it. It is what the live area is made of, and it is never what a
// turn leaves behind — see Turn.Arriving.
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
func NewConsole(ctx context.Context, backend Control, in io.Reader, out io.Writer) (*tea.Program, *Console, error) {
	input := textinput.New()
	input.Prompt = "› "
	input.Placeholder = "ask something"

	c := &Console{
		ask:     backend.Answer,
		control: backend,
		ctx:     ctx,
		input:   input,
		spin:    spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		pane:    viewport.New(),
		dark:    true,
		styles:  newStyles(true),
	}

	renderer, err := ui.New(c, c.dark)
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
	program = tea.NewProgram(c, tea.WithContext(ctx), tea.WithInput(in), tea.WithOutput(out))

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

// Init focuses the prompt, asks the terminal what colour it is, and says how
// to leave.
func (c *Console) Init() tea.Cmd {
	c.put(c.styles.hint.Render("eva — enter to send, /help for the commands, ctrl+c to interrupt a turn, ctrl+d to leave"))
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
		var cmd tea.Cmd
		c.spin, cmd = c.spin.Update(msg)
		return c, cmd

	case tea.BackgroundColorMsg:
		return c, c.background(msg.IsDark())

	case tea.KeyPressMsg:
		return c, c.key(msg)

	case chunk:
		c.arriving.WriteString(msg.text)
		c.refresh()
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

// View is the live area: what is arriving while a turn runs, the prompt when
// none does, and under both the footer that says which model is answering.
//
// The turns already answered are not here. They are above the view, put there
// as each Run closed, which is what leaves them in the terminal's own
// scrollback rather than in a buffer this program has to hold and redraw. This
// is why the view is three lines rather than a pane: a frontend that held the
// transcript itself would be a second copy of what the Trace already holds, and
// the two would disagree the first time a turn failed halfway.
func (c *Console) View() tea.View {
	// Until a window has said how big it is there is no box to draw, and
	// guessing one means drawing it twice at two sizes.
	if c.width <= 0 {
		return tea.View{AltScreen: true, MouseMode: tea.MouseModeCellMotion}
	}

	view := tea.NewView(lipgloss.JoinVertical(lipgloss.Left,
		c.pane.View(),
		c.status(),
		// Width on a bordered style is the whole frame, border included, so the
		// window's own width is what makes the box reach both edges.
		c.styles.box.Width(c.width).Render(c.input.View()),
		c.footer(),
	))
	view.AltScreen = true
	// Cell motion is the least that carries a wheel, which is the only mouse
	// event this uses. Anything more would take click and drag away from the
	// terminal, and with them a person's own way of selecting text.
	view.MouseMode = tea.MouseModeCellMotion
	return view
}

// The rows the chrome takes from the window: the status line, the prompt with
// a border above and below it, and the footer.
const (
	borderColumns = 2
	chromeRows    = 1 + 3 + 1
)

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
	c.width = width
	c.input.SetWidth(width - borderColumns)

	rows := height - chromeRows
	if rows < 1 {
		rows = 1
	}
	c.pane.SetWidth(width)
	c.pane.SetHeight(rows)

	if err := c.renderer.Width(width); err != nil {
		c.blame(err)
	}
	c.refresh()
}

// status is what the line above the prompt says: that Eva is waiting for a
// person, or that a turn is running and for how long.
//
// It is always a line, whether or not a turn is running, so that the prompt
// does not move when one starts. The elapsed figure is rounded to the second
// because it is read, not measured, and it comes free with the spinner's own
// frame rate — nothing else has to wake the interface up to keep it true.
func (c *Console) status() string {
	if !c.busy() {
		return c.styles.hint.Render("ready")
	}
	return c.styles.spin.Render(c.spin.View()) + " " +
		c.styles.hint.Render("answering "+time.Since(c.since).Round(time.Second).String()+" — ctrl+c to interrupt")
}

// refresh puts the transcript, and the turn currently arriving, into the pane.
//
// The two are concatenated rather than stored together, and that is the whole
// of ADR 0015 in one function: what is kept is the transcript, which holds only
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
	content := c.transcript.String()
	if arriving := strings.TrimRight(c.arriving.String(), "\n"); arriving != "" {
		content += arriving + "\n"
	}
	content = strings.TrimRight(content, "\n")

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
// visit them. ADR 0022 recorded that for colour; this is the same fact reaching
// the rest of the frame.
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
// should not have to ask what it is now. It holds nothing else. A working
// directory and a branch would say Eva acts on a repository, and at this stage
// Eva has no tools and acts on nothing — a footer that implied otherwise would
// be the interface making a claim the program cannot keep.
//
// It is empty until the window has said how wide it is, because there is
// nowhere to put a right-hand end without one.
func (c *Console) footer() string {
	model := c.control.Model()
	if c.width <= 0 || lipgloss.Width(model) >= c.width {
		return ""
	}
	return c.styles.hint.Render(strings.Repeat(" ", c.width-lipgloss.Width(model)) + model)
}

// busy reports whether a Run is in flight.
func (c *Console) busy() bool { return c.cancel != nil }

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
	return c.answering
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
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}

	c.shown.Lock()
	c.answering = false
	c.shown.Unlock()
}

// background takes the terminal's answer about its own colour, and restyles
// everything that follows from it. Nothing configures this: a style a person
// had to select is a style most people never select.
func (c *Console) background(dark bool) tea.Cmd {
	if dark == c.dark {
		return nil
	}
	c.dark = dark
	c.styles = newStyles(dark)

	if dark {
		c.input.SetStyles(textinput.DefaultDarkStyles())
	} else {
		c.input.SetStyles(textinput.DefaultLightStyles())
	}

	if err := c.renderer.Background(dark); err != nil {
		c.blame(err)
	}
	c.refresh()
	return nil
}

// key acts on a key press.
func (c *Console) key(k tea.KeyPressMsg) tea.Cmd {
	switch k.String() {
	case "ctrl+c":
		// During a turn this cancels it and gives the prompt back, rather
		// than ending the Session. A long wrong answer should cost seconds,
		// and the Session is a fold over what was committed — so the part of
		// the answer that did arrive is part of the transcript, and the next
		// turn is conditioned on it.
		if c.busy() {
			c.cancel()
			return nil
		}
		return tea.Quit

	case "ctrl+d":
		c.stop()
		return tea.Quit

	case "enter":
		if c.busy() {
			return nil
		}
		prompt := strings.TrimSpace(c.input.Value())
		if prompt == "" {
			return nil
		}
		c.input.Reset()
		c.put(c.styles.said.Render("› " + prompt))

		// A slash is a person addressing eva rather than the model, and what it
		// asks for happens here: no Run opens, nothing is committed, and the
		// Trace holds no record of a turn that never ran.
		if strings.HasPrefix(prompt, "/") {
			c.put(c.obey(prompt))
			return nil
		}
		return c.start(prompt)
	}

	if c.busy() {
		return nil
	}

	var cmd tea.Cmd
	c.input, cmd = c.input.Update(k)
	return cmd
}

// start opens a Run for the prompt.
//
// The Run is counted before the goroutine is made rather than inside it: this
// happens in the update loop, which has ended by the time anything waits, so
// there is no Run the wait can miss.
func (c *Console) start(prompt string) tea.Cmd {
	ctx, cancel := context.WithCancel(c.ctx)
	c.cancel = cancel
	c.arriving.Reset()
	c.since = time.Now()
	c.running.Add(1)

	c.shown.Lock()
	c.answering = true
	c.shown.Unlock()

	turn := func() tea.Msg {
		defer c.running.Done()
		defer cancel()

		outcome, err := c.ask(ctx, prompt)
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
	c.arriving.Reset()

	// A turn that did not answer says why in its own claim, and that claim is
	// the one the Trace holds. The interface reads it rather than working the
	// reason out a second time from the error: "interrupted" for a turn
	// somebody stopped, the provider's own words for one that broke. A
	// classification made here could disagree with the record, and a person
	// reading the screen would have no way to know which of the two was true.
	//
	// A turn that broke leaves the Session standing either way. A console that
	// ended on the first provider failure would throw away a conversation over
	// something the next prompt might not hit.
	if a.outcome.Result != events.ResultDone && a.outcome.Summary != "" {
		c.put(c.styles.hint.Render(a.outcome.Summary))
	}

	// An error is not an Outcome. It is the record failing, which is the one
	// thing a person cannot be shown from the Trace.
	if a.err != nil {
		c.blame(a.err)
	}

	return c.input.Focus()
}

// put adds a block to the transcript, which is what a person keeps.
//
// Nothing reduces the colour here any more. The transcript is drawn inside this
// program's own view, and a program renders its view against what the terminal
// can show — so the reduction that used to happen on the way to the scrollback
// now happens where every other styled byte's does.
func (c *Console) put(block string) {
	c.transcript.WriteString(strings.TrimRight(block, "\n"))
	c.transcript.WriteString("\n")
	c.refresh()
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
	c.put(turn)
	return nil
}

var _ ui.Screen = (*Console)(nil)
