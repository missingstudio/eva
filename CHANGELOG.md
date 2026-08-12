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

### Added

- **The console lists its commands.** <kbd>ctrl</kbd>+<kbd>p</kbd> opens the slash
  commands and narrows them as you type. <kbd>enter</kbd> writes the one you chose
  into the prompt, rather than running it, because a command may take an argument.
- **The prompts you sent come back.** <kbd>↑</kbd> and <kbd>↓</kbd> walk them, and
  only when the cursor has no line to move to — so a prompt of several lines keeps
  its own arrows. Walking back past the newest one returns the words you were
  writing. It is this session's prompts, and it does not survive a restart.
- **A long prompt can be written in your editor.** <kbd>ctrl</kbd>+<kbd>o</kbd>
  opens `editor` from your configuration, or `$VISUAL`, or `$EDITOR`. Eva takes back
  whatever you saved and removes the file. A repository may not set `editor`: what
  it names is a program Eva starts on your machine.
- **A turn says how long it took**, under the answer, when it took longer than a
  second. The figure is a fold over the record rather than something the interface
  timed. `[theme.layout] elapsed_seconds` moves the threshold, and zero switches it
  off. `eva -p` never writes it, because its output is a script's input.
- **A look can be named.** `[theme] name` selects one Eva ships with, and everything
  you write is applied over it. `eva` is what Eva draws when you name nothing;
  `contrast` raises the greys for a washed-out terminal or tired eyes; `mono` names
  no colour at all and draws answers plain.
- **The answer's own colours are configurable.** `[theme.markdown]` names the
  heading, code, emphasis, link, and quotation colours — most of what is on the
  screen, and until now the one part no setting could reach.
- **`make bench` says what a frame costs.** A frame, a second of an answer
  arriving, a keystroke, and a window being dragged, each against a short
  conversation and a long one. One of the figures is a check: `make test` fails when
  a frame that redraws an unchanged screen starts allocating like one that changed.

### Changed

- **The interface is inset from the edges of the terminal.** Two columns at each
  side, because a terminal draws no window frame of its own and text against the
  first column reads as text against the edge of the screen. Nothing at the top or
  bottom: rows are scarcer than columns, and a row held back is a row of the
  conversation nobody can read. `[theme.layout.margin]` and
  `[theme.layout.padding]` each take all four edges — the second will be what a
  background fills when Eva draws one. A window too small to spare an edge spends it
  on the answer instead, and gives up the margin first.
- **What a turn is doing moved under the prompt**, and shares that row with the
  figures and the model at the far end. It was above the prompt, which put it
  between the command list and the line being typed, and it left two rows of grey
  under the prompt where one will do. A prompt waiting behind a running turn keeps
  its own row below that.
- **A turn that produced no answer is drawn in its own colour**, rather than in the
  grey the status line and the cost figure use. It is the one deliberate change to
  what Eva draws for somebody who has configured nothing: the line a person must not
  miss looked like one more line they could skip. `[theme.colors] failure` sets it,
  and `mono` names none.
- **The interface is faster, and how much is measured.** Against a hundred-block
  conversation: redrawing a screen that did not change costs 30 µs where it cost
  1.22 ms, and 80 allocations where it took 2,100; a window dragged across forty
  columns costs 63 ms where it cost 3.0 s; one keystroke and the frame it causes
  costs 224 µs where it cost 342 µs. A second of a 32 KB answer arriving costs
  5.7 ms, against 57 ms for the same second with the new bound switched off.
  Nothing about what is drawn changed. `make bench` reproduces all of it.

- **The install script checks the release's signature**, not only its checksum. The
  release has signed `checksums.txt` since the first tag, and nothing automatic read
  the signature — so the installer was checking that the archive matched a file it
  fetched from the same host as the archive. That establishes the download; the
  signature is what establishes the release. It is checked first, and a signature
  that does not hold installs nothing.

  It needs [cosign](https://github.com/sigstore/cosign) on the machine. Without it
  the install goes ahead on the checksum alone and says on stderr what that leaves
  unproven, because an installer that refused on a bare machine is one nobody runs.
  `--require-signature`, or `EVA_REQUIRE_SIGNATURE=1`, makes it a refusal instead —
  which is what a CI job wants. The expected identity is pinned to this
  repository's release workflow running on a tag, so a token from any other
  workflow signs a certificate the check rejects.

### Fixed

- **A window being dragged no longer freezes the interface.** Every column an edge
  crossed re-rendered every answer in the conversation. Now the drag fits the window
  as it moves and re-renders once, at the width it stopped on.

- **`--channel next` no longer costs a request for every release.** It read the
  releases list and then asked GitHub about each release in turn, up to twenty-one
  requests against an hourly limit of sixty. It now reads the list in one pass and
  costs two. The guarantee that walk was written for is kept: each release's own
  fields are read within their own record, so nothing nested can be mistaken for a
  release's own flag.

## 0.1.1 — 2026-08-12

The first release anybody should install. Eva was buildable before this release.
Nobody could install it.

The number is 0.1.1 and not 0.1.0 for a reason worth knowing. `v0.1.0` and
`v0.1.0-rc.1` were tagged, published, and then withdrawn. Withdrawing a tag does
not release its version number: `sum.golang.org` records the hashes of a version
the first time anybody fetches it, and that record is append-only. Re-tagging
`v0.1.0` on different code would make `go install` report a checksum mismatch,
which reads as an attack. So the withdrawn numbers stay withdrawn. Do not install
either one — `@v0.1.0` still resolves from the proxy's cache and serves code no
tag in this repository points at.

[Release notes and artifacts](https://github.com/missingstudio/eva/releases/tag/v0.1.1)
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
