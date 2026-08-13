// Package api is the Session API and the Transports that carry it. Two things
// satisfy it: the assembly, in the process it runs in, and Remote over the wire
// against the Handler here. Only the distance changes (ADR 0061).
//
// Nothing here listens. A listener, a Credential, and a Registration are a layer
// above, and this build has none.
package api
