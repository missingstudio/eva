package tui

import (
	"context"
	"fmt"
	"strings"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
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
	// run does the thing and says what to show for it.
	run func(r reach, argument string) string
}

// reach is the whole of what a Command may reach of the console it was typed
// at.
//
// It is the move Control makes, one layer in. Control exists so that what a
// frontend can reach is a list a reader can finish; a Command was then handed the
// console itself — every field, every method, the pane and the transcript among
// them — which gave back the discipline one layer down from where it was bought.
// /clear reached five of them.
//
// What is on this list is what a Command is for: the model that answers, what the
// Session has cost, emptying the transcript, and saying a line about any of it.
// What is not on it is the pane. ADR 0023's falsifier says the pane holds while
// every writer to it is downstream of a commit or of a person's own keystroke, and
// the writer it was aimed at is a future Command that puts something else there.
// That writer is now impossible to write rather than merely forbidden.
//
// Two adapters, so the seam is real: the Console, and a fake in command_test.go.
//
// It is named for what it is rather than for what it acts on. A Session is the
// durable, resumable transcript, and this is not that — it is one console's list
// of what a Command may touch, which is why the name that would read most
// naturally here is the one word this project will not spend twice.
type reach interface {
	// usingModel is which model answers the turns that follow, and useModel
	// switches it from the next turn on.
	usingModel() string
	useModel(name string)

	// spent is what this Session has cost so far, already drawn. It is a fold over
	// the Usage records the Trace holds, which is why a Command asks for it rather
	// than counting.
	spent() string

	// empty empties the transcript, and the Session behind it. Nothing is
	// destroyed: see clear, and ADR 0019.
	empty()

	// aside is a line in the interface's own voice — subdued, because a command's
	// answer is not part of the conversation.
	aside(text string) string
}

var _ reach = (*Console)(nil)

// The console's own half of that list. Each is one line, and each is the reason
// the list is short: a Command that wanted anything else would have to say so
// here, where a reader would see it.
func (c *Console) usingModel() string       { return c.control.Model() }
func (c *Console) useModel(name string)     { c.control.UseModel(name) }
func (c *Console) spent() string            { return c.renderer.Cost() }
func (c *Console) aside(text string) string { return c.styles.hint.Render(text) }

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

	// Remedy is what was checked about this machine after a turn failed this
	// way, and the one command that follows from it.
	//
	// It is here because the console cannot answer it. Telling a rejected
	// credential apart from an expired login means reading a configuration and
	// an auth store, and the whole point of this interface is that the console
	// reaches neither — so the question crosses instead, and the answer comes
	// back as the two sentences a person reads.
	//
	// The zero Remedy is the ordinary answer. Most failures have no step on
	// this side of the network, and one invented for them would be a guess in
	// Eva's own voice.
	//
	// It is asked when the turn fails rather than told when the Run opens,
	// because what makes a remedy checked is that it was checked now: a login
	// live at the first prompt is one of the commonest things to have expired
	// by the turn that fails.
	Remedy(class events.ErrorClass) render.Remedy

	// Editor is the program a person writes a long prompt in, and is the zero
	// Editor when this machine names none.
	//
	// It is asked when the key is pressed rather than told when the console is
	// built, because a person can export EDITOR in the shell they started Eva
	// from and expect it to be the one that opens.
	Editor() Editor

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
			run:   help,
		},
		{
			name:  "cost",
			about: "what this Session has cost so far",
			run:   cost,
		},
		{
			name:  "clear",
			about: "empty the transcript",
			run:   clear,
		},
		{
			name:     "model",
			argument: "[name]",
			about:    "report which model answers, or switch to another",
			run:      model,
		},
		{
			name:  "login",
			about: "where to log in to a subscription, which is not here",
			run:   login,
		},
	}
}

// help lists the commands, each with the one line that says what it does.
//
// It reads the table rather than a list written beside it, so a command added
// without a line here is impossible rather than merely undiscoverable.
func help(r reach, _ string) string {
	var listed strings.Builder
	for _, cmd := range commands() {
		typed := "/" + cmd.name
		if cmd.argument != "" {
			typed += " " + cmd.argument
		}
		fmt.Fprintf(&listed, "%-16s %s\n", typed, cmd.about)
	}
	return r.aside(strings.TrimRight(listed.String(), "\n"))
}

// model reports which model answers, or switches to another.
//
// A bare /model reports rather than switching. The alternative is a command
// that answers a mistyped line by switching to a model with no name, and the
// turn after it would fail somewhere in the Provider rather than here.
//
// The Session is untouched either way: what a switch is for is answering the
// same conversation with something else.
func model(r reach, name string) string {
	if name == "" {
		return r.aside("model " + r.usingModel())
	}
	was := r.usingModel()
	r.useModel(name)
	return r.aside("model " + was + " → " + name)
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
func login(r reach, _ string) string {
	return r.aside(`run "eva login" in a shell — a login opens a browser, and a command opens nothing`)
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
func cost(r reach, _ string) string { return r.spent() }

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
func clear(r reach, _ string) string {
	r.empty()
	return ""
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
