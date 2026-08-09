package prompt_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/core/prompt"
)

// This is the gate. Every turn pays for the base system prompt before the
// transcript is sent, so a sentence added here is a sentence every Run of Eva
// buys — and a budget that lived in a document rather than in a check is one
// that a plausible paragraph walks past.
//
// A failure here is not a broken build. It is the prompt asking for more
// context than the project agreed to spend: cut it, or raise the budget on
// purpose and say why.
func TestTheBaseSystemPromptIsInsideItsBudget(t *testing.T) {
	if err := prompt.Fits(prompt.Base()); err != nil {
		t.Fatalf("%v", err)
	}
}

// A size gate passes on an empty file, so it cannot be the only thing said
// about the prompt. A base system prompt that was deleted would spend nothing
// and satisfy every byte comparison in this package.
func TestTheBaseSystemPromptSaysSomething(t *testing.T) {
	if strings.TrimSpace(prompt.Base()) == "" {
		t.Fatal("the base system prompt is empty: the budget is a ceiling, not the whole contract")
	}
}

// The gate refuses a prompt over the budget, and says both figures when it
// does.
//
// This is the deliberate inflation the ticket asks for, run as a test rather
// than as a change somebody has to remember to revert. It proves the
// comparison fires, and it proves the message names the size and the budget —
// which is what makes the failure actionable rather than only red.
func TestAPromptOverTheBudgetIsRefusedAndNamesBothFigures(t *testing.T) {
	inflated := prompt.Base() + strings.Repeat("x", prompt.Budget)

	err := prompt.Fits(inflated)
	if err == nil {
		t.Fatalf("a prompt of %d bytes passed a budget of %d", len(inflated), prompt.Budget)
	}
	for _, figure := range []string{strconv.Itoa(len(inflated)), strconv.Itoa(prompt.Budget)} {
		if !strings.Contains(err.Error(), figure) {
			t.Errorf("the refusal is %q, want it to name %s", err, figure)
		}
	}
}

// The comparison is on the byte count, at the boundary, and nothing else. Fits
// has why it is a size and never a duration.
func TestTheBudgetIsComparedAgainstBytes(t *testing.T) {
	for _, c := range []struct {
		name  string
		text  string
		wants bool
	}{
		{name: "exactly the budget fits", text: strings.Repeat("x", prompt.Budget), wants: true},
		{name: "one byte over does not", text: strings.Repeat("x", prompt.Budget+1), wants: false},
		{name: "nothing fits", text: "", wants: true},
		{
			// A context window is bought in tokens and a file is measured in
			// bytes, and the one thing the gate must not do is count
			// characters: half as many of these spend the whole budget.
			name:  "a multi-byte character costs what it weighs",
			text:  strings.Repeat("é", prompt.Budget/2+1),
			wants: false,
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			err := prompt.Fits(c.text)
			if fits := err == nil; fits != c.wants {
				t.Errorf("a text of %d bytes fits = %v, want %v (%v)", len(c.text), fits, c.wants, err)
			}
		})
	}
}
