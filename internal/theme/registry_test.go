package theme_test

import (
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/theme"
)

// A look can be named, and a name Eva does not know says what it does know.
//
// The set is read from the registry rather than written into the message, which
// is the same reason the Providers and the sinks do it: a sentence listing what a
// person may choose goes stale in the commit that adds one, and nothing fails
// when it does.
func TestAnUnknownLookNamesTheOnesEvaDraws(t *testing.T) {
	_, err := theme.Named("solarised", true)
	if err == nil {
		t.Fatal("a look Eva does not draw was accepted")
	}
	for _, name := range theme.Names() {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("the refusal does not name %q, which is a look Eva does draw: %v", name, err)
		}
	}
}

// Naming no look is the default look, because a person who named nothing has
// chosen nothing.
func TestNamingNoLookIsTheDefault(t *testing.T) {
	got, err := theme.Named("", true)
	if err != nil {
		t.Fatalf("the empty name was refused: %v", err)
	}
	if got.Colors.Subdued != theme.Default(true).Colors.Subdued {
		t.Error("naming nothing did not give the default look")
	}
}

// What a person writes is applied over the look they named, so a file can take a
// look and change one colour of it.
func TestSettingsAreAppliedOverTheNamedLook(t *testing.T) {
	person := "#ff0000"
	got, err := theme.Build(true, theme.Settings{Name: theme.Contrast, Person: person})
	if err != nil {
		t.Fatalf("build the contrast look with one colour changed: %v", err)
	}

	contrast, err := theme.Named(theme.Contrast, true)
	if err != nil {
		t.Fatal(err)
	}

	if got.Colors.Person == contrast.Colors.Person {
		t.Error("the colour written in the file did not replace the look's own")
	}
	if got.Colors.Subdued != contrast.Colors.Subdued {
		t.Error("a colour the file said nothing about did not come from the named look")
	}
	if got.Colors.Failure == nil {
		t.Error("the contrast look names no failure colour, so a failure reads as a hint")
	}
}

// The mono look names no colour at all, which is what a terminal that draws none
// needs and what anyone who wants none asks for.
func TestTheMonoLookNamesNoColour(t *testing.T) {
	got, err := theme.Named(theme.Mono, true)
	if err != nil {
		t.Fatal(err)
	}

	for name, colour := range map[string]any{
		"subdued":   got.Colors.Subdued,
		"person":    got.Colors.Person,
		"eva":       got.Colors.Eva,
		"spinner":   got.Colors.Spinner,
		"failure":   got.Colors.Failure,
		"heading":   got.Markdown.Heading,
		"code":      got.Markdown.Code,
		"emphasis":  got.Markdown.Emphasis,
		"link":      got.Markdown.Link,
		"quote":     got.Markdown.Quote,
		"codeblock": got.Markdown.CodeBlock,
	} {
		if colour != nil {
			t.Errorf("the mono look names a %s colour: %v", name, colour)
		}
	}

	// It is still a whole Theme. Everything that is not a colour is what Eva
	// draws, because a look that named no glyphs and no measurements would be a
	// partly filled Theme, which is the thing this package refuses to have.
	if got.Symbols.Prompt != theme.Default(true).Symbols.Prompt {
		t.Error("the mono look changed the prompt glyph, which is not a colour")
	}
	if got.Layout.PromptRows != theme.Default(true).Layout.PromptRows {
		t.Error("the mono look changed a measurement, which is not a colour")
	}
}

// A default Theme names no colour for the answer itself, so an answer is drawn
// exactly as it was before a Theme could name one. ADR 0030's rule, checked.
func TestTheDefaultLookLeavesTheAnswersOwnColoursAlone(t *testing.T) {
	got := theme.Default(true)
	if got.Markdown != (theme.Markdown{}) {
		t.Errorf("the default look names colours for the answer: %+v", got.Markdown)
	}
}
