package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/theme"

	// The Providers a build can select, each registering itself as it loads.
	_ "github.com/missingstudio/eva/internal/providers/anthropic"
	_ "github.com/missingstudio/eva/internal/providers/fake"
	"github.com/missingstudio/eva/internal/trace"
	"github.com/missingstudio/eva/internal/tui"
	"github.com/missingstudio/eva/internal/tui/keymap"
	"github.com/missingstudio/eva/internal/ui"
)

// Exit codes. They are part of the contract a script reads, so they are named
// rather than written as literals at the point of return.
const (
	// ExitOK is a turn that ran and claimed Done.
	ExitOK = 0
	// ExitFailure is a turn that started and did not finish.
	ExitFailure = 1
	// ExitUsage is a command line or a configuration Eva would not act on.
	ExitUsage = 2
)

// usage is the command surface a shell sees. The console answers /help, which
// is a different surface: these are the flags a process is started with, and
// those are the commands a Session is steered by.
//
// The figures are read from config rather than written out here. A help text
// that states a default in its own words is a help text that goes stale in the
// commit that changes one, and nothing fails when it does.
var usage = fmt.Sprintf(`eva — an autonomous, multi-tenant, AI-native software factory.

USAGE:
  eva                    Interactive console
  eva -p <prompt>        Answer one prompt and leave
  eva init               Write a starter configuration
  eva help               Show this help

FLAGS:
  --config <path>        Configuration file
  -p <prompt>            One turn, rendered to stdout; non-zero if it failed

CONFIG (env):
  %-20s   required
  %-20s   default: ~/.eva/config.toml
  %-20s   default: the user's home directory

The model is the config file's to choose (default: %s).

In the console: enter sends, ctrl+c interrupts the turn in flight, ctrl+d
leaves, and /help lists the commands.
`, config.DefaultAPIKeyEnv, config.EnvConfig, config.EnvHome, config.DefaultModel)

// Main runs eva and returns the process exit code.
//
// args is the command line without the program name. Reading and writing
// through the passed streams rather than through the process's own is what
// lets a test drive this with nothing attached, because a terminal is the
// thing CI does not have.
func Main(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	// A failure to write help or a diagnostic is not something the process
	// can report anywhere else, so the exit code carries what it can.
	opts, err := parse(args)
	switch {
	case errors.Is(err, errHelp):
		_, _ = fmt.Fprint(stdout, usage)
		return ExitOK
	case err != nil:
		_, _ = fmt.Fprintf(stderr, "eva: %v\n\n%s", err, usage)
		return ExitUsage
	}

	code, err := run(context.Background(), opts, stdin, stdout)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "eva: %v\n", err)
	}
	return code
}

// errHelp is the request for help, which is a successful command rather than
// a rejected one.
var errHelp = errors.New("help requested")

// options is the whole of what a command line can say.
//
// It is one field, and that is the shape the command surface was cut back to:
// eva is the console, and a turn is something a person types rather than
// something a process is started with. Configuration is the exception because
// it has to be — a file has to be found before it can say anything.
type options struct {
	config string
	// initialise says the run writes a starter configuration and leaves. It is
	// a word rather than a flag for the reason help is: it is a thing to do, not
	// a way of doing the thing.
	initialise bool
	// prompt is one turn asked from the command line. It is empty for the
	// console, which is what eva is with nothing to answer.
	prompt string
}

func parse(args []string) (options, error) {
	if len(args) > 0 && args[0] == "help" {
		return options{}, errHelp
	}

	var opts options
	if len(args) > 0 && args[0] == "init" {
		opts.initialise = true
		args = args[1:]
	}
	fs := flag.NewFlagSet("eva", flag.ContinueOnError)

	// Eva prints its own usage, in its own words, on the stream it chooses.
	fs.SetOutput(io.Discard)
	fs.StringVar(&opts.config, "config", "", "configuration file")
	fs.StringVar(&opts.prompt, "p", "", "answer one prompt and leave")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return options{}, errHelp
		}
		return options{}, err
	}

	if rest := fs.Args(); len(rest) > 0 {
		return options{}, fmt.Errorf("unexpected argument %q", rest[0])
	}
	return opts, nil
}

// run is written with named results so that closing the Trace can report a
// failure the turn itself did not see. A Trace that failed to flush is not a
// successful run, whatever the turn claimed.
func run(ctx context.Context, opts options, stdin io.Reader, stdout io.Writer) (code int, err error) {
	// Before the configuration is read, because writing one is what a person
	// does when they have none — and a starter run that first insisted on a
	// valid file would be a command nobody could use for its own purpose.
	if opts.initialise {
		path, err := config.Init(opts.config, starter())
		if err != nil {
			return ExitUsage, err
		}
		_, _ = fmt.Fprintf(stdout, "wrote %s\n\nEvery setting in it is commented out, so Eva behaves exactly as it\ndoes now until you uncomment one. Set %s in your environment\nand run eva.\n", path, config.DefaultAPIKeyEnv)
		return ExitOK, nil
	}

	cfg, err := config.Load(opts.config)
	if err != nil {
		return ExitUsage, err
	}

	provider, err := open(cfg)
	if err != nil {
		return ExitUsage, err
	}

	sink, err := trace.New(cfg.Trace.Kind, trace.Options{Path: cfg.Trace.Path})
	if err != nil {
		return ExitFailure, err
	}
	defer func() {
		if cerr := sink.Close(); cerr != nil && err == nil {
			code, err = ExitFailure, cerr
		}
	}()

	e := &eva{
		provider: provider,
		sink:     sink,
		session:  core.NewSession(events.SessionID(newID("sess")), cfg.Tenant(), cfg.Actor(), origin()),
		model:    cfg.Model,
	}

	// How it looks is resolved before either path is chosen, so that a file a
	// person got wrong is reported whichever way they ran Eva. A theme that was
	// only read when the console opened would make a broken configuration a
	// thing that depends on how you started the program.
	look, keys, err := appearance(cfg)
	if err != nil {
		return ExitUsage, err
	}

	// The assembly is built once and handed to the frontend that drives it. It
	// attaches through eva's own door, which is the only place a Run learns who
	// is watching it and what it may claim.
	if opts.prompt != "" {
		return once(ctx, e, opts.prompt, stdout, look)
	}

	if err := tui.Run(ctx, e, stdin, stdout, tui.WithTheme(look), tui.WithKeymap(keys)); err != nil {
		return ExitFailure, err
	}
	return ExitOK, nil
}

// appearance maps what a person wrote onto the types the interface draws with.
//
// The mapping happens here and only here. A Theme is the console's vocabulary
// and a Config is a file format, and the layer that reads files is the one that
// turns the second into the first — which is what lets the console be
// configurable while remaining unable to read a configuration.
//
// A dark terminal is assumed, and corrected when the real one answers. The
// Theme carries what a person chose across that correction, so an answer
// arriving late changes the greys without undoing a decision.
func appearance(cfg config.Config) (theme.Theme, keymap.Keymap, error) {
	look, err := theme.Build(true, theme.Settings{
		Subdued:        cfg.Theme.Colors.Subdued,
		Person:         cfg.Theme.Colors.Person,
		Eva:            cfg.Theme.Colors.Eva,
		Spinner:        cfg.Theme.Colors.Spinner,
		SpinnerName:    cfg.Theme.Symbols.Spinner,
		Prompt:         cfg.Theme.Symbols.Prompt,
		Placeholder:    cfg.Theme.Symbols.Placeholder,
		Truncation:     cfg.Theme.Symbols.Truncation,
		Border:         cfg.Theme.Border,
		PromptRows:     cfg.Theme.Layout.PromptRows,
		CaptionSeconds: cfg.Theme.Layout.CaptionSeconds,
	})
	if err != nil {
		return theme.Theme{}, keymap.Keymap{}, fmt.Errorf("%w (in %s)", err, appearanceFile(cfg))
	}

	keys, err := keymap.Parse(cfg.Keys.Bind)
	if err != nil {
		return theme.Theme{}, keymap.Keymap{}, fmt.Errorf("%w (in %s)", err, appearanceFile(cfg))
	}
	return look, keys, nil
}

// appearanceFile is which file a person has to go and edit. Look and feel is
// the one thing a repository may set, so it is the more likely of the two.
func appearanceFile(cfg config.Config) string {
	if cfg.Project != "" {
		return cfg.Project
	}
	return cfg.Path
}

// The fold a person reads a turn in is a projection of what was committed, and
// this is where the compiler is told so.
//
// ui does not import core, deliberately: a fold that could reach a Session or
// the Trace could show a turn the record does not hold. That costs the
// assertion a package usually makes about itself, so the layer that builds a
// Renderer makes it instead. Without this line the guarantee rests on whichever
// call site happens to pass one as a Subscriber, and a refactor of that call
// site takes the guarantee with it and says nothing.
var _ core.Subscriber = (*ui.Renderer)(nil)

// once answers one prompt onto a byte stream and returns the code that says how
// it went.
//
// It exists because the console took the screen. An interface drawn in place
// writes cursor moves to its output, so redirecting it captures the movements
// of a cursor rather than an answer — and with it went the last way to get one
// turn out of Eva without a terminal. This is that way back, and it is the
// narrow one: a prompt in, a rendered answer out.
//
// It is not a machine-readable surface, and it does not bring one back. What a reader wanting data reads is the Trace, which holds
// this turn exactly as it holds every other — committed, by the same schema,
// through the same sink. This writes the same fold a person would have read.
//
// Nothing watches the turn arrive. Turn.Arriving is nil on this path, which is
// what ADR 0015 already says of a run with no live area: there is nothing to
// erase, so the answer is written when it is whole.
//
// A failed turn exits non-zero. The console has no exit code because it stays
// open; this does not stay open, so the claim the Trace holds is also the
// process's answer to whoever ran it.
func once(ctx context.Context, e *eva, prompt string, stdout io.Writer, look theme.Theme) (int, error) {
	// The Theme is the one a person configured, built for a dark terminal
	// because this path does not ask. Asking means writing a query to a
	// terminal and reading it back, and this path may have no terminal at all —
	// where it does not, lipgloss removes the escapes on the way out and the
	// assumption costs nothing.
	renderer, err := ui.New(ui.Stream(stdout), look)
	if err != nil {
		return ExitFailure, err
	}
	e.Attach(renderer)

	outcome, err := e.Answer(ctx, prompt)
	if err != nil {
		return ExitFailure, err
	}
	if outcome.Result != events.ResultDone {
		return ExitFailure, nil
	}
	return ExitOK, nil
}

// eva is one Session's worth of assembly: the Provider that answers, the sink
// every Event lands in, the transcript both are folded into, and who is
// watching.
//
// It exists because a Session has many Runs. The console runs one per prompt,
// and everything except the Run itself is the same each time — so this holds
// what lasts and answer builds what does not.
type eva struct {
	provider providers.Provider
	sink     core.TraceSink
	session  *core.Session
	model    string

	// interrupt says whether whoever is driving these turns listens for a
	// cancellation and closes the Run, rather than letting the process die
	// under it. It is a property of the frontend and not of a Turn, so it is
	// told rather than assumed: a capability claimed and absent corrupts a
	// Run, where a missing one only degrades it.
	interrupt bool

	// subs are the projections beyond the Session: the interface a person
	// reads the turn in.
	subs []core.Subscriber

	// arriving is who is watching the turn happen, and is nil when nobody is.
	// See Turn.Arriving for why that is a different thing from a Subscriber.
	arriving func(chunk string)
}

// eva is what a console drives, and Control is the whole of what a console can
// reach of it.
var _ tui.Control = (*eva)(nil)

// Model is which model the turns that follow will use.
func (e *eva) Model() string { return e.model }

// UseModel switches the model, from the next turn on. The Session is not
// disturbed: what a model change is for is answering the same conversation with
// something else.
//
// Nothing here checks the name against a list. Eva holds no list, and one built
// from what was true when this was written would refuse a model released since
// — so the Provider is what answers, and a name it does not know fails the turn
// and says so in the words the Trace holds.
func (e *eva) UseModel(model string) { e.model = model }

// Clear empties the transcript by opening a new Session over the same identity,
// the same sink, and the same Provider. Session.Fresh has why it is a new one.
func (e *eva) Clear() { e.session = e.session.Fresh(events.SessionID(newID("sess"))) }

// Watch attaches the frontend that drives these turns. It is told what was
// committed after the Trace holds it, it is told what is arriving before any of
// it is committed, and it listens for a cancellation and lets the Run close
// rather than letting the process die under it.
//
// So it also claims the Interrupt capability. The claim is made here because
// this is where the listening is. A capability that is missing degrades a Run;
// a capability claimed and absent corrupts it, and a scheduler that routed work
// here on a false claim would have no way to find out — which is why the claim
// is not a field a Turn's builder can set on its own.
//
// This is the only door. Everything a Run learns about who is watching it comes
// through here, so the answer to "what does this Run claim, and who sees what it
// commits?" is Attach and the options a caller passed it.
func (e *eva) Watch(sub core.Subscriber, arriving func(chunk string)) {
	e.Attach(sub, WithArriving(arriving), WithInterrupt())
}

// Attach adds a projection to the ones this assembly's Runs publish to.
//
// It appends. Attaching used to assign a slice of one, so a second projection
// silently replaced the first and the Trace could be watched by exactly one
// thing — no metrics tap beside a console, no second screen, no machine-readable
// stream beside the one a person reads. A fan-out that admits one consumer is a
// field, not a fan-out.
//
// What a projection is, and what the frontend holding it can do, are two facts
// and this takes them separately. A console reads what was committed, is shown
// what is arriving, and claims the Interrupt capability; a stream written to a
// file does only the first. Bundling them made "attach a projection" and "claim
// a capability" one indivisible act, which is how a projection that watched
// nothing arrive would have claimed it could cancel cleanly.
func (e *eva) Attach(sub core.Subscriber, opts ...WatchOption) {
	if sub != nil {
		e.subs = append(e.subs, sub)
	}
	for _, opt := range opts {
		opt(e)
	}
}

// WatchOption is what a frontend says about itself as it attaches.
type WatchOption func(*eva)

// WithArriving says the frontend shows a turn while it happens. See
// Turn.Arriving for why that is a different thing from being a Subscriber.
func WithArriving(arriving func(chunk string)) WatchOption {
	return func(e *eva) { e.arriving = arriving }
}

// WithInterrupt claims that whoever is driving these turns listens for a
// cancellation and closes the Run, rather than letting the process die under it.
//
// It is claimed rather than assumed, and it is separate from attaching, because
// a capability claimed and absent corrupts a Run where a missing one only
// degrades it.
func WithInterrupt() WatchOption {
	return func(e *eva) { e.interrupt = true }
}

// Answer runs one turn as one Run against the Session.
//
// What is assembled here is only what changes between turns. Who is running,
// under which tenant, on whose clock — the Session holds all of it and opens
// the Run with it, so this asks for a Run rather than restating one.
//
// The argument is the Spec's intent, which is what a person typed at a prompt.
// The word "prompt" is spent on the package that holds the base system one, so
// the glossary's word is used here for the other thing.
func (e *eva) Answer(ctx context.Context, intent string) (core.Outcome, error) {
	recorder, err := e.session.Open(e.sink, e.subs...)
	if err != nil {
		return core.Outcome{}, err
	}

	turn := &Turn{
		Provider: e.provider,
		Recorder: recorder,
		Session:  e.session,
		Model:    e.model,
		// The base system prompt is the same for every turn of this build, and
		// its size is gated in CI, so what every Run of Eva spends before the
		// first word of the transcript is a figure the repository states.
		SystemPrompt: prompt.Base(),
		Interrupt:    e.interrupt,
		Arriving:     e.arriving,
	}

	return turn.Execute(ctx, core.Spec{
		Tenant: e.session.Tenant,
		Actor:  e.session.Actor,
		Intent: intent,
	})
}

// open builds the Provider configuration selects.
//
// What it knows about Providers is the name a person wrote and the settings
// they wrote beside it. Which Providers exist is the registry's, and each of
// them is in it because its own package put it there — so this reads the same
// however many there are, and the error naming what a person may choose instead
// is read from the registry rather than written out here where it would go
// stale.
//
// The file a mistake belongs to is added here. The registry does not know there
// is a file.
func open(cfg config.Config) (providers.Provider, error) {
	provider, err := providers.Open(cfg.Provider.Name, providers.Options{
		// Resolving the credential is deferred to the Provider that needs one:
		// a recording replayed from a file must not fail for want of an API key
		// it never sends. Reveal is the one place the secret leaves the type
		// that stops it printing itself, and it happens inside this call.
		Credential: func() (string, error) {
			key, err := cfg.RequireAPIKey()
			if err != nil {
				return "", err
			}
			return key.Reveal(), nil
		},
		BaseURL:   cfg.Provider.BaseURL,
		MaxTokens: cfg.Provider.MaxTokens,
		Recording: cfg.Provider.Script,
	})
	if err != nil {
		return nil, fmt.Errorf("%w (in %s)", err, cfg.Path)
	}
	return provider, nil
}

// origin is the outside world this process hands a Session: its clock, and its
// source of identifiers.
//
// It is assembled here because core is pure and has neither. It is handed over
// once, when the Session opens, so that every Run of a Session is stamped from
// one clock and one allocator — which is what lets the Session's own Events be
// ordered against each other.
func origin() core.Origin {
	return core.Origin{
		Now:     now,
		RunID:   func() events.RunID { return events.RunID(newID("run")) },
		EventID: func() events.EventID { return events.EventID(newID("evt")) },
	}
}

// start is when this process began, and the origin the monotonic reading on
// every Event is measured from.
var start = time.Now()

func now() events.Timestamp {
	return events.Timestamp{Wall: time.Now().UTC(), Mono: time.Since(start).Nanoseconds()}
}

// newID makes an identifier that is unique without a central allocator,
// because a Worker somewhere else will one day mint these too.
func newID(prefix string) string {
	var b [8]byte
	// crypto/rand.Read fills the slice or crashes the program: a process that
	// cannot generate an identifier cannot write a Trace either, so there is
	// nothing here to recover from.
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}
