# Changelog

What changed, and what it means for somebody using Eva.

This file is the written half. It carries the changes worth a sentence, and it
does not list every commit. The complete list is generated per release from the
commit range, and it lives in that release's notes on GitHub — the link under
each version below goes to it.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).
Under 1.0 a minor bump may break something; that is what `0.` means here.

## Unreleased

Nothing yet.

## 0.1.0 — 2026-08-12

The first release. Eva was buildable before this release. Nobody could install it.

[Release notes and artifacts](https://github.com/missingstudio/eva/releases/tag/v0.1.0)
carry the complete commit list; what follows is the part worth a sentence.

### Added

- **Eva installs.** Releases carry archives for macOS, Linux, and Windows, a
  SHA-256 checksum for each, an SBOM per archive, a cosign signature over the
  checksums, and a provenance attestation naming the workflow and commit that
  built them. `go install github.com/missingstudio/eva/cmd/eva@latest`, or the
  install script, which refuses to install an archive whose checksum does not
  match.
- A Homebrew cask. `brew install missingstudio/tap/eva` installs the same archive
  the release published, and the release writes the cask itself. `make rehearse`
  reads that cask before a tag exists, so the tap cannot drift from the build.
- Two channels. `stable` is the newest release; `next` is the newest prerelease,
  for somebody who will report what breaks. Both are immutable tags — no tag
  ever moves, because the module proxy caches the first content it sees under a
  version forever.
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
