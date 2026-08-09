package cli

import (
	"fmt"
	"strings"
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
	run func(c *console, argument string) string
}

// control is what a command may reach of the assembly behind the console.
//
// It is a short list of narrow methods rather than the assembly itself, for the
// reason ask is a function: everything the interface could do with a Provider,
// a Recorder, or the Trace is something it must not do. What a person may
// change from a console is which model answers and whether the transcript is
// empty, and this is the whole of it.
//
// Nothing here takes a lock. A command runs in the update loop, and the update
// loop only reaches a command when no Run is in flight — so the goroutine that
// would otherwise be reading these has already returned.
type control interface {
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
			run:   (*console).help,
		},
		{
			name:  "cost",
			about: "what the last turn cost, and the Session so far",
			run:   (*console).cost,
		},
		{
			name:  "clear",
			about: "empty the transcript",
			run:   (*console).clear,
		},
		{
			name:     "model",
			argument: "[name]",
			about:    "report which model answers, or switch to another",
			run:      (*console).model,
		},
	}
}

// help lists the commands, each with the one line that says what it does.
//
// It reads the table rather than a list written beside it, so a command added
// without a line here is impossible rather than merely undiscoverable.
func (c *console) help(string) string {
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
func (c *console) model(name string) string {
	if name == "" {
		return c.styles.hint.Render("model " + c.control.Model())
	}
	was := c.control.Model()
	c.control.UseModel(name)
	return c.styles.hint.Render("model " + was + " → " + name)
}

// cost is what the last turn cost and what the Session has cost so far.
//
// The figures come from the Renderer rather than from a count kept beside it.
// Both are folds over the Usage records the Trace holds, and a second count
// could disagree with the line printed at the end of a turn — leaving a person
// two figures for one Session and no way to tell which is the record.
func (c *console) cost(string) string { return c.renderer.Cost() }

// clear empties the transcript, and the spend with it, because both belong to
// the Session that is being left behind. Session.Fresh has the argument.
func (c *console) clear(string) string {
	c.control.Clear()
	c.renderer.Cleared()
	return c.styles.hint.Render("transcript cleared — the turns that follow are a new Session")
}

// obey answers what was typed at the console rather than sending it to the
// model.
//
// A leading slash is a person addressing eva rather than the model, so an
// unknown one is answered here. A typo forwarded to a provider is a typo that
// costs money and comes back as a guess at what was meant.
func (c *console) obey(typed string) string {
	name, argument, _ := strings.Cut(strings.TrimPrefix(typed, "/"), " ")
	argument = strings.TrimSpace(argument)

	for _, cmd := range commands() {
		if cmd.name == name {
			return cmd.run(c, argument)
		}
	}
	return c.styles.hint.Render("/" + name + " is not a command — /help lists them")
}
