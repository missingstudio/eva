package core

import (
	"context"

	"github.com/missingstudio/eva/internal/events"
)

// Spec is a statement of intent. At stage 5 it also carries the acceptance
// criteria a Verifier turns into Evidence; until then it carries the intent
// and the identity it is executed under.
type Spec struct {
	Tenant events.TenantID
	Actor  events.Identity
	Intent string
}

type Outcome struct {
	Result  events.Result
	Summary string

	// Class is why the work failed, in the schema's fixed set, and is empty on
	// a Unit that succeeded or that has no opinion about its failure.
	Class events.ErrorClass
}

// Claim is the assertion this Outcome makes about itself. It is never
// Evidence, however trustworthy its source.
func (o Outcome) Claim() events.Claim {
	return events.Claim{Result: o.Result, Summary: o.Summary, ErrorClass: o.Class}
}

// Unit is anything that takes a Spec and returns an Outcome. A model call, a
// workflow, an agent, a harness, a factory, and a company are all Units at
// different timescales, which is why this interface says nothing about which
// one it is.
type Unit interface {
	Execute(ctx context.Context, spec Spec) (Outcome, error)
}
