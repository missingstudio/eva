// Package theme is every colour, glyph, and measurement an interface draws
// with.
package theme

import (
	"fmt"
	"image/color"
	"regexp"
	"strings"

	"charm.land/lipgloss/v2"
)

type Theme struct {
	// Dark says which background this Theme was built for. It is not a
	// preference — it is the terminal's own answer — and it is here because
	// every adaptive colour below was already resolved against it.
	Dark bool

	Colors   Colors
	Symbols  Symbols
	Layout   Layout
	Markdown Markdown

	Border lipgloss.Border

	// settings is what a person asked to change, kept so that a background
	// arriving late can be taken without discarding it. See For.
	settings Settings
}

type Colors struct {
	Subdued color.Color
	Person  color.Color
	// Eva marks what Eva said. It is the subdued grey by default, because
	// there is far more of Eva on screen and a hue down the side of every
	// answer is a hue nobody sees.
	Eva     color.Color
	Spinner color.Color
	// Failure is what a turn that produced no answer is written in, and the
	// checked step that follows it.
	Failure color.Color
}

type Markdown struct {
	// Plain draws the answer with no colour at all, and with ASCII in place of
	// the marks a renderer would otherwise draw: a bullet becomes a hyphen, a
	// rule becomes dashes, and emphasis keeps its asterisks.
	Plain bool

	Heading   color.Color
	Code      color.Color
	CodeBlock color.Color
	Emphasis  color.Color
	Link      color.Color
	LinkText  color.Color
	Quote     color.Color
}

type Symbols struct {
	Prompt      string
	Placeholder string
	Truncation  string
	// Spinner names the frames a turn in flight is shown with.
	Spinner string
}

type Space struct {
	Top    int
	Right  int
	Bottom int
	Left   int
}

type Layout struct {
	Margin Space

	Padding Space
	// PromptRows is how tall the prompt may grow before it scrolls within
	// itself. A prompt free to grow to the window would push the answer off
	// the top, and what a person is writing is rarely worth more of the screen
	// than what they are reading.
	PromptRows     int
	CaptionSeconds int
	// ElapsedSeconds is how long a turn must take before it says how long it
	// took. Zero says nothing about any turn.
	ElapsedSeconds int
	LiveShare      int
}

func Default(dark bool) Theme {
	return Theme{
		Dark: dark,
		Colors: Colors{
			Subdued: pick(dark, subduedOnLight, subduedOnDark),
			Person:  pick(dark, personOnLight, personOnDark),
			Eva:     pick(dark, subduedOnLight, subduedOnDark),
			Spinner: nil,
			Failure: pick(dark, failureOnLight, failureOnDark),
		},
		Symbols: Symbols{
			Prompt:      "› ",
			Placeholder: "ask something",
			Truncation:  "…",
			Spinner:     SpinnerMiniDot,
		},
		Layout: Layout{
			Margin:         Space{Right: 2, Left: 2},
			PromptRows:     10,
			CaptionSeconds: 8,
			ElapsedSeconds: 1,
			LiveShare:      8,
		},
		Border: lipgloss.NormalBorder(),
	}
}

// The greys and the person's mark, one of each per background. All are true
// colour and none is emitted as written: what reaches the terminal is
// downsampled to what the terminal can show.
var (
	subduedOnLight = lipgloss.Color("#5C5C5C")
	subduedOnDark  = lipgloss.Color("#9E9E9E")
	personOnLight  = lipgloss.Color("#2F6FB2")
	personOnDark   = lipgloss.Color("#7AA6DC")

	// A failure is a hue rather than a weight, because a person scanning a
	// screen finds a colour without reading. It is muted because a failed turn
	// is a fact and not an emergency. A look that wants none sets it back to
	// the grey, and mono names no colour at all.
	failureOnLight = lipgloss.Color("#A3352A")
	failureOnDark  = lipgloss.Color("#E8877C")
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

func Borders() []string {
	return []string{BorderDouble, BorderNone, BorderNormal, BorderRounded, BorderThick}
}

func (t Theme) Subdued() lipgloss.Style {
	return lipgloss.NewStyle().Faint(true).Foreground(t.Colors.Subdued)
}

// Failing is the style a turn that produced no answer is written in.
func (t Theme) Failing() lipgloss.Style {
	if t.Colors.Failure == nil {
		return t.Subdued()
	}
	return lipgloss.NewStyle().Foreground(t.Colors.Failure)
}

func hexColor(hex string) color.Color { return lipgloss.Color(hex) }

func pick(dark bool, onLight, onDark color.Color) color.Color {
	if dark {
		return onDark
	}
	return onLight
}

type Settings struct {
	Name string

	Margin  Sides
	Padding Sides

	Subdued     string
	Person      string
	Eva         string
	Spinner     string
	Failure     string
	SpinnerName string

	Plain *bool

	Heading   string
	Code      string
	CodeBlock string
	Emphasis  string
	Link      string
	LinkText  string
	Quote     string

	Prompt      *string
	Placeholder *string
	Truncation  *string

	Border string

	PromptRows     *int
	CaptionSeconds *int
	ElapsedSeconds *int
	LiveShare      *int
}

type Sides struct {
	Top    *int
	Right  *int
	Bottom *int
	Left   *int
}

func (s Sides) over(space Space, name string) (Space, error) {
	for _, edge := range []struct {
		written *int
		into    *int
		side    string
	}{
		{s.Top, &space.Top, "top"},
		{s.Right, &space.Right, "right"},
		{s.Bottom, &space.Bottom, "bottom"},
		{s.Left, &space.Left, "left"},
	} {
		if edge.written == nil {
			continue
		}
		if *edge.written < 0 {
			return Space{}, fmt.Errorf("theme: %s.%s = %d, and nothing can hold back %d cells",
				name, edge.side, *edge.written, *edge.written)
		}
		*edge.into = *edge.written
	}
	return space, nil
}

// Build makes a complete Theme for a background from what a person asked to
// change. A Settings that says nothing gives exactly Default.
func Build(dark bool, s Settings) (Theme, error) {
	t, err := Named(s.Name, dark)
	if err != nil {
		return Theme{}, err
	}
	t.settings = s

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
	if t.Colors.Failure, err = hue(s.Failure, t.Colors.Failure, "failure"); err != nil {
		return Theme{}, err
	}

	if s.Plain != nil {
		t.Markdown.Plain = *s.Plain
	}

	for _, m := range []struct {
		written string
		into    *color.Color
		name    string
	}{
		{s.Heading, &t.Markdown.Heading, "heading"},
		{s.Code, &t.Markdown.Code, "code"},
		{s.CodeBlock, &t.Markdown.CodeBlock, "code_block"},
		{s.Emphasis, &t.Markdown.Emphasis, "emphasis"},
		{s.Link, &t.Markdown.Link, "link"},
		{s.LinkText, &t.Markdown.LinkText, "link_text"},
		{s.Quote, &t.Markdown.Quote, "quote"},
	} {
		if *m.into, err = hue(m.written, *m.into, m.name); err != nil {
			return Theme{}, err
		}
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

	if t.Layout.Margin, err = s.Margin.over(t.Layout.Margin, "margin"); err != nil {
		return Theme{}, err
	}
	if t.Layout.Padding, err = s.Padding.over(t.Layout.Padding, "padding"); err != nil {
		return Theme{}, err
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
	if s.ElapsedSeconds != nil {
		if *s.ElapsedSeconds < 0 {
			return Theme{}, fmt.Errorf(
				"theme: a turn cannot take %d seconds, so no turn would say how long it took", *s.ElapsedSeconds)
		}
		t.Layout.ElapsedSeconds = *s.ElapsedSeconds
	}
	if s.LiveShare != nil {
		// One is the whole of the clock, which is what "draw on every frame"
		// is. Below one is a share of nothing, and it would ask for a drawing
		// before the last one finished.
		if *s.LiveShare < 1 {
			return Theme{}, fmt.Errorf(
				"theme: an arriving answer cannot be drawn in one part in %d of the clock", *s.LiveShare)
		}
		t.Layout.LiveShare = *s.LiveShare
	}
	return t, nil
}

func (t Theme) For(dark bool) Theme {
	// The settings were accepted when this Theme was built, so they cannot fail
	// now. A background is not one of the things they can be wrong about.
	rebuilt, err := Build(dark, t.settings)
	if err != nil {
		return t
	}
	return rebuilt
}

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

func Shades(base color.Color, n int) []color.Color {
	if n < 2 {
		return []color.Color{base}
	}
	// A look that names no colour has no gradient, and asking for one is not a
	// mistake: the mono look names none on purpose, and what it wants back is n
	// steps of nothing rather than a refusal or a panic.
	if base == nil {
		return make([]color.Color, n)
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
