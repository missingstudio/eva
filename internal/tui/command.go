package tui

import (
	"context"
	"fmt"
	"strings"

	"github.com/missingstudio/eva/internal/core"
)

// command is one thing a person types in the console instead of a prompt.
//
// It answers with the block to go above the view rather than printing one. So
// what a command says is a value a test can read, and the console keeps the
// single path to the screen it already has.
type command struct {
	// name is what follows the slash.
	name string
	// argument names what may follow the name, and is empty for a command that
	// takes none. /help shows it.
	argument string
	// about is the one line /help gives this command.
	about string
	// run does the thing and says what to show for it. It takes the console
	// because every command acts on the Session behind one.
	run func(c *Console, argument string) string
}

// Control is the whole of what a console may reach of the assembly behind it.
//
// It is a short list of narrow methods rather than the assembly itself:
// everything the interface could do with a Provider, a Recorder, or the Trace
// is something it must not do. Before, that was a discipline held by passing a
// function instead of the assembly. Here it is a type, so what a frontend can
// reach is a list a reader can finish rather than a rule a reader must trust.
//
// The first two methods are the turn; the last three are what a person may
// change about the turns that follow.
//
// Nothing here takes a lock. A command runs in the update loop, and the update
// loop only reaches a command when no Run is in flight — so the goroutine that
// would otherwise be reading these has already returned.
type Control interface {
	// Answer runs one turn as one Run, and returns when the Run is closed.
	Answer(ctx context.Context, intent string) (core.Outcome, error)
	// Watch attaches the frontend that drives these turns: what was committed,
	// what is arriving, and the Interrupt capability that listening claims.
	Watch(sub core.Subscriber, arriving func(chunk string))

	// About is what this console can say about the run behind it before anyone
	// has asked anything: the build, the branch, the directory.
	About() About

	// Model is which model the turns that follow will use.
	Model() string
	// UseModel switches it, from the next turn on.
	UseModel(model string)
	// Clear empties the transcript.
	Clear()
}

// commands are the commands, in the order /help lists them.
//
// It is a function rather than a variable because /help is one of the commands
// and reads the list: a variable whose initializer named a function that read
// the variable is a variable defined in terms of itself, which Go rejects.
// Rebuilding the table per command typed costs nothing worth measuring.
func commands() []command {
	return []command{
		{
			name:  "help",
			about: "list these commands",
			run:   (*Console).help,
		},
		{
			name:  "cost",
			about: "what this Session has cost so far",
			run:   (*Console).cost,
		},
		{
			name:  "clear",
			about: "empty the transcript",
			run:   (*Console).clear,
		},
		{
			name:     "model",
			argument: "[name]",
			about:    "report which model answers, or switch to another",
			run:      (*Console).model,
		},
		{
			name:  "login",
			about: "where to log in to a subscription, which is not here",
			run:   (*Console).login,
		},
	}
}

// help lists the commands, each with the one line that says what it does.
//
// It reads the table rather than a list written beside it, so a command added
// without a line here is impossible rather than merely undiscoverable.
func (c *Console) help(string) string {
	var listed strings.Builder
	for _, cmd := range commands() {
		typed := "/" + cmd.name
		if cmd.argument != "" {
			typed += " " + cmd.argument
		}
		fmt.Fprintf(&listed, "%-16s %s\n", typed, cmd.about)
	}
	return c.styles.hint.Render(strings.TrimRight(listed.String(), "\n"))
}

// model reports which model answers, or switches to another.
//
// A bare /model reports rather than switching. The alternative is a command
// that answers a mistyped line by switching to a model with no name, and the
// turn after it would fail somewhere in the Provider rather than here.
//
// The Session is untouched either way: what a switch is for is answering the
// same conversation with something else.
func (c *Console) model(name string) string {
	if name == "" {
		return c.styles.hint.Render("model " + c.control.Model())
	}
	was := c.control.Model()
	c.control.UseModel(name)
	return c.styles.hint.Render("model " + was + " → " + name)
}

// login says where a login happens, and it is not here.
//
// A Login opens a browser and waits for a person to come back, which is
// everything a Command is not: a command opens no Run, reaches nothing over a
// network, and leaves no record. So this is the one command that answers by
// naming what does the work instead of doing it.
//
// It is a command at all because the alternative is a person typing /login,
// being told there is no such command, and having no idea what there is
// instead. An answer that points somewhere is worth more than a refusal.
func (c *Console) login(string) string {
	return c.styles.hint.Render(`run "eva login" in a shell — a login opens a browser, and a command opens nothing`)
}

// cost is what the Session has cost so far.
//
// The figures come from the Renderer rather than from a count kept beside it.
// It is a fold over the Usage records the Trace holds, and the same fold the
// footer shows — a second count could disagree with it, leaving a person two
// figures for one Session and no way to tell which is the record.
//
// It is the Session and not the last turn. A per-turn figure was reported here
// too, and it was the one that aged fastest: true for a turn, restated on the
// next, and never the number anybody is deciding on.
func (c *Console) cost(string) string { return c.renderer.Cost() }

// clear empties the transcript, and the spend with it, because both belong to
// the Session that is being left behind. Session.Fresh has the argument.
//
// The pane is emptied too. It was not, while what a person had read sat in the
// terminal's own scrollback and no program could reach it; now the console holds
// it, and a command whose whole job is to empty a transcript that leaves the
// transcript on screen is a command that has to be explained every time it is
// used.
//
// It says nothing when it is done. An empty screen is what was asked for and it
// is its own evidence — a line reporting the emptiness would be the only thing
// on screen, which is to say the command would not have emptied it. This is the
// one command with nothing to answer.
//
// Nothing is destroyed by this. The Trace holds every Event of the Session being
// left, and holds them after this returns exactly as it held them before —
// emptying a pane closes a window on evidence rather than touching it.
func (c *Console) clear(string) string {
	c.control.Clear()
	c.renderer.Cleared()

	// Back to the top before the content goes, so that a person who had
	// scrolled up is not left at an offset into a transcript that no longer
	// reaches that far.
	c.transcript = nil
	c.pane.GotoTop()
	c.refresh()

	return ""
}

// complete fills in a command name from however much of it has been typed, and
// offers the next match each time it is asked again.
//
// It reads the same table /help reads, so a command cannot be completable and
// undocumented, or documented and not completable. That is the whole reason the
// table is a table.
//
// Cycling rather than listing: there are four commands, and a list would have to
// go somewhere — the transcript, which is for what was answered, or the status
// line, which is for what a turn is doing. Pressing tab twice is cheaper than
// either, and it is what a person does anyway to see the next one.
func (c *Console) complete() {
	if c.completing == "" {
		typed := c.input.Value()
		// A slash and nothing but a name so far. Once there is a space the
		// person is writing an argument, and no table here knows what a model
		// is called.
		if !strings.HasPrefix(typed, "/") || strings.ContainsAny(typed, " \n") {
			return
		}
		c.completing = typed
		c.completed = -1
	}

	matches := matching(strings.TrimPrefix(c.completing, "/"))
	if len(matches) == 0 {
		c.completing = ""
		return
	}

	c.completed = (c.completed + 1) % len(matches)
	c.input.SetValue("/" + matches[c.completed] + " ")
}

// matching is every command whose name starts with what has been typed.
func matching(prefix string) []string {
	var out []string
	for _, cmd := range commands() {
		if strings.HasPrefix(cmd.name, prefix) {
			out = append(out, cmd.name)
		}
	}
	return out
}

// obey answers what was typed at the console rather than sending it to the
// model.
//
// A leading slash is a person addressing eva rather than the model, so an
// unknown one is answered here. A typo forwarded to a provider is a typo that
// costs money and comes back as a guess at what was meant.
func (c *Console) obey(typed string) string {
	name, argument, _ := strings.Cut(strings.TrimPrefix(typed, "/"), " ")
	argument = strings.TrimSpace(argument)

	for _, cmd := range commands() {
		if cmd.name == name {
			return cmd.run(c, argument)
		}
	}
	return c.styles.hint.Render("/" + name + " is not a command — /help lists them")
}
