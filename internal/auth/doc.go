// Package auth holds subscription Credentials: the store they live in, the
// source that keeps one fresh, and the login flow that obtains one.
//
// A subscription Credential is a short-lived access token and the refresh
// token that renews it, obtained by a person logging in rather than read from
// the environment. The environment path — an API key in a named variable — is
// config's; this layer exists for the credential a variable cannot hold,
// because it expires and must be written back when it renews.
//
// The layer talks to one thing: the vendor's authorization server. It reaches
// no Provider, reads no configuration file, and holds no terminal — the layer
// that wires a run passes the store's path in and prints what a login says.
//
// # How a turn authenticates
//
// The path runs through five places, and no one of them can hold all of it.
// That is the price of the layer graph rather than an accident of it, so it is
// written down here, where the story starts:
//
//  1. Configuration decides the mode. A turn authenticates with an API key or
//     with a login, and the mode alone decides which — there is no chain where
//     one silently outranks the other.
//  2. The layer that wires a run builds a resolver for whichever mode that is.
//     It is the one place configuration, this layer, and a Provider meet,
//     because none of the three may import both of the others.
//  3. In the login mode, the resolver reaches the token source below, which
//     reads the store and renews a credential that is close to expiring.
//  4. The Provider is handed the resolver rather than a token, and calls it per
//     attempt. A console session outlives an access token, so the attempt made
//     an hour in has to ask again rather than remember.
//  5. The Provider reads what it needs of the credential's own shape — for the
//     subscription backend, the account the token was minted for.
//
// Only one vendor has a login today, so the flow for it is a file here rather
// than a package of its own, and the token source names its renewal directly.
// A second one is what turns both into a seam worth having.
package auth
