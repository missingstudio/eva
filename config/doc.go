// Package config resolves Eva's configuration: the TOML file, profiles, key
// resolution, and model selection.
//
// Layer contract: config reads files, so it sits outside core. It may import
// events and core.
package config
