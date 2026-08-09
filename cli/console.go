package cli

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"sync"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/term"
	"github.com/missingstudio/eva/cli/render"
	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
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
type console struct {
	// ask runs one turn and returns when the Run is closed. It is a function
	// rather than the assembly behind it, because everything the interface
	// could do with a Provider or a sink is something it must not do.
	ask func(ctx context.Context, prompt string) (core.Outcome, error)

	// control is what a command may change about the turns that follow.
	control control

	// renderer is the projection a person reads: a fold over committed Events,
	// showing on this model rather than writing to a stream.
	renderer *render.Renderer

	// ctx is what a Run is started under. The one a turn actually runs under
	// is a cancellable child of it, which is what Ctrl-C ends.
	ctx context.Context

	input textinput.Model

	// arriving is the open Run's answer as it streams, and it is what the
	// live area shows. The rendered turn that replaces it comes from the
	// Renderer, once the Run has closed — a heading, a list, and a fenced
	// block are each only meaningful once they are complete.
	arriving strings.Builder

	// pending holds what is waiting to go above the view. The program puts it
	// there, and only the update loop may ask it to.
	pending []string

	// cancel ends the Run in flight, and is nil when there is none.
	cancel context.CancelFunc

	// running counts the Runs whose goroutine has not returned. The process
	// waits on it before it closes the sink, because a Run that is still
	// committing when its Trace closes is the one failure the project has no
	// instrument to detect.
	running sync.WaitGroup

	// profile is what the destination can show. Colour is reduced to it here,
	// before a turn is handed over, for the reason put sets out.
	profile colorprofile.Profile

	// height is the window's, and is zero until the program reports one.
	height int

	// dark is what the terminal answered when it was asked what colour it is.
	// It starts at the assumption and is corrected by the answer.
	dark   bool
	styles styles
}

var _ tea.Model = (*console)(nil)

// styles are the interface's own, which are not the answer's. The answer is
// styled by the Renderer, and everything here is subordinate to it: a prompt
// echoed back and a status line are landmarks a person navigates by, not
// things they read.
type styles struct {
	said lipgloss.Style
	hint lipgloss.Style
}

func newStyles(dark bool) styles {
	return styles{
		said: lipgloss.NewStyle().Bold(true),
		// The same grey the cost line is written in. Both are subordinate to
		// the answer, so both are one decision rather than two that happen to
		// agree — see render.Subdued.
		hint: render.Subdued(dark),
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
func newConsole(ctx context.Context, e *eva, in io.Reader, out io.Writer) (*tea.Program, *console, error) {
	input := textinput.New()
	input.Prompt = "› "
	input.Placeholder = "ask something"

	c := &console{
		ask:     e.answer,
		control: e,
		ctx:     ctx,
		input:   input,
		profile: colorprofile.Detect(out, os.Environ()),
		dark:    true,
		styles:  newStyles(true),
	}

	renderer, err := render.New(c, c.dark)
	if err != nil {
		return nil, nil, err
	}
	c.renderer = renderer

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
	e.watch(
		&feed{program: program},
		func(text string) { program.Send(chunk{text: text}) },
	)

	return program, c, nil
}

// Init focuses the prompt, asks the terminal what colour it is, and says how
// to leave.
func (c *console) Init() tea.Cmd {
	return tea.Batch(
		c.input.Focus(),
		tea.RequestBackgroundColor,
		tea.Println(c.styles.hint.Render("eva — enter to send, /help for the commands, ctrl+c to interrupt a turn, ctrl+d to leave")),
	)
}

// Update folds one message into the interface.
func (c *console) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		c.height = msg.Height
		if msg.Width > 0 {
			c.input.SetWidth(msg.Width)
		}

	case tea.BackgroundColorMsg:
		return c, c.background(msg.IsDark())

	case tea.KeyPressMsg:
		return c, c.key(msg)

	case chunk:
		c.arriving.WriteString(msg.text)
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

// View is the live area: what is arriving while a turn runs, and the prompt
// when none does.
//
// The turns already answered are not here. They are above the view, put there
// as each Run closed, which is what leaves them in the terminal's own
// scrollback rather than in a buffer this program has to hold and redraw.
func (c *console) View() tea.View {
	if !c.busy() {
		return tea.NewView(c.input.View())
	}

	var live strings.Builder
	if arriving := strings.TrimRight(c.arriving.String(), "\n"); arriving != "" {
		live.WriteString(c.tail(arriving))
		live.WriteString("\n")
	}
	live.WriteString(c.styles.hint.Render("answering — ctrl+c to interrupt"))
	return tea.NewView(live.String())
}

// liveLines is how many lines of an arriving answer the view shows when the
// window has not said how tall it is.
const liveLines = 10

// tail is the end of what has arrived, at most as many lines as there is room
// for.
//
// The live area is a window on a stream and not a transcript. Showing the
// whole of a long answer would grow the view past the window, and the whole of
// it is put above the view anyway once the Run closes — rendered, which is
// what a person actually reads it as.
func (c *console) tail(arriving string) string {
	room := liveLines
	if c.height > 0 && c.height-2 < room {
		room = c.height - 2
	}
	if room < 1 {
		room = 1
	}

	lines := strings.Split(arriving, "\n")
	if len(lines) <= room {
		return arriving
	}
	return strings.Join(lines[len(lines)-room:], "\n")
}

// busy reports whether a Run is in flight.
func (c *console) busy() bool { return c.cancel != nil }

// stop ends the Run in flight, if there is one.
//
// It is also what the caller uses once the program has ended, which is safe
// for the reason it would not otherwise be: the update loop runs on the
// goroutine that started the program, so by the time that call returns there
// is nothing else touching this.
func (c *console) stop() {
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

// background takes the terminal's answer about its own colour, and restyles
// everything that follows from it. Nothing configures this: a style a person
// had to select is a style most people never select.
func (c *console) background(dark bool) tea.Cmd {
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
	return c.print()
}

// key acts on a key press.
func (c *console) key(k tea.KeyPressMsg) tea.Cmd {
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
			return c.print()
		}
		return tea.Sequence(c.print(), c.start(prompt))
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
func (c *console) start(prompt string) tea.Cmd {
	ctx, cancel := context.WithCancel(c.ctx)
	c.cancel = cancel
	c.arriving.Reset()
	c.running.Add(1)

	return func() tea.Msg {
		defer c.running.Done()
		defer cancel()

		outcome, err := c.ask(ctx, prompt)
		return answered{outcome: outcome, err: err}
	}
}

// fold takes one committed Event.
//
// The Renderer is fed here rather than subscribed to the Recorder directly,
// because what it produces has to go above this program's view and only the
// update loop may put it there.
// The live area is not fed from here. A Text record is a whole content block,
// which for an ordinary answer is the whole answer, and a person watching that
// arrive would watch nothing until it was over.
func (c *console) fold(e events.Event) tea.Cmd {
	if err := c.renderer.Committed(c.ctx, e); err != nil {
		c.blame(err)
	}
	return c.print()
}

// close ends the turn the interface was waiting on.
func (c *console) close(a answered) tea.Cmd {
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

	return tea.Batch(c.print(), c.input.Focus())
}

// put queues a block to go above the view, with its colour reduced to what the
// destination can show.
//
// The reduction happens here rather than on the way out. A program renders its
// own view against what the terminal can show, and puts what it is handed
// above that view exactly as it was handed it — so a turn nobody reduced would
// reach a sixteen-colour terminal in twenty-four-bit colour.
func (c *console) put(block string) {
	var adapted strings.Builder
	reduce := colorprofile.Writer{Forward: &adapted, Profile: c.profile}
	// Neither a builder nor the reducer in front of it has anywhere to fail.
	_, _ = io.WriteString(&reduce, strings.TrimRight(block, "\n"))

	c.pending = append(c.pending, adapted.String())
}

// blame queues a failure to go above the view, in the interface's own voice.
// A console that swallowed one would leave a person waiting at a prompt for a
// turn that is not coming.
func (c *console) blame(err error) {
	c.put(c.styles.hint.Render("eva: " + err.Error()))
}

// Show takes a finished turn from the Renderer. It is the Screen a Renderer
// built by newConsole writes to.
func (c *console) Show(turn string) error {
	c.put(turn)
	return nil
}

var _ render.Screen = (*console)(nil)

// print asks the program to put what is queued above its view.
//
// In sequence rather than in a batch: a batch runs its commands at once, and
// what a person reads is an order.
func (c *console) print() tea.Cmd {
	if len(c.pending) == 0 {
		return nil
	}

	blocks := c.pending
	c.pending = nil

	cmds := make([]tea.Cmd, len(blocks))
	for i, block := range blocks {
		cmds[i] = tea.Println(block)
	}
	return tea.Sequence(cmds...)
}
