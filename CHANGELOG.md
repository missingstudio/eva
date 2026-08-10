# Changelog

What changed, and what it means for somebody using Eva.

This file is the written half. It carries the changes worth a sentence, and it
does not list every commit. The complete list is generated per release from the
commit range, and it lives in that release's notes on GitHub — the link under
each version below goes to it.

Nothing is released yet, so every entry is under Unreleased.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).
Under 1.0 a minor bump may break something; that is what `0.` means here.

## Unreleased

### Added

- `eva version` reports the build, the Go toolchain, and the platform, then
  exits. It reads no configuration, so it answers on a machine where nothing
  else is set up yet.
- A binary installed with `go install` now reports the version the module graph
  resolved it at. Before, a proxy-installed build had no revision to quote,
  because a module cache is not a git tree.

### Changed

- `make check` is no longer the whole of what CI runs. `make verify` is, and it
  is `make check` plus `make audit`. The Makefile declares both lists and CI
  fails when its jobs do not cover them.
- The test target runs under the race detector, in a shuffled order.

### Security

- `make gosec` fails on unsafe patterns in Eva's own code, with each exclusion
  narrow and carrying its reason. It runs in a workflow of its own.
- `make vuln` fails on a known vulnerability in code Eva actually calls. Two
  reachable ones were found on the first run and fixed: `GO-2026-5970` in
  `golang.org/x/text` and `GO-2026-5320` in `github.com/yuin/goldmark`. It runs
  on a schedule as well as per change, because a vulnerability is published on
  somebody else's timetable.
- `make mod-verify` and `make tidy-check` fail on a tampered module cache and on
  a module graph that drifted from the imports.
