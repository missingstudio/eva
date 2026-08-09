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

// Detail says where the provider's own account of a failure went.
//
// It exists because the rule above reads as "the detail was destroyed" without
// it. Nothing on screen said the Trace existed, so a person who wanted the
// status line had no way to learn there was one to want.
//
// It names the file and stops. Telling somebody to open it would be this layer
// deciding they are debugging a provider, which is a thing it cannot know — and
// the path is enough for whoever is.
func Detail(trace string) string {
	if trace == "" {
		return ""
	}
	return "the provider's own words are in " + trace
}
