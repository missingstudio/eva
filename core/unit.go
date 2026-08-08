package core

import (
	"context"

	"github.com/missingstudio/eva/events"
)

// Spec is a statement of intent. At stage 5 it also carries the acceptance
// criteria a Verifier turns into Evidence; until then it carries the intent
// and the identity it is executed under.
//
// Tenant and Actor are on the primitive from commit one, for the same reason
// they are on the Event envelope: adding tenancy later touches every table,
// query, cache key, object path, and stored record.
type Spec struct {
	Tenant events.TenantID
	Actor  events.Identity
	Intent string
}

// Outcome is what a Unit returns.
// Escalation to a human is an Outcome, not an error.
type Outcome struct {
	Result  events.Result
	Summary string
}

// Claim is the assertion this Outcome makes about itself. It is never
// Evidence, however trustworthy its source.
func (o Outcome) Claim() events.Claim {
	return events.Claim{Result: o.Result, Summary: o.Summary}
}

// Unit is anything that takes a Spec and returns an Outcome. A model call, a
// workflow, an agent, a harness, a factory, and a company are all Units at
// different timescales, which is why this interface says nothing about which
// one it is.
//
// Every way the work can end is an Outcome. Failed, NeedsHuman and Exhausted
// are Results rather than errors, and so is the summary that says which
// provider broke or that a person stopped the turn. A Unit that returned that
// same fact as an error too would be answering one turn twice in two shapes,
// and two callers would each act on a different one — which is how an
// interface comes to show something the Trace does not hold.
//
// The error is reserved for what no Outcome can carry: the record itself
// failing. A Recorder that could not stamp, a sink that would not take the
// group, a Trace that closed under the Run. Those leave the caller with
// nothing in the Trace to read instead, so they are the one thing that has to
// reach it directly.
type Unit interface {
	Execute(ctx context.Context, spec Spec) (Outcome, error)
}
