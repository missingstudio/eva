package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
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

type options struct {
	config string
	// command is the word eva was asked with, and is empty for a turn — which
	// is what eva is with no word at all.
	command       string
	loginProvider string
	// prompt is one turn asked from the command line. It is empty for the
	// console, which is what eva is with nothing to answer.
	prompt string
}

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

func appearance(cfg config.Config) (theme.Theme, keymap.Keymap, error) {
	look, err := theme.Build(true, theme.Settings{
		Name:           cfg.Theme.Name,
		Subdued:        cfg.Theme.Colors.Subdued,
		Failure:        cfg.Theme.Colors.Failure,
		Plain:          cfg.Theme.Markdown.Plain,
		Heading:        cfg.Theme.Markdown.Heading,
		Code:           cfg.Theme.Markdown.Code,
		CodeBlock:      cfg.Theme.Markdown.CodeBlock,
		Emphasis:       cfg.Theme.Markdown.Emphasis,
		Link:           cfg.Theme.Markdown.Link,
		LinkText:       cfg.Theme.Markdown.LinkText,
		Quote:          cfg.Theme.Markdown.Quote,
		Person:         cfg.Theme.Colors.Person,
		Eva:            cfg.Theme.Colors.Eva,
		Spinner:        cfg.Theme.Colors.Spinner,
		SpinnerName:    cfg.Theme.Symbols.Spinner,
		Prompt:         cfg.Theme.Symbols.Prompt,
		Placeholder:    cfg.Theme.Symbols.Placeholder,
		Truncation:     cfg.Theme.Symbols.Truncation,
		Border:         cfg.Theme.Border,
		Margin:         sides(cfg.Theme.Layout.Margin),
		Padding:        sides(cfg.Theme.Layout.Padding),
		PromptRows:     cfg.Theme.Layout.PromptRows,
		CaptionSeconds: cfg.Theme.Layout.CaptionSeconds,
		ElapsedSeconds: cfg.Theme.Layout.ElapsedSeconds,
		LiveShare:      cfg.Theme.Layout.LiveShare,
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

func sides(written config.SidesConfig) theme.Sides {
	return theme.Sides{
		Top:    written.Top,
		Right:  written.Right,
		Bottom: written.Bottom,
		Left:   written.Left,
	}
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
var _ core.Subscriber = (*render.Renderer)(nil)

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
type eva struct {
	provider providers.Provider
	// providerName is what configuration selected the Provider by. It is held
	// beside the Provider rather than asked of it: the registry key is the
	// name, and a Provider that could answer with a second copy of it is a
	// Provider that could answer with a different one.
	providerName string
	sink         core.TraceSink
	session      *core.Session

	model selection

	// editor is the program a long prompt is written in, as the configuration
	// named it. It is empty when the configuration named none, and the
	// environment answers instead — see Editor.
	editor string

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

	subs []core.Subscriber

	// arriving are who is watching the turn happen, and is empty when nobody
	// is. See loop.Loop.Arriving for why that is a different thing from a
	// Subscriber, and watching for why a Loop is still told exactly one.
	arriving []func(chunk string)
}

type selection struct {
	name string
	from source
}

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

func (e *eva) Editor() tui.Editor {
	named := e.editor
	for _, envvar := range []string{"VISUAL", "EDITOR"} {
		if named != "" {
			break
		}
		named = strings.TrimSpace(os.Getenv(envvar))
	}

	fields := strings.Fields(named)
	if len(fields) == 0 {
		return tui.Editor{}
	}
	return tui.Editor{Command: fields[0], Args: fields[1:]}
}

func (e *eva) Model() string { return e.model.name }

// UseModel switches the model, from the next turn on. The Session is not
// disturbed: what a model change is for is answering the same conversation with
// something else.
func (e *eva) UseModel(model string) { e.model = selection{name: model, from: fromSession} }

// Clear empties the transcript by opening a new Session over the same identity,
// the same sink, and the same Provider. Session.Fresh has why it is a new one.
func (e *eva) Clear() { e.session = e.session.Fresh(events.SessionID(newID("sess"))) }

// Watch attaches the frontend that drives these turns. It is told what was
// committed after the Trace holds it, it is told what is arriving before any of
// it is committed, and it listens for a cancellation and lets the Run close
// rather than letting the process die under it.
func (e *eva) Watch(sub core.Subscriber, arriving func(chunk string)) {
	e.Attach(sub, WithArriving(arriving), WithInterrupt())
}

func (e *eva) Attach(sub core.Subscriber, opts ...WatchOption) {
	if sub != nil {
		e.subs = append(e.subs, sub)
	}
	for _, opt := range opts {
		opt(e)
	}
}

type WatchOption func(*eva)

// WithArriving says the frontend shows a turn while it happens. See
// loop.Loop.Arriving for why that is a different thing from being a
// Subscriber.
func WithArriving(arriving func(chunk string)) WatchOption {
	return func(e *eva) {
		if arriving != nil {
			e.arriving = append(e.arriving, arriving)
		}
	}
}

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
func WithInterrupt() WatchOption {
	return func(e *eva) { e.interrupt = true }
}

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

func open(cfg config.Config) (providers.Provider, error) {
	// Resolving the credential is deferred to the Provider that needs one: a
	// recording replayed from a file must not fail for want of an API key it
	// never sends. Reveal is the one place the secret leaves the type that
	// stops it printing itself, and it happens inside this call. The auth mode
	// alone decides which credential a run uses.
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
