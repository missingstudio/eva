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

	"github.com/missingstudio/eva/internal/auth"
	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/loop"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/theme"

	// The Providers a build can select, each registering itself as it loads.
	_ "github.com/missingstudio/eva/internal/providers/anthropic"
	_ "github.com/missingstudio/eva/internal/providers/openai"
	"github.com/missingstudio/eva/internal/render"
	"github.com/missingstudio/eva/internal/tui"
	"github.com/missingstudio/eva/internal/tui/keymap"
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
  eva login              Log in to an OpenAI ChatGPT/Codex subscription
  eva auth status        Show how each turn authenticates
  eva init               Write a starter configuration
  eva version            Show the build, the toolchain, and the platform
  eva help               Show this help

FLAGS:
  --config <path>        Configuration file
  -p <prompt>            One turn, rendered to stdout; non-zero if it failed,
                         with why on stderr

CONFIG (env):
  %-20s   required when the provider is %q
  %-20s   required when the provider is %q with api_key auth,
                         and unused when a login authenticates instead
  %-20s   default: ~/.eva/config.toml
  %-20s   default: the user's home directory

In the console: enter sends, ctrl+c interrupts the turn in flight, ctrl+d
leaves, and /help lists the commands.
`, config.DefaultAPIKeyEnv, config.DefaultProvider,
	config.DefaultOpenAIAPIKeyEnv, auth.ProviderOpenAI,
	config.EnvConfig, config.EnvHome)

// Main runs eva and returns the process exit code.
//
// args is the command line without the program name. Reading and writing
// through the passed streams rather than through the process's own is what
// lets a test drive this with nothing attached, because a terminal is the
// thing CI does not have.
//
// This is also where being asked to stop is owned. Every layer below reaches
// the same conclusion from the same cancelled Context, so what a signal means
// is decided once, here, rather than by whichever library a frontend happens
// to be built on. See listen.
//
// It is the only function in the package that deals in exit codes. Everything
// below returns an error and nothing else, and what an error costs is code's
// answer — see exit.go for why that is one decision rather than fourteen.
func Main(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	// A refused command line is answered with the usage beside it, which is the
	// one diagnostic that is worth more than the sentence alone: a person who
	// got the words wrong is holding the list of the right ones before they can
	// ask for it.
	opts, err := parse(args)
	switch {
	case errors.Is(err, errHelp):
		_, _ = fmt.Fprint(stdout, usage)
		return ExitOK
	case err != nil:
		_, _ = fmt.Fprintf(stderr, "eva: %v\n\n%s", err, usage)
		return ExitUsage
	}

	// Before the run, so that a signal arriving during the first read of a file
	// is caught by Eva rather than by the runtime.
	ctx, asked, release := listen(context.Background())
	defer release()

	// stdout goes to the run and stderr does not, which is the whole of where a
	// diagnostic may be written. Commands write answers; what a failure costs
	// and what a person reads of it is decided here, and a command holding
	// stderr would be a command that could decide it too.
	answering := &run{opts: opts, stdin: stdin, stdout: stdout}

	err = answering.perform(ctx)
	report(stderr, err)

	// A signal outranks whatever the run made of it. The run reports what
	// happened to the turn; this reports what happened to the process, and a
	// process that stopped because it was told to did not succeed at staying
	// open however cleanly it went. Left to the frontend, a terminated console
	// exited zero and a supervisor read that as a job that finished.
	if s := asked(); s != nil {
		return stopCode(s)
	}
	return code(err)
}

// errHelp is the request for help, which is a successful command rather than
// a rejected one.
var errHelp = errors.New("help requested")

// options is the whole of what a command line can say.
//
// The words are one field rather than a flag each. A flag per word can say
// version and login at once, and the program then decides which of two things a
// person asked for by the order it happened to check them in — a decision
// nobody made, held nowhere anybody could read it. One field cannot say two
// things, so there is nothing to decide.
type options struct {
	config string
	// command is the word eva was asked with, and is empty for a turn — which
	// is what eva is with no word at all.
	command string
	// loginProvider is whose subscription a login is for, and is empty for the
	// one Provider that has a login.
	loginProvider string
	// prompt is one turn asked from the command line. It is empty for the
	// console, which is what eva is with nothing to answer.
	prompt string
}

// parse turns a command line into the whole of what it said.
//
// The words come from the command table, so a word that parses here is a word
// perform can dispatch. Two lists would let a word be accepted by one and
// unknown to the other, which is a command that exists until it is run.
func parse(args []string) (options, error) {
	if len(args) > 0 && args[0] == "help" {
		return options{}, errHelp
	}

	var opts options
	// The empty word belongs to the turn and is not something anybody types, so
	// `eva ""` stays what it was: an argument Eva does not know.
	if len(args) > 0 && args[0] != "" {
		if cmd, found := lookup(args[0]); found {
			opts.command, args = cmd.name, args[1:]
			if cmd.parse != nil {
				rest, err := cmd.parse(args, &opts)
				if err != nil {
					return options{}, err
				}
				args = rest
			}
		}
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

	// A word and a prompt are two things to do, and eva does one. Taken
	// together the word won and the prompt was dropped in silence, which is a
	// person watching Eva answer something they did not ask.
	if opts.command != "" && opts.prompt != "" {
		return options{}, fmt.Errorf("eva %s and -p are two things to do, and eva does one", opts.command)
	}
	return opts, nil
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
// render does not import core, deliberately: a fold that could reach a Session or
// the Trace could show a turn the record does not hold. That costs the
// assertion a package usually makes about itself, so the layer that builds a
// Renderer makes it instead. Without this line the guarantee rests on whichever
// call site happens to pass one as a Subscriber, and a refactor of that call
// site takes the guarantee with it and says nothing.
var _ core.Subscriber = (*render.Renderer)(nil)

// once answers one prompt onto a byte stream.
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
// Nothing watches the turn arrive. loop.Loop.Arriving is nil on this path,
// which is what ADR 0015 already says of a run with no live area: there is
// nothing to erase, so the answer is written when it is whole.
//
// It does claim the Interrupt capability, which it could not before. The claim
// is true because Main owns the signal: a person or a supervisor stopping this
// cancels the Context the turn runs under, and the Run then closes with a claim
// the same way a cancelled console turn does. Before that, a signal killed the
// process between two records and left a Run that opened and never closed —
// which is why ADR 0016 had this path disclaiming the capability, and why the
// disclaimer was honest rather than pessimistic.
//
// A failed turn exits non-zero and says why. The console has no exit code
// because it stays open; this does not stay open, so the claim the Trace holds
// is also the process's answer to whoever ran it.
//
// Neither the code nor the saying happens here. A turn that did not answer is
// returned as one, carrying the class and what was checked about this machine,
// and Main prices it and writes it — because a reason written where it is
// discovered is a reason every other path that discovers one writes in its own
// words. It exited in silence before any of this, which was the worst of the
// three: a script got a code with no reason, and a person got a shell prompt
// back and nothing at all.
func once(ctx context.Context, e *eva, prompt string, stdout io.Writer, look theme.Theme) error {
	// The Theme is the one a person configured, built for a dark terminal
	// because this path does not ask. Asking means writing a query to a
	// terminal and reading it back, and this path may have no terminal at all —
	// where it does not, lipgloss removes the escapes on the way out and the
	// assumption costs nothing.
	renderer, err := render.New(render.Stream(stdout), look)
	if err != nil {
		return err
	}
	e.Attach(renderer, WithInterrupt())

	outcome, err := e.Answer(ctx, prompt)
	if err != nil {
		return err
	}
	if outcome.Result != events.ResultDone {
		return unanswered{class: outcome.Class, remedy: e.Remedy(outcome.Class)}
	}
	return nil
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
	// providerName is what configuration selected the Provider by. It is held
	// beside the Provider rather than asked of it: the registry key is the
	// name, and a Provider that could answer with a second copy of it is a
	// Provider that could answer with a different one.
	providerName string
	sink         core.TraceSink
	session      *core.Session

	// model is which model the turns of this Session use, and where the name
	// came from.
	model selection

	// checks is what a failed turn's remedy is established from: the
	// configuration this assembly was opened with, and the store a login lives
	// in. See Remedy for why the checking lives in this layer and the sentence
	// does not.
	checks checks

	// interrupt says whether whoever is driving these turns listens for a
	// cancellation and closes the Run, rather than letting the process die
	// under it. It is a property of the frontend and not of a Loop, so it is
	// told rather than assumed: a capability claimed and absent corrupts a
	// Run, where a missing one only degrades it.
	interrupt bool

	// subs are the projections beyond the Session: the interface a person
	// reads the turn in.
	subs []core.Subscriber

	// arriving are who is watching the turn happen, and is empty when nobody
	// is. See loop.Loop.Arriving for why that is a different thing from a
	// Subscriber, and watching for why a Loop is still told exactly one.
	//
	// It is a slice for the reason subs is: a field admits one watcher, so the
	// second to attach replaced the first in silence and nothing anywhere said
	// the first had stopped being fed.
	arriving []func(chunk string)
}

// selection is which model a Session's turns use, and where the name came from.
//
// The provenance is remembered rather than worked out, because there is nothing
// to work it out from afterwards: a name switched with /model and a name read
// from a file are the same string by the time a turn fails, and telling
// somebody to edit a file that does not hold the model they are running is the
// kind of confident wrongness a remedy exists to avoid.
//
// It is a type rather than a string beside a bool because the bool answered a
// question nobody asked it in those words. What a remedy needs to know is where
// the name came from, and a source says that where a `chosen` said only that
// something had happened once.
type selection struct {
	name string
	from source
}

// source is where a model name came from.
type source uint8

const (
	// fromFile is the name a configuration holds, which is the one a person can
	// open and edit. It is the zero value because it is where every name starts.
	fromFile source = iota
	// fromSession is a name /model put in this Session, and is in no file.
	fromSession
)

// eva is what a console drives, and Control is the whole of what a console can
// reach of it.
var _ tui.Control = (*eva)(nil)

// Model is which model the turns that follow will use.
func (e *eva) Model() string { return e.model.name }

// UseModel switches the model, from the next turn on. The Session is not
// disturbed: what a model change is for is answering the same conversation with
// something else.
//
// Nothing here checks the name against a list. Eva holds no list, and one built
// from what was true when this was written would refuse a model released since
// — so the Provider is what answers, and a name it does not know fails the turn
// and says so in the words the Trace holds.
// It also records that the name is this Session's rather than the file's, so
// that a model the Provider will not serve is reported against the place it was
// actually chosen.
func (e *eva) UseModel(model string) { e.model = selection{name: model, from: fromSession} }

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
// is not a field a Loop's builder can set on its own.
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
// loop.Loop.Arriving for why that is a different thing from being a
// Subscriber.
//
// It appends, for the reason Attach does. A nil one is not a watcher and is
// dropped, so that a frontend which passes what it has can pass nothing.
func WithArriving(arriving func(chunk string)) WatchOption {
	return func(e *eva) {
		if arriving != nil {
			e.arriving = append(e.arriving, arriving)
		}
	}
}

// watching is the one function a Loop tells each chunk to, and is nil when
// nobody is watching.
//
// Nil rather than a closure over an empty slice, and that is the whole reason
// this exists: a Loop with an Arriving set has a live area to erase, and ADR
// 0015 turns on there being none when nothing is watching. A fan-out that was
// always non-nil would tell every run it had an audience.
func (e *eva) watching() func(chunk string) {
	if len(e.arriving) == 0 {
		return nil
	}
	return func(chunk string) {
		for _, watcher := range e.arriving {
			watcher(chunk)
		}
	}
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

	unit := &loop.Loop{
		Provider:     e.provider,
		ProviderName: e.providerName,
		Recorder:     recorder,
		Session:      e.session,
		Model:        e.model.name,
		// The base system prompt is the same for every turn of this build, and
		// its size is gated in CI, so what every Run of Eva spends before the
		// first word of the transcript is a figure the repository states.
		SystemPrompt: prompt.Base(),
		Interrupt:    e.interrupt,
		Arriving:     e.watching(),
	}

	return unit.Execute(ctx, core.Spec{
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
	// Resolving the credential is deferred to the Provider that needs one:
	// a recording replayed from a file must not fail for want of an API key
	// it never sends. Reveal is the one place the secret leaves the type
	// that stops it printing itself, and it happens inside this call.
	// The auth mode alone decides which credential a run uses. There is no
	// chain where an exported variable outranks a login or the reverse — a
	// person can read the file and know, and `eva auth status` names a set
	// key as unused rather than letting it silently win.
	//
	// The mode travels with the resolver rather than beside it, so there is no
	// way to hand a Provider a login's token labelled as an API key.
	credential := providers.APIKey(func() (string, error) {
		key, err := cfg.RequireAPIKey()
		if err != nil {
			return "", err
		}
		return key.Reveal(), nil
	})
	if cfg.Subscription() {
		resolve, err := subscriptionCredential(cfg)
		if err != nil {
			return nil, err
		}
		credential = providers.Subscription(resolve)
	}

	provider, err := providers.Open(cfg.Provider.Name, providers.Options{
		Credential: credential,
		BaseURL:    cfg.Provider.BaseURL,
		MaxTokens:  cfg.Provider.MaxTokens,
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
