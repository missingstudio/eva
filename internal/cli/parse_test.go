package cli

import "testing"

func TestEveryCommandTheTableHoldsIsAWordEvaAnswersTo(t *testing.T) {
	// The words a command needs beside its own, for the one command that takes
	// any.
	beside := map[string][]string{"auth": {"status"}}

	for _, cmd := range commands() {
		// The turn is the empty name: eva with no word at all.
		if cmd.name == "" {
			continue
		}

		t.Run(cmd.name, func(t *testing.T) {
			opts, err := parse(append([]string{cmd.name}, beside[cmd.name]...))
			if err != nil {
				t.Fatalf("eva %s: %v", cmd.name, err)
			}
			if opts.command != cmd.name {
				t.Fatalf("eva %s parsed as %q", cmd.name, opts.command)
			}
			if _, found := lookup(opts.command); !found {
				t.Errorf("eva %s parses to a word nothing answers to", cmd.name)
			}
		})
	}
}

func TestAWordAndAPromptAreRefusedTogether(t *testing.T) {
	if _, err := parse([]string{"init", "-p", "say something"}); err == nil {
		t.Error("eva init -p was accepted, and one of the two was going to be ignored")
	}
}

// A word Eva does not know is an argument Eva does not know.
func TestAWordEvaDoesNotKnowIsRefused(t *testing.T) {
	for _, args := range [][]string{{"bogus"}, {""}} {
		if _, err := parse(args); err == nil {
			t.Errorf("eva %q was accepted", args)
		}
	}
}

// A command line with no word at all is a turn, which is the one row of the
// table nobody types.
func TestNoWordAtAllIsATurn(t *testing.T) {
	opts, err := parse(nil)
	if err != nil {
		t.Fatalf("eva on its own: %v", err)
	}
	if opts.command != "" {
		t.Errorf("eva on its own asked for %q", opts.command)
	}

	cmd, found := lookup(opts.command)
	if !found {
		t.Fatal("nothing answers to eva on its own")
	}
	if cmd.needs != assembled {
		t.Errorf("a turn needs stage %d, want %d — a turn is the one thing that needs a Provider", cmd.needs, assembled)
	}
}
