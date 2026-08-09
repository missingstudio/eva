package theme_test

import (
	"image/color"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/theme"
)

// A person who configures nothing sees exactly what they saw before any of this
// could be configured. That is what the policy this package replaced was
// protecting, and it is the one property that must not slip.
func TestSettingNothingIsTheDefault(t *testing.T) {
	for _, dark := range []bool{true, false} {
		built, err := theme.Build(dark, theme.Settings{})
		if err != nil {
			t.Fatalf("build: %v", err)
		}

		want := theme.Default(dark)
		if built.Colors != want.Colors {
			t.Errorf("dark=%v colours = %+v, want %+v", dark, built.Colors, want.Colors)
		}
		if built.Symbols != want.Symbols {
			t.Errorf("dark=%v symbols = %+v, want %+v", dark, built.Symbols, want.Symbols)
		}
		if built.Layout != want.Layout {
			t.Errorf("dark=%v layout = %+v, want %+v", dark, built.Layout, want.Layout)
		}
	}
}

// The default is complete: every field has a value, so a Theme is never partly
// filled in and a file overrides fields of a whole one.
func TestTheDefaultIsComplete(t *testing.T) {
	for _, dark := range []bool{true, false} {
		d := theme.Default(dark)

		if d.Colors.Subdued == nil || d.Colors.Person == nil || d.Colors.Eva == nil {
			t.Errorf("dark=%v leaves a colour unset: %+v", dark, d.Colors)
		}
		if d.Symbols.Prompt == "" || d.Symbols.Placeholder == "" || d.Symbols.Truncation == "" || d.Symbols.Spinner == "" {
			t.Errorf("dark=%v leaves a symbol unset: %+v", dark, d.Symbols)
		}
		if d.Layout.PromptRows < 1 || d.Layout.CaptionSeconds < 1 {
			t.Errorf("dark=%v leaves a measurement unset: %+v", dark, d.Layout)
		}
	}
}

// Every setting a person can write reaches the Theme the interface draws with.
func TestEverySettingReachesTheTheme(t *testing.T) {
	prompt, placeholder, truncation := "» ", "type here", "..."
	rows, seconds := 4, 20

	built, err := theme.Build(true, theme.Settings{
		Subdued:        "#111111",
		Person:         "#222222",
		Eva:            "#333333",
		Spinner:        "#444444",
		SpinnerName:    theme.SpinnerPulse,
		Prompt:         &prompt,
		Placeholder:    &placeholder,
		Truncation:     &truncation,
		Border:         theme.BorderRounded,
		PromptRows:     &rows,
		CaptionSeconds: &seconds,
	})
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	if built.Symbols.Prompt != prompt || built.Symbols.Placeholder != placeholder || built.Symbols.Truncation != truncation {
		t.Errorf("symbols = %+v, want what was written", built.Symbols)
	}
	if built.Symbols.Spinner != theme.SpinnerPulse {
		t.Errorf("spinner = %q, want the one that was named", built.Symbols.Spinner)
	}
	if built.Layout.PromptRows != rows || built.Layout.CaptionSeconds != seconds {
		t.Errorf("layout = %+v, want what was written", built.Layout)
	}
	if built.Border == theme.Default(true).Border {
		t.Error("the border is the default after a different one was named")
	}
	for name, got := range map[string]any{
		"subdued": built.Colors.Subdued, "person": built.Colors.Person,
		"eva": built.Colors.Eva, "spinner": built.Colors.Spinner,
	} {
		if got == nil {
			t.Errorf("%s is unset after being written", name)
		}
	}
	if built.Colors.Subdued == theme.Default(true).Colors.Subdued {
		t.Error("subdued is the default colour after a different one was written")
	}
}

// An empty symbol is a choice: a person who wants no mark before their prompt
// writes one, and a person who wants the default leaves the line out.
func TestAnEmptySymbolIsAChoiceRatherThanAnAbsence(t *testing.T) {
	empty := ""
	built, err := theme.Build(true, theme.Settings{Prompt: &empty})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if built.Symbols.Prompt != "" {
		t.Errorf("prompt = %q, want the empty mark that was asked for", built.Symbols.Prompt)
	}
}

// What a person cannot have written is refused, and the message says what they
// may have meant.
func TestWhatCannotBeDrawnIsRefusedByName(t *testing.T) {
	rows := 0
	cases := []struct {
		name     string
		settings theme.Settings
		want     string
	}{
		{"a colour that is not one", theme.Settings{Subdued: "grey"}, "grey"},
		{"a colour missing its hash", theme.Settings{Person: "5C5C5C"}, "5C5C5C"},
		{"a colour of the wrong length", theme.Settings{Eva: "#12345"}, "#12345"},
		{"a spinner Eva does not draw", theme.Settings{SpinnerName: "helix"}, "helix"},
		{"a border Eva does not draw", theme.Settings{Border: "dashed"}, "dashed"},
		{"a prompt no rows tall", theme.Settings{PromptRows: &rows}, "0"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := theme.Build(true, c.settings)
			if err == nil {
				t.Fatal("it was accepted")
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("the refusal does not name %q: %v", c.want, err)
			}
		})
	}
}

// A terminal answers late about its own colour. Taking the answer must not
// undo what a person chose.
func TestABackgroundArrivingLateKeepsWhatWasChosen(t *testing.T) {
	prompt := "» "
	built, err := theme.Build(true, theme.Settings{Person: "#ABCDEF", Prompt: &prompt})
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	corrected := built.For(false)
	if corrected.Dark {
		t.Error("the Theme still says dark after a light terminal answered")
	}
	if corrected.Symbols.Prompt != prompt {
		t.Errorf("prompt = %q, want the chosen one kept across the correction", corrected.Symbols.Prompt)
	}
	if corrected.Colors.Person != built.Colors.Person {
		t.Error("a chosen colour was replaced when the background was corrected")
	}
	// The colours nobody chose are the ones that move.
	if corrected.Colors.Subdued == built.Colors.Subdued {
		t.Error("the subdued grey did not follow the background it adapts to")
	}
}

// A gradient is the accent in n steps, so a person who chose a colour gets
// their colour rather than a second one they never named.
func TestShadesAreTheAccentLightenedTowardsTheTop(t *testing.T) {
	base := theme.Default(true).Colors.Person
	got := theme.Shades(base, 8)

	if len(got) != 8 {
		t.Fatalf("got %d shades, want 8", len(got))
	}
	// The last step is the accent itself: the bar ends where the colour is.
	if got[len(got)-1] != rgba(base) {
		t.Errorf("the last shade is %v, want the accent %v", got[len(got)-1], rgba(base))
	}
	// And every step above it is lighter than the one below.
	for i := 1; i < len(got); i++ {
		if luminance(got[i-1]) <= luminance(got[i]) {
			t.Errorf("shade %d is not lighter than shade %d, so the bar has no direction", i-1, i)
		}
	}
}

// A caller with one step to draw gets the colour, not a division by zero.
func TestOneShadeIsTheColourItself(t *testing.T) {
	base := theme.Default(true).Colors.Person
	for _, n := range []int{-1, 0, 1} {
		if got := theme.Shades(base, n); len(got) != 1 {
			t.Errorf("Shades(base, %d) gave %d colours, want 1", n, len(got))
		}
	}
}

func rgba(c color.Color) color.RGBA {
	r, g, b, _ := c.RGBA()
	return color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: 0xFF}
}

func luminance(c color.Color) uint32 {
	r, g, b, _ := c.RGBA()
	return r + g + b
}
