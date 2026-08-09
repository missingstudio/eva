package render

import "github.com/missingstudio/eva/internal/events"

// NoResponse is what a turn that did not answer leaves behind, when nothing
// classified why.
const NoResponse = "No response"

// Unanswered is the line a turn that did not answer leaves behind, chosen by
// the class the claim carries.
//
// It lives here, beside the fold that turns committed Events into an answer,
// because it is the same kind of thing: what a person reads in place of a turn.
// It was the console's own until a second frontend needed it — one turn on a
// stream, which had been failing in silence — and two copies of a sentence a
// person reads are two products that drift.
//
// Every line is this project's own words, and none is composed from anything a
// provider said. That is the whole rule. A person who typed a prompt is owed
// the one fact that changes what they do next, and is owed none of the vendor's
// account of it — no status line, no request identifier, no error document.
// What the provider said is in the Trace verbatim, for whoever is debugging the
// provider.
//
// The lines say what is true rather than what to do. "Check your key" would be
// an instruction nothing here can stand behind: this sees that a credential was
// refused, and cannot see whether the fix is a new key, a renewed login, or an
// account somebody suspended. Naming what happened leaves the next step to
// whoever knows which of those it is.
//
// A class this build does not know falls through to the bare line. The set is
// closed today and will not stay closed, and printing a raw class name for one
// there is no sentence for would leak the schema instead of the vendor — the
// same failure wearing different clothes.
func Unanswered(class events.ErrorClass) string {
	switch class {
	case events.ErrorAuthFailed:
		return NoResponse + " — the credential was refused"
	case events.ErrorUnreachable:
		return NoResponse + " — the provider could not be reached"
	case events.ErrorRateLimit:
		return NoResponse + " — the rate limit was reached"
	case events.ErrorOverloaded:
		return NoResponse + " — the provider is overloaded"
	case events.ErrorServerError:
		return NoResponse + " — the provider failed the request"
	case events.ErrorNoSuchModel:
		return NoResponse + " — the provider does not serve this model"
	case events.ErrorBilling:
		return NoResponse + " — the provider will not bill this turn"
	default:
		return NoResponse
	}
}

// Remedy is a next step something checked, and never one it is guessing at.
//
// Because is the fact that was established about this machine — which
// credential was sent, which file names the model, where the turn was pointed.
// Do is what a person types, verbatim, and is empty whenever the fact leaves
// more than one step correct.
//
// The two are one value because a step with no fact behind it is advice. Advice
// is what this path exists to avoid: somebody sent to fix a thing that was never
// broken stops reading the line, and then the line that would have helped them
// is gone too. A fact with no step is the ordinary case and is worth saying
// alone — that a login has not expired is what stops a person logging in again
// to no effect.
//
// The zero Remedy is one nothing could establish, and nothing is drawn for it.
// That is how every absent fact is handled: the masthead draws no row for a
// branch that is not there either.
//
// Composing one means reaching a configuration and an auth store, which this
// layer deliberately cannot see. So the type is here, beside the sentences it
// is read with, and the checking is done by the layer that wires a run.
type Remedy struct {
	Because string
	Do      string
}

// Said is the remedy as a person reads it: the fact, and under it the command
// to type.
//
// A remedy with nothing to type is the fact alone. A remedy with nothing
// established says nothing at all, whatever it holds to type — which is the "no
// step without a fact" rule held here rather than trusted upstream, because
// upstream is where the temptation to offer a likely-looking step lives.
//
// The command is set off and indented rather than written into the sentence.
// That is the shape `eva init` and `eva login` already end with: something to
// copy stands away from the prose explaining it.
func (r Remedy) Said() string {
	switch {
	case r.Because == "":
		return ""
	case r.Do == "":
		return r.Because
	default:
		return r.Because + "\n\n    " + r.Do
	}
}
