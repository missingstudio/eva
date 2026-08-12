package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/trace"
	"github.com/missingstudio/eva/internal/tui"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

// stage is how much of a run has to be standing before a command can answer.
//
// It is declared beside each command because the ordering is a constraint and
// not a habit: what build this is has to be answerable on a machine where
// nothing else works yet, a status report has to answer for the credential that
// is missing rather than require one, and only a turn needs a Provider. Held as
// the order of statements in one function, those facts were true for exactly as
// long as nobody moved a line, and nothing anywhere would have failed when
// somebody did.
type stage uint8

const (
	// bare is a machine nothing is set up on, which is the machine version,
	// init and login exist for.
	bare stage = iota
	configured
	assembled
)

// command is a word eva is asked with.
//
// The turn is one of them, under the empty name. eva with no word is the
// console and eva -p is one turn on a stream, and what those need standing is
// the same kind of fact as what every other command needs — so it is a row in
// the table rather than the else of an if.
type command struct {
	// name is the word a person types, and is empty for the turn.
	name string
	// parse consumes the words that belong to this command and hands back the
	// rest for the flags. It is nil for a command that takes no words of its
	// own.
	parse func(args []string, opts *options) ([]string, error)
	needs stage
	do    func(ctx context.Context, r *run) error
}

// commands are the words eva answers to.
//
// It is a function rather than a variable because the entries close over
// nothing and the table is read twice per process — once to parse and once to
// dispatch. Both readings come from here, so a word that parses is a word that
// runs.
func commands() []command {
	return []command{
		{
			name:  "",
			needs: assembled,
			do: func(ctx context.Context, r *run) error {
				if r.opts.prompt != "" {
					return once(ctx, r.eva, r.opts.prompt, r.stdout, r.look)
				}
				return tui.Run(ctx, r.eva, r.stdin, r.stdout, tui.WithTheme(r.look), tui.WithKeymap(r.keys))
			},
		},
		{
			// Before any file is read. What build this is has to be answerable
			// on a machine where nothing else works yet, because that is the
			// machine whose owner is about to file the report.
			name:  "version",
			needs: bare,
			do:    func(_ context.Context, r *run) error { return versionReport(r.stdout) },
		},
		{
			// Before the configuration is read, because writing one is what a
			// person does when they have none — and a starter run that first
			// insisted on a valid file would be a command nobody could use for
			// its own purpose.
			name:  "init",
			needs: bare,
			do:    func(_ context.Context, r *run) error { return initialise(r.opts.config, r.stdout) },
		},
		{
			// Like init: logging in is what a person does when nothing else
			// works yet, so it does not first insist on a valid configuration.
			name: "login",
			parse: func(args []string, opts *options) ([]string, error) {
				if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
					opts.loginProvider, args = args[0], args[1:]
				}
				return args, nil
			},
			needs: bare,
			do:    func(ctx context.Context, r *run) error { return login(ctx, r.opts.loginProvider, r.stdout) },
		},
		{
			// After the configuration and before the Provider: a status report
			// must answer for the credential that is missing, so it cannot
			// require one.
			name: "auth",
			parse: func(args []string, _ *options) ([]string, error) {
				// One word under auth today. The refusal spells the whole
				// command so a person who typed half of it is handed the other
				// half.
				if len(args) == 0 || args[0] != "status" {
					return nil, errors.New(`auth is asked with a word: "eva auth status"`)
				}
				return args[1:], nil
			},
			needs: configured,
			do:    func(_ context.Context, r *run) error { return authStatus(r.cfg, r.stdout) },
		},
	}
}

// lookup finds the command a word asks for.
//
// The empty name belongs to the turn and is not a word anybody types, so a
// caller holding one that came from a command line has to refuse it before
// asking here.
func lookup(word string) (command, bool) {
	for _, c := range commands() {
		if c.name == word {
			return c, true
		}
	}
	return command{}, false
}

// run is what a command is handed: the streams it answers on, what the command
// line said, and as much of the machine as its stage needs standing.
//
// The fields past the streams are filled by perform in stage order and are the
// zero value for a command that declared it does not need them. A version
// report that read cfg would be reading a file it promised not to.
type run struct {
	opts   options
	stdin  io.Reader
	stdout io.Writer

	// cfg is the configuration, and is read for a command that needs one.
	cfg config.Config

	// eva, look and keys stand only for a command that needs an assembly.
	eva  *eva
	look theme.Theme
	keys keymap.Keymap
}

// perform builds as much of a run as the command needs, and answers with it.
func (r *run) perform(ctx context.Context) (err error) {
	cmd, found := lookup(r.opts.command)
	if !found {
		// parse sets a word only by finding it in this same table, so reaching
		// here means the table changed under a parser that did not.
		return fmt.Errorf("no command answers to %q", r.opts.command)
	}

	if cmd.needs == bare {
		return cmd.do(ctx, r)
	}

	cfg, err := config.Load(r.opts.config)
	if err != nil {
		return rejected(err)
	}
	r.cfg = cfg

	if cmd.needs == configured {
		return cmd.do(ctx, r)
	}

	finish, err := r.assemble()
	if err != nil {
		return err
	}
	// A Trace that failed to flush is not a successful run, whatever the turn
	// claimed.
	//
	// It does not replace a failure the turn already reported, and it is not
	// dropped for one either. A person who asked a question is owed why it went
	// unanswered; a person whose record did not reach the disk is owed the one
	// fact that says something was lost, and it is the fact nowhere else can
	// tell them.
	defer func() {
		cerr := finish()
		switch {
		case cerr == nil:
		case err == nil:
			err = cerr
		default:
			err = errors.Join(err, cerr)
		}
	}()
	return cmd.do(ctx, r)
}

// assemble builds what a turn is answered with — the Provider configuration
// selects, the sink every Event lands in, the Session both are folded into, and
// the look the answer is drawn in — and returns the close that ends the Trace.
//
// The look is resolved here rather than when a frontend opens, so that a file a
// person got wrong is reported whichever way they ran Eva. A theme that was
// only read when the console opened would make a broken configuration a thing
// that depends on how you started the program.
func (r *run) assemble() (func() error, error) {
	provider, err := open(r.cfg)
	if err != nil {
		return nil, rejected(err)
	}

	sink, err := trace.New(r.cfg.Trace.Kind, trace.Options{Path: r.cfg.Trace.Path})
	if err != nil {
		return nil, err
	}

	look, keys, err := appearance(r.cfg)
	if err != nil {
		// The sink is open and the configuration it was opened from is one Eva
		// will not act on. Its own failure to close on the way back out is not
		// what this person has to hear about instead.
		_ = sink.Close()
		return nil, rejected(err)
	}

	r.eva = &eva{
		provider:     provider,
		providerName: r.cfg.Provider.Name,
		sink:         sink,
		session:      core.NewSession(events.SessionID(newID("sess")), r.cfg.Tenant(), r.cfg.Actor(), origin()),
		// Where the name came from is written rather than left to the zero
		// value: it is the fact a remedy turns on, and a fact that is only true
		// because nobody set it is one an added field could quietly take away.
		model:  selection{name: r.cfg.Model, from: fromFile},
		editor: r.cfg.Editor,
		checks: checks{
			subscription: r.cfg.Subscription(),
			keyEnv:       r.cfg.Provider.APIKeyEnv,
			baseURL:      r.cfg.Provider.BaseURL,
			configPath:   r.cfg.Path,
			login:        storedLogin,
		},
	}
	r.look, r.keys = look, keys
	return sink.Close, nil
}
