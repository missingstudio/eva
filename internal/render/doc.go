// Package render is the projection that shows a turn to a person. It folds
// committed Events into a rendered answer and a cost line.
//
// Layer contract: render is not a frontend. It holds no terminal, no input, and no
// way to reach a Provider, a Session, or the Trace — it takes Events and
// returns strings, so it sits beside core rather than inside the layer that
// owns the screen. What it may import is a short list: the Event schema, and
// the terminal libraries.
//
// The omissions are the rule. A fold that could reach a Provider, a Session, or
// the Trace could show a person a turn the record does not hold, and the screen
// would stop being an account of what was committed. core is absent too, which
// costs a compile-time assertion that a fold satisfies Subscriber; that
// assertion happens where a fold is built instead, and the shorter import list
// is worth more.
//
// That list is an allow list in the linter rather than a promise in this
// comment, because a boundary this layer only documents is a boundary the next
// import quietly crosses.
package render
