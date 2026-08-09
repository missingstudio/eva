// Package theme is every colour, glyph, and measurement an interface draws
// with.
//
// It holds no terminal and no Event. What it knows is what a thing should look
// like, which is why it can be handed to a console and to a fold without either
// of them learning where the answer came from.
//
// # Why this is configurable, and why the default is not a choice
//
// The style used to be inline, and the comments beside it said why: a style
// nobody chose is the only style there is, and a style a person had to select
// is a style most people never select. Both are true of a default and neither
// is an argument against a file. What they are an argument against is a first
// run that asks — so Default is complete, every field of it, and a person who
// configures nothing sees exactly what they saw before this package existed.
//
// The reason the policy could not stand is that Eva's interface is meant to be
// extended by people who did not write it. A harness whose frontends are an
// extension point cannot hold "nothing is configurable" as a permanent rule
// about the one surface those extensions draw on.
package theme

import (
	"fmt"
	"image/color"
	"regexp"
	"strings"

	"charm.land/lipgloss/v2"
)

// Theme is how an interface looks.
//
// Every field has a value in Default, so a Theme is never partly filled in: a
// file overrides fields of a complete Theme rather than supplying one. A zero
// Theme is not a valid one, and Default is how you get a valid one.
type Theme struct {
	// Dark says which background this Theme was built for. It is not a
	// preference — it is the terminal's own answer — and it is here because
	// every adaptive colour below was already resolved against it.
	Dark bool

	Colors  Colors
	Symbols Symbols
	Layout  Layout

	// Border is the rule drawn above and below the prompt.
	Border lipgloss.Border

	// settings is what a person asked to change, kept so that a background
	// arriving late can be taken without discarding it. See For.
	settings Settings
}

// Colors are the hues an interface uses, already resolved for one background.
//
// There are four, and the smallness is the design. The answer is what a person
// came for, so everything the interface says about itself is grey; the two
// gutter marks are the exception, because scrolling back is looking for a
// boundary rather than reading, and a hue is what the eye finds without
// reading.
type Colors struct {
	// Subdued is what the interface says about itself: the status line, the
	// cost, the rule around the prompt, the hints.
	Subdued color.Color
	// Person marks what a person said, down the left of the transcript.
	Person color.Color
	// Eva marks what Eva said. It is the subdued grey by default, because
	// there is far more of Eva on screen and a hue down the side of every
	// answer is a hue nobody sees.
	Eva color.Color
	// Spinner is the one thing not subdued. A faint spinner is a spinner
	// nobody can see moving, and its whole job is to be seen moving.
	Spinner color.Color
}

// Symbols are the marks an interface writes that are not words.
type Symbols struct {
	// Prompt is what sits before the line a person types, and before the same
	// line echoed into the transcript.
	Prompt string
	// Placeholder is what an empty prompt says.
	Placeholder string
	// Truncation ends a line that did not fit.
	Truncation string
	// Spinner names the frames a turn in flight is shown with.
	Spinner string
}

// Layout is the measurements, in cells and in seconds.
type Layout struct {
	// PromptRows is how tall the prompt may grow before it scrolls within
	// itself. A prompt free to grow to the window would push the answer off
	// the top, and what a person is writing is rarely worth more of the screen
	// than what they are reading.
	PromptRows int
	// CaptionSeconds is how long one caption stays before another is chosen.
	CaptionSeconds int
}

// Default is the complete Theme for a background: exactly what Eva looked like
// before any of this could be configured.
//
// Every value here is the one that was inline. A person who configures nothing
// must see no change, this release or any after, which is the whole of what the
// policy this replaced was protecting.
func Default(dark bool) Theme {
	return Theme{
		Dark: dark,
		Colors: Colors{
			Subdued: pick(dark, subduedOnLight, subduedOnDark),
			Person:  pick(dark, personOnLight, personOnDark),
			Eva:     pick(dark, subduedOnLight, subduedOnDark),
			Spinner: nil,
		},
		Symbols: Symbols{
			Prompt:      "› ",
			Placeholder: "ask something",
			Truncation:  "…",
			Spinner:     SpinnerMiniDot,
		},
		Layout: Layout{
			PromptRows:     10,
			CaptionSeconds: 8,
		},
		Border: lipgloss.NormalBorder(),
	}
}

// The greys and the person's mark, one of each per background. All are true
// colour and none is emitted as written: what reaches the terminal is
// downsampled to what the terminal can show.
//
// The person's mark is chosen to sit beside the greys rather than compete with
// them. It has to be findable at a glance down a column two characters wide,
// and nothing more is asked of it.
var (
	subduedOnLight = lipgloss.Color("#5C5C5C")
	subduedOnDark  = lipgloss.Color("#9E9E9E")
	personOnLight  = lipgloss.Color("#2F6FB2")
	personOnDark   = lipgloss.Color("#7AA6DC")
)

// The spinners a turn in flight may be shown with. They are named rather than
// described because the frames belong to the library that animates them.
const (
	SpinnerMiniDot = "minidot"
	SpinnerDot     = "dot"
	SpinnerLine    = "line"
	SpinnerPulse   = "pulse"
	SpinnerPoints  = "points"
)

// Spinners is every name a configuration may select, sorted, for an error that
// has to say what a person may have meant.
func Spinners() []string {
	return []string{SpinnerDot, SpinnerLine, SpinnerMiniDot, SpinnerPoints, SpinnerPulse}
}

// The borders a configuration may select around the prompt.
const (
	BorderNormal  = "normal"
	BorderRounded = "rounded"
	BorderThick   = "thick"
	BorderDouble  = "double"
	BorderNone    = "none"
)

// Borders is every name a configuration may select, sorted.
func Borders() []string {
	return []string{BorderDouble, BorderNone, BorderNormal, BorderRounded, BorderThick}
}

// Subdued is the style the interface says everything about itself in.
//
// It is a method rather than a package function so that a console and a fold
// take it from one Theme and cannot end up naming two greys that happen to
// agree.
func (t Theme) Subdued() lipgloss.Style {
	return lipgloss.NewStyle().Faint(true).Foreground(t.Colors.Subdued)
}

func pick(dark bool, onLight, onDark color.Color) color.Color {
	if dark {
		return onDark
	}
	return onLight
}

// Settings is what a person wrote, with every field optional.
//
// It is separate from Theme because the two answer different questions. A Theme
// is complete and says what the interface looks like now; Settings is partial
// and says what a person asked to change. Keeping both is what lets a terminal
// answer late about its own colour without undoing a decision: the Theme is
// rebuilt for the background that arrived, and these are applied over it again.
type Settings struct {
	Subdued     string
	Person      string
	Eva         string
	Spinner     string
	SpinnerName string

	Prompt      *string
	Placeholder *string
	Truncation  *string

	Border string

	PromptRows     *int
	CaptionSeconds *int
}

// Build makes a complete Theme for a background from what a person asked to
// change. A Settings that says nothing gives exactly Default.
func Build(dark bool, s Settings) (Theme, error) {
	t := Default(dark)
	t.settings = s

	var err error
	if t.Colors.Subdued, err = hue(s.Subdued, t.Colors.Subdued, "subdued"); err != nil {
		return Theme{}, err
	}
	if t.Colors.Person, err = hue(s.Person, t.Colors.Person, "person"); err != nil {
		return Theme{}, err
	}
	if t.Colors.Eva, err = hue(s.Eva, t.Colors.Eva, "eva"); err != nil {
		return Theme{}, err
	}
	if t.Colors.Spinner, err = hue(s.Spinner, t.Colors.Spinner, "spinner"); err != nil {
		return Theme{}, err
	}

	if s.SpinnerName != "" {
		if !known(Spinners(), s.SpinnerName) {
			return Theme{}, fmt.Errorf("theme: %q is not a spinner Eva draws (it draws: %s)",
				s.SpinnerName, strings.Join(Spinners(), ", "))
		}
		t.Symbols.Spinner = s.SpinnerName
	}
	if s.Border != "" {
		border, ok := borderNamed(s.Border)
		if !ok {
			return Theme{}, fmt.Errorf("theme: %q is not a border Eva draws (it draws: %s)",
				s.Border, strings.Join(Borders(), ", "))
		}
		t.Border = border
	}

	if s.Prompt != nil {
		t.Symbols.Prompt = *s.Prompt
	}
	if s.Placeholder != nil {
		t.Symbols.Placeholder = *s.Placeholder
	}
	if s.Truncation != nil {
		t.Symbols.Truncation = *s.Truncation
	}

	if s.PromptRows != nil {
		if *s.PromptRows < 1 {
			return Theme{}, fmt.Errorf("theme: a prompt cannot be %d rows tall", *s.PromptRows)
		}
		t.Layout.PromptRows = *s.PromptRows
	}
	if s.CaptionSeconds != nil {
		if *s.CaptionSeconds < 1 {
			return Theme{}, fmt.Errorf("theme: a caption cannot stay for %d seconds", *s.CaptionSeconds)
		}
		t.Layout.CaptionSeconds = *s.CaptionSeconds
	}
	return t, nil
}

// For rebuilds this Theme for a background, keeping what a person chose.
//
// A terminal answers late about its own colour, so the Theme an interface
// starts with is built against an assumption. This is how the answer is taken:
// the adaptive colours become the ones for the background that arrived, and the
// choices are applied over them again.
func (t Theme) For(dark bool) Theme {
	// The settings were accepted when this Theme was built, so they cannot fail
	// now. A background is not one of the things they can be wrong about.
	rebuilt, err := Build(dark, t.settings)
	if err != nil {
		return t
	}
	return rebuilt
}

// hue reads a colour a person wrote, or keeps the one that was there.
func hue(written string, fallback color.Color, name string) (color.Color, error) {
	if written == "" {
		return fallback, nil
	}
	if !hex.MatchString(written) {
		return nil, fmt.Errorf("theme: %s = %q is not a colour (write one as #rgb or #rrggbb)", name, written)
	}
	return lipgloss.Color(written), nil
}

// hex is what a colour a person writes has to look like. Only hex is accepted:
// a named colour would mean carrying a table of names, and a terminal index
// would mean a colour whose appearance depends on a palette Eva cannot see.
var hex = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

func borderNamed(name string) (lipgloss.Border, bool) {
	switch name {
	case BorderNormal:
		return lipgloss.NormalBorder(), true
	case BorderRounded:
		return lipgloss.RoundedBorder(), true
	case BorderThick:
		return lipgloss.ThickBorder(), true
	case BorderDouble:
		return lipgloss.DoubleBorder(), true
	case BorderNone:
		return lipgloss.HiddenBorder(), true
	default:
		return lipgloss.Border{}, false
	}
}

func known(set []string, want string) bool {
	for _, s := range set {
		if s == want {
			return true
		}
	}
	return false
}

// Shades is a colour in n steps, lightest first.
//
// It is for a mark that has to read as one object with a direction — a bar down
// the side of a masthead — rather than as n things. Each step is the base blended
// towards white, most at the top and not at all at the bottom, so the run stays
// recognisably one hue however the base was chosen. A person who set the accent
// gets their accent; nobody has to name a second colour to get a gradient.
//
// n below two is one step, because a gradient of one is the colour itself and
// asking for none is a caller with nothing to draw.
func Shades(base color.Color, n int) []color.Color {
	if n < 2 {
		return []color.Color{base}
	}

	r, g, b, _ := base.RGBA()
	out := make([]color.Color, n)
	for i := range out {
		// The top is lifted most. Two thirds rather than the whole way: a bar
		// that reached white would stop being the accent at the end where the
		// eye lands first.
		lift := twoThirds * float64(n-1-i) / float64(n-1)
		out[i] = color.RGBA{
			R: blend(r, lift),
			G: blend(g, lift),
			B: blend(b, lift),
			A: 0xFF,
		}
	}
	return out
}

const twoThirds = 2.0 / 3.0

// blend lifts one 16-bit channel towards white and returns it as 8-bit, which
// is what a terminal is told.
func blend(channel uint32, towards float64) uint8 {
	eight := float64(channel >> 8)
	return uint8(eight + (0xFF-eight)*towards)
}
