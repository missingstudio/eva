# A release is evidence, not a claim

Status: **landed**, except where the section below says otherwise. A design for four things Eva did not have: a changelog, version tags, distribution channels, and a release. It also redesigns CI, because the release depends on the checks.

Eva had a version constant and no way to ship it. `internal/cli/about.go:18` says `0.1.0`, the repository has no tags, and no artifact has ever left it. This document says what was added, in what order, and what each step cost.

Two findings from the tree before this landed drove the shape of it. The vulnerability scanner that this design makes a gate **failed on first run**, on two reachable vulnerabilities that are now fixed. The CI that this design parallelizes **ran twice** on every pushed branch. Both are measured below.

**Read the two tables under "What exists today" as the tree this was written against, not as the tree now.** The rest of the document is the argument, and the argument is unchanged.

## What landed, and where it differs from this plan

All thirteen steps of the sequencing table are addressed. Two are marked `partly` there: step 5 landed `gosec` and not the SARIF upload, and step 12 landed the install script and not the Homebrew tap. Ten things came out differently from what this page proposed, and each is a decision it owes a reason for:

| Departure                                                                 | Why                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **No commit-message check.** The prefixes stay a convention.               | Built, then removed on the owner's call. The consequence is named in Part 3: an unprefixed commit is omitted from the generated release notes, silently, and nothing refuses it |
| **The checks live in three workflow files, not one.**                      | `ci.yml` for the tree, `security.yml` for `gosec`, `audit.yml` for the dependency graph. They fail for different reasons and want different schedules, and a red run now says which of the three before anybody opens it. It costs branch protection three required checks instead of one |
| **`gosec` is a second invocation of the linter, not a linter inside it.**  | So it can own a workflow without running twice. `make gosec` passes `--default=none --enable=gosec` against the same `.golangci.yml`, which keeps one configuration and its reasons in one file |
| **No SARIF upload to code scanning.** Findings live in the job log.        | golangci-lint v2.12.2 has no SARIF writer. Its output formats are text, json, tab, html, checkstyle, code-climate and junit-xml. A step that pretended otherwise would be worse than the gap |
| **`CHANGELOG.md` is written, not generated and committed.**                | The generated fold lives in each release's notes, where GoReleaser puts it. Committing a regenerated file back to `main` from CI means a pipeline that pushes to the default branch, and that hazard buys nothing the release notes do not already give |
| **The Homebrew tap config ships commented out.**                           | It needs a second repository and a token that can write to it. Neither exists, and a config that names a missing repository fails the first release. The three steps to enable it are in `.goreleaser.yaml` |
| **A pull request cross-compiles two targets, not four.**                   | The dimension that breaks is the operating system, so `windows/amd64` and `darwin/arm64` cover it. `linux/arm64` and `darwin/amd64` are same-OS and are built at release |
| **Windows and macOS run `go test` directly, without the race detector.**   | The race detector needs a C toolchain that a Windows runner does not reliably have, and `make` is not part of that image's contract. The job says out loud that it is a subset of `make test` |
| **Eighteen console tests are skipped on Windows.**                          | The console answers nothing written to a pipe there, so each one waited out a 30-second deadline. Whether the input reader wants a console handle or `\r` alone is not Enter is unresolved, and answerable only on a Windows machine. The skip names what is unverified rather than implying it works |
| **The scheduled failure report is a fourth workflow, not a job in the audit.** | As a job it made `audit.yml` un-callable: it asked for `issues: write`, and a caller holding `contents: read` cannot grant that. `audit-report.yml` watches from outside on `workflow_run`, so the gate asks for nothing beyond read |
| **`version()` prints the module version only when it differs.**            | The plan's table showed `0.1.0 (v0.1.0)` for a proxy install. Printed twice, one fact reads as two — so an exact match is dropped and a pseudo-version is not |

All of it has now run. `v0.1.0-rc.1` published on 2026-08-10 and `v0.1.0` followed it, so cosign, syft, the provenance attestation, and the GitHub release have each executed rather than merely been reasoned about. The section below records what that cost, because it is the argument for doing it on purpose.

## What the first releases caught

Nine defects reached a runner that no local check could have reached, and every one of them was in the release path rather than in Eva. They are listed because a plan that only records its intentions is half a record.

| Defect | Where it surfaced | Why nothing local caught it |
| ------- | ----------------- | ---------------------------- |
| The tag guard rejected **every** prerelease | Run against `v0.1.0-rc.1` | It stripped build metadata (`+abc1234`) and not the prerelease suffix (`-rc.1`), so the one tag shape worth pushing first was the one shape it refused |
| `audit.yml` was un-callable | `startup_failure`, no jobs, no log | Its `report` job asked for `issues: write`; a caller holding `contents: read` cannot grant that, and reusable-workflow permissions are validated before anything runs — on a job that would have been skipped |
| cosign wrote no signature | The `Release` step, after 2m27s | cosign v3 replaced `--output-signature`/`--output-certificate` with `--bundle`; v4 ignores the old pair, writes neither, then fails creating a bundle at the empty path it was never given |
| The signing tool was unpinned | Same failure | The action's SHA pins the *installer*, not the binary it downloads. A flag contract can then change with no commit here |
| `--channel next` never worked | Installing from the live release | The releases JSON was split on `{`, and the nested `author` and `assets` objects split it too — so the piece holding `"prerelease": true` held no `tag_name` |
| `make_latest: true` on a prerelease | Read before it ran | It asks GitHub for two contradictory things. Now it follows from the tag |
| Windows could not execute the test binary | 36 failures, first Windows run | `go build -o` writes the literal name, and Windows will not run a file with no extension |
| Windows has no POSIX file modes | The auth store and the config starter | `Perm()` reports 0666 for any writable file, so `0600` is unassertable there |
| The console answers nothing on Windows | 17 tests, each waiting out 30s | Only visible once the `.exe` fix let those tests run at all |

Two of them are worth more than their line.

**The signing step cannot be exercised without a tag.** `make snapshot` skips it, and has to: keyless signing needs an OIDC token, which a laptop does not have and would try to fetch through a browser. So the cosign contract is only testable at tag time. That is the whole argument for spending a release candidate before spending a release.

**A skipped job still costs its permissions.** The `report` job would not have run on a tag, and it stopped the release anyway. Permissions are checked statically, so "it is skipped" is not a defence — which is why the reporting moved out to `audit-report.yml` and the audit gate now asks for nothing beyond `contents: read`.

What remains unverified is narrower than it was: the Homebrew tap and macOS notarization have no implementation to run, and the console on Windows is skipped rather than fixed.

The one existing invariant this changed: `AGENTS.md` said `make check` is exactly what CI runs, and now says `make verify` is.

## The rule this is built on

> **A release is Evidence, not a Claim.**

`AGENTS.md` opens with that distinction and the project turns on it. A tag is a claim that a commit is fit to install. The claim is worth nothing on its own. Three things make it evidence. The checks that ran on that exact commit. The checksum that proves the artifact came from it. The attestation that proves which workflow built it. A release nobody can verify is a promise, and this project does not ship promises.

A second rule is borrowed unchanged from `docs/reference/architecture.md`, where it governs the package registry:

> **A ref moves; a SHA does not.**

That rule decides the channel design below. A channel is a moving pointer, so it may never be a git tag.

## What exists today

| Fact                                                             | Where                                     | Consequence                                                     |
| ---------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `Version` is the constant `0.1.0`                                | `internal/cli/about.go:18`                 | The version is in the binary, not in a tag                      |
| The revision comes from `debug.ReadBuildInfo`                    | `internal/cli/about.go:43`                 | A build from a dirty tree says `.dirty`                          |
| No git tags exist                                                | `git tag` is empty                        | There is no release to install, and no range for a changelog     |
| CI is one job on `ubuntu-latest`, running `make check` serially   | `.github/workflows/ci.yml`                 | Every check waits on the slowest one before it                   |
| `on: push` has no branch filter, beside `on: pull_request`        | `.github/workflows/ci.yml:4`               | A pushed PR branch runs the whole job twice                      |
| Conventional commit prefixes are mandatory                        | `AGENTS.md`, "Commit with a conventional prefix" | The input a generated changelog needs already exists      |
| `golangci-lint` enables `depguard`, over the v2 default set       | `.golangci.yml:13`                         | Layer boundaries are enforced; no security linter runs           |
| Nothing scans dependencies on any schedule                        | —                                         | The first scan found two reachable vulnerabilities; the next one has nothing watching for it |
| No file carries a build constraint                                | `grep //go:build` finds nothing            | Every target cross-compiles, and the matrix is free of exceptions |

## What is missing, and what each gap costs

| Gap                          | Cost while it stays open                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| No tag                       | Two bug reports on `0.1.0` describe two different programs                       |
| No changelog                 | An upgrade is a diff to read, so nobody upgrades on purpose                       |
| No channel                   | Every user is on the same version, and a fix cannot be tried before it is trusted |
| No artifact                  | Installing needs Go, a checkout, and a build                                     |
| No checksum or attestation   | A downloaded binary is trusted because of where it was found                      |
| No vulnerability gate        | A dependency's CVE lands silently, and stays                                      |
| Serial CI, run twice         | Measured waste, quantified below                                                  |

---

# Part 1 — The version

## The constant stays the source of truth

`internal/cli/about.go:12` already decided this, and the reasoning holds:

> It is a constant rather than something read from a tag, because a binary built from a working tree has no tag and would then have no version.

So the tag does not *set* the version. The tag *agrees* with it, and CI refuses a tag that does not.

```
release gate:  tag v0.2.0  ==  cli.Version 0.2.0     → publish
               tag v0.2.0  !=  cli.Version 0.1.0     → fail, publish nothing
```

This keeps one number in one place. It also rejects the usual alternative, `-ldflags -X`, for a reason beyond taste. A version injected at link time is absent from every build that is not the release build. The constant is right in all four build paths. The link flag is right in one.

## Version by build path

| How the binary was made               | `version()` today       | After this change        |
| ------------------------------------- | ----------------------- | ------------------------ |
| `make eva` in a clean checkout         | `0.1.0+78a2478`         | unchanged                |
| `make eva` in a dirty tree             | `0.1.0+78a2478.dirty`   | unchanged                |
| `go install ...@v0.1.0`                | `0.1.0` — **no revision** | `0.1.0 (v0.1.0)`       |
| A release artifact                     | n/a                     | `0.1.0+78a2478`          |

Row three is a real gap. A proxy-installed binary has no VCS stamps, because the module cache is not a git tree. It does have `info.Main.Version`, which the current code ignores. The fix is four lines in `version()`: when `vcs.revision` is empty and `Main.Version` is neither empty nor `(devel)`, report the module version. Then a `go install` user can quote something exact, which is the whole purpose of the function.

## `eva version`

Add a CLI verb beside `init`, `login`, and `auth`. It prints the version, the revision, the Go toolchain, and the target, then exits zero.

It is a verb, not a slash Command. `CONTEXT.md` fixes the difference: a Command is answered inside a running Console, and what starts a process is a flag or a verb. A person scripting an upgrade check runs `eva version`, not a Console.

## Semantic versioning before 1.0

| Change                            | Bump  | Example  |
| --------------------------------- | ----- | -------- |
| A breaking change to a CLI verb, a config key, or a documented output | minor | `0.1.0 → 0.2.0` |
| A new capability                  | minor | `0.1.0 → 0.2.0` |
| A fix with no interface change     | patch | `0.1.0 → 0.1.1` |
| The first stable interface promise | major | `0.x → 1.0.0`   |

Under 1.0, a minor bump may break. That is what `0.` means, and saying so here stops the argument later.

**The binary version is not the Event schema version.** ADR 0006 gives the schema its own monotonic integer, now at 2, and ADR 0021 keeps every layer under `internal/`. Nothing in the schema's number follows from the binary's, in either direction. A release note that changes the schema version says so in its own line.

---

# Part 2 — Distribution channels

## Two channels

| Channel  | What it holds                        | Tag shape          | For                                         |
| -------- | ------------------------------------ | ------------------ | ------------------------------------------- |
| `stable` | The newest release with no prerelease suffix | `v0.2.0`     | Everyone, and the default of every installer |
| `next`   | The newest prerelease                | `v0.3.0-rc.1`      | Someone who will report a fault              |

Both are git tags, and every tag is immutable. There is no third channel, and the next section says why.

## The unreleased build is a toolchain feature, not a channel

An earlier draft of this document added a third channel, `edge`, for the newest build of `main`. It is cut, because the Go toolchain already ships it:

```bash
go install github.com/missingstudio/eva/cmd/eva@main
```

Go resolves a branch to a pseudo-version carrying the commit's date and short SHA. With the `Main.Version` fallback from Part 1, that binary reports something exact, so a fault found on it is reportable. A private module needs `GOPRIVATE` set, which is one environment variable.

The audience is what settles it. Someone who runs an unreleased build accepts a broken day, and that person has a Go toolchain — the same one they would use for `make eva`. A channel would serve a group that is already served.

The cost avoided is not small. `edge` is the only channel that needs a build and publish on every merge, a monotonic build counter for CI to carry, a release object rewritten several times a day, and a version with no tag behind it. It is also the only one whose artifact cannot be rebuilt from a tag later, which is what makes a bug report against it hard to act on.

`AGENTS.md` calls this the small reversible change over the large correct-looking one. Two channels and a documented one-line install is the small one.

## A channel may never be a moving tag

The tempting design is a `stable` tag that gets force-pushed forward. Reject it, on the rule this document opens with.

A moved tag is worse in Go than elsewhere. The module proxy caches the first content it sees for a version, forever. A moved tag therefore gives two users different code under one name, silently and permanently. It also invalidates every `go.sum` that recorded the first one.

So a channel is resolved, never stored:

| Channel  | Resolved by                                                     |
| -------- | --------------------------------------------------------------- |
| `stable` | `GET /repos/missingstudio/eva/releases/latest` — GitHub's endpoint excludes prereleases by definition |
| `next`   | `GET /repos/missingstudio/eva/releases`, newest entry with `prerelease: true` |

**A `channels.json` manifest is deferred.** An earlier draft published one, and with two channels it earns nothing: GitHub's own endpoint already means `stable`, with no file for the release workflow to keep true. Its one remaining advantage is a fetch that is cacheable and free of rate limits, which matters only to an in-binary update check. That is open question 3 below, and the manifest lands with it or not at all.

Unauthenticated GitHub API calls are limited to 60 per hour per address. That is ample for an install script and would not be for a binary that checks on every start — which is the same fact, pointing at the same undecided question.

## Install surfaces

| Surface                    | Command                                            | Channel                  |
| -------------------------- | -------------------------------------------------- | ------------------------ |
| Go toolchain               | `go install github.com/missingstudio/eva/cmd/eva@latest` | `stable`           |
| Go toolchain, unreleased   | `go install github.com/missingstudio/eva/cmd/eva@main`   | neither, by design |
| Install script             | `curl -fsSL … \| sh -s -- --channel next`           | both                     |
| Homebrew tap               | `brew install missingstudio/tap/eva`                | `stable`                 |
| GitHub release             | Download the archive by hand                        | both                     |

`go install …@latest` resolves to the newest **non-prerelease** version. That is Go's own rule, and it is why `next` cannot be reached that way: a prerelease needs its exact version, or the script. This is a feature. The lowest-effort install path lands on the safest channel.

Scoop and an apt repository are deferred. Neither is hard once the archives and the manifest exist, and neither is worth its maintenance before there are users asking.

---

# Part 3 — The changelog

## Generated body, written highlights

The changelog has two parts, and they fail in opposite directions if merged.

**The body is generated** from the commit range of the tag. It is complete by construction, because it is a fold over the commits rather than a memory of them. `AGENTS.md` already mandates conventional prefixes, so the input exists and costs nothing more to produce.

**The highlights are written**, by whoever cuts the release, for user-visible changes only. Three sentences that say what a person can now do, or must now change. A generated list cannot say that, and a release with nothing worth saying gets no highlights rather than filler.

`CHANGELOG.md` follows Keep a Changelog. It is regenerated and committed by the release workflow, so no branch edits it and no two branches conflict in it.

## Prefix to section

| Prefix                | Section              | In the release notes |
| --------------------- | -------------------- | -------------------- |
| `feat`                | Added                | yes                  |
| `fix`                 | Fixed                | yes                  |
| `refactor`, `perf`    | Changed              | yes                  |
| any prefix with `!`, or a `BREAKING CHANGE:` footer | Breaking, listed first | yes    |
| `docs`, `test`, `build`, `ci`, `chore` | —   | no, and the count is reported |

The omitted prefixes are counted, not hidden. "12 other commits" tells a reader the release was not idle, without spending a line on each.

## The prefixes stay a convention, and are not checked

Generation is only as honest as the prefixes. An earlier draft of this document proposed a `commit-lint` gate over every commit in a pull request, and one was built and then removed on the owner's call: **commit messages are not checked by CI.**

So the prefixes remain what `AGENTS.md` has always said they are — a rule for whoever writes the commit, enforced by review rather than by a job. The consequence is worth stating plainly, because it is the cost of that choice: a commit written without a prefix is omitted from the generated release notes, silently. The fold cannot group what does not match, and nothing upstream refuses it.

That trade is defensible for a repository this size, where the commits are written by a small number of authors who read `AGENTS.md`. It stops being defensible at the point where a release note is found to be missing something, and the answer then is a gate rather than more care.

The release still asserts one thing about the range: the tag must have commits behind it. An empty range means the tag points where the last one did, and that is a mistake worth failing on.

---

# Part 4 — The release

## What a tag sets off

```
push tag v0.2.0
   │
   ├─ gate: the full check suite, on the tag's commit         ← reusable workflow, same as CI
   ├─ gate: tag == cli.Version
   ├─ gate: the changelog for this range is not empty
   │
   ├─ build: 5 targets, cross-compiled, CGO off, -trimpath
   ├─ sign: SHA-256 checksums, cosign keyless over the checksum file
   ├─ attest: build provenance for every archive
   ├─ sbom: one SPDX document per archive
   │
   ├─ publish: the GitHub release, prerelease flag set from the tag
   └─ publish: the Homebrew tap formula, for a stable tag only
```

Every gate runs before anything is published. A failed gate leaves no release and no formula. Nothing else needs undoing, because the channels are resolved from the releases rather than recorded anywhere. The tag stays, which is correct: the tag is a fact about history, and deleting it would rewrite the record. A bad tag is answered by the next tag.

## The targets

| GOOS    | GOARCH | Archive  | Measured size |
| ------- | ------ | -------- | ------------- |
| darwin  | arm64  | `tar.gz` | 25 MB         |
| darwin  | amd64  | `tar.gz` | 27 MB         |
| linux   | amd64  | `tar.gz` | 26 MB         |
| linux   | arm64  | `tar.gz` | 25 MB         |
| windows | amd64  | `zip`    | 27 MB         |

All five were built from this tree, with `CGO_ENABLED=0 -trimpath -ldflags='-s -w'`. All five succeeded. No file in the repository carries a build constraint, so there is no per-target exception to maintain.

The size is what a Bubble Tea console with Glamour and Chroma costs. Compression with `upx` is rejected: it breaks code signing, and it is a reliable way to be flagged by antivirus software.

## Artifacts

| Artifact                       | What it is                            | Why it ships                                        |
| ------------------------------ | ------------------------------------- | --------------------------------------------------- |
| `eva_0.2.0_darwin_arm64.tar.gz` | The binary, `LICENSE`, `README.md`     | The thing being installed                            |
| `checksums.txt`                | SHA-256 of every archive               | A download can be checked against the release        |
| `checksums.txt.sigstore.json`  | Cosign keyless signature bundle        | The checksums came from this repository's workflow    |
| `*.sbom.spdx.json`             | One SBOM per archive                   | A consumer can audit dependencies without building   |
| Provenance attestation         | Stored by GitHub, not a release asset  | `gh attestation verify` proves which workflow built it |

Cosign keyless signing and provenance attestation both use the workflow's OIDC identity. Neither needs a stored secret, which is why both are affordable now rather than later.

## Signing for the operating systems

macOS notarization and Windows code signing are **deferred, and their cost is named**. Notarization needs an Apple Developer account and two secrets. Without it, a downloaded archive is quarantined, and a person must clear it by hand.

Homebrew is the recommended macOS path in the meantime, because a tap install does not set the quarantine attribute. The install script prints the manual step when it detects macOS. That is honest, and it costs nothing until there is a reason to pay Apple.

## Tooling: GoReleaser, pinned and run the way the linter is

```makefile
GORELEASER_VERSION ?= v2.12.7
GORELEASER = $(GO) run github.com/goreleaser/goreleaser/v2@$(GORELEASER_VERSION)

## snapshot: build every release target locally, publishing nothing
snapshot:
	@$(GORELEASER) release --snapshot --clean --skip=publish,sign,announce
```

This is the pattern `.golangci.yml`'s runner already uses in the Makefile: a pinned version, run through `go run`, with no system install and no second way to get the tool. `make snapshot` also means the release path is testable without a tag, which is the difference between a release pipeline and a release attempt.

The GoReleaser config overrides the default ldflags. The default injects `main.version`, and this design keeps the version in a constant:

```yaml
version: 2

builds:
  - main: ./cmd/eva
    binary: eva
    env: [CGO_ENABLED=0]
    flags: [-trimpath]
    ldflags: ["-s -w"]        # deliberately no -X: cli.Version is the source of truth
    goos: [darwin, linux, windows]
    goarch: [amd64, arm64]
    ignore:
      - { goos: windows, goarch: arm64 }

archives:
  - formats: [tar.gz]
    format_overrides:
      - { goos: windows, formats: [zip] }
    files: [LICENSE, README.md, CHANGELOG.md]

checksum: { name_template: checksums.txt }
sboms:    [{ artifacts: archive }]

changelog:
  use: github
  groups:
    - { title: Breaking, regexp: '^.*?\w+(\(.+\))?!:', order: 0 }
    - { title: Added,    regexp: '^.*?feat(\(.+\))?:', order: 1 }
    - { title: Fixed,    regexp: '^.*?fix(\(.+\))?:',  order: 2 }
    - { title: Changed,  regexp: '^.*?(refactor|perf)(\(.+\))?:', order: 3 }
  filters:
    exclude: ['^docs:', '^test:', '^build:', '^ci:', '^chore:']

release:
  prerelease: auto        # a tag with an -rc suffix is never marked latest
  make_latest: true
```

`prerelease: auto` is what keeps `next` out of the `stable` channel without a second config path. GoReleaser reads the suffix on the tag and sets the flag itself.

---

# Part 5 — CI that is fast because it is honest

## What it costs today

Measured on this machine, an Apple laptop with roughly six usable cores, with a cold Go build cache and a warm module cache:

| Step                        | Wall  | CPU    | Note                                       |
| --------------------------- | ----- | ------ | ------------------------------------------ |
| `make lint`, cold cache     | 27.9s | 158s   | Compiling golangci-lint and every dependency |
| `make lint`, warm cache     | 6.9s  | 8s     | The same work, cached                       |
| `make build`, warm          | 2.1s  | 2s     |                                            |
| `make check`, cold, serial  | 48.9s | 193s   | The whole suite, as CI runs it              |
| `go test ./...`, warm       | 12.7s | 9s     | `internal/cli` is 10.8s of it               |
| Cross-compiling 5 targets   | 52.0s | 250s   | Each target compiles its own stdlib         |

**A GitHub `ubuntu-latest` runner has two cores.** The numbers above are CPU-bound, so 193 seconds of CPU does not fit in 48 seconds of wall clock there. Expect two to four minutes today, including checkout, toolchain setup, and module download. Those figures are a projection from the measurement, not a measurement.

## Three wastes, in order of what they cost

**1. Every push runs twice.** `on: push` has no branch filter and sits beside `on: pull_request`. A push to a branch with an open PR triggers both. This is half of all CI minutes, and one line fixes it.

**2. A superseded run finishes anyway.** Three pushes in five minutes run three full suites, and only the last one matters.

**3. The lint compile dominates, and it is repeated.** 158 CPU-seconds cold, against 8 warm. That gap, not the fan-out, is the thing worth engineering.

## The counter-intuitive part: fan-out alone makes it slower

The obvious optimization is one job per Make target. Done naively, it is a regression. `build`, `vet`, `test`, and `lint` compile the same dependency graph. Four jobs with cold caches compile it four times, and a two-core runner has no spare capacity to hide that.

Fan-out pays only when the build cache is shared. So the cache design comes first, and the split second.

## The split

Three workflow files, split by what makes each one fail. A run that goes red should say which of three things is wrong before anybody opens it.

| Workflow       | Jobs                                  | Fails because of                                  | Schedule    |
| -------------- | ------------------------------------- | ------------------------------------------------- | ----------- |
| `ci.yml`       | `quick`, `test`, `platforms`, `lint`, `gate` | The tree: it does not build, pass, or respect a boundary | none  |
| `security.yml` | `gosec`                                | Code written here                                  | none        |
| `audit.yml`    | `audit`, `report`                      | The dependency graph, which changes on its own      | **yes**     |

Within `ci.yml`:

| Job         | Runs                                             | Separate because                                    |
| ----------- | ------------------------------------------------ | --------------------------------------------------- |
| `quick`     | `gofmt`                                           | It needs no compile and fails in seconds             |
| `test`      | `go build`, `go vet`, `go test -race -shuffle=on`, a two-target cross-compile | One compile graph serves all of them |
| `platforms` | `go build` and `go test` on macOS and Windows      | It costs two runners, so it waits for merge          |
| `lint`      | `golangci-lint`                                    | It has its own binary and its own analysis cache     |
| `gate`      | Nothing; it depends on the four above              | One required status check, whatever the matrix does  |

**Only the audit has a schedule, and it is the only one that earns one.** Every other job is a pure function of the tree, so a scheduled run spends runners to confirm the last commit's answer. An earlier draft put the schedule on the whole of CI, which would have woken seven runners on every tick — two of them macOS and Windows — to learn one bit that only the audit can produce.

`gate` exists so branch protection names one check per workflow rather than one per job. A matrix that grows does not need the protection rule edited, and a job that is skipped rather than passed cannot be mistaken for a pass. The cost of the file split is that branch protection now names three checks instead of one.

`audit.yml` also carries `report`, which files a scheduled failure as a GitHub issue and comments on the open one rather than filing a second. A scheduled failure otherwise emails the last person who committed to the default branch, which is not a channel anyone watches — and a gate that reports to nobody is a gesture.

## The invariant that keeps the split honest

`AGENTS.md` says:

> `make check` is exactly what CI runs.

A split CI breaks that sentence unless something enforces it. Two changes keep it true.

The Makefile declares the lists, and both entry points read them:

```makefile
CHECKS = fmt build vet lint test gosec
AUDITS = tidy-check mod-verify vuln

## check: everything CI runs offline
check: $(CHECKS)

## audit: the checks that need the network
audit: $(AUDITS)

## verify: check and audit, which together are exactly what CI runs
verify: check audit

## check-list: the target names CI must cover, one per line
check-list:
	@printf '%s\n' $(CHECKS) $(AUDITS)
```

Then `gate` asserts that CI covered all of them. The pattern is the one `.github/workflows/ci.yml:25` already uses to assert that `./...` reaches the whole repository:

```yaml
- name: Assert CI covers every declared check
  run: |
    set -eu
    make check-list | sort > /tmp/declared
    grep -hE '^[[:space:]]*(- run: )?make [a-z]' .github/workflows/*.yml \
      | sed -E 's/^[[:space:]]*(- run: )?make //' | awk '{print $1}' | sort -u > /tmp/invoked
    diff /tmp/declared /tmp/covered || {
      echo "the Makefile and this workflow disagree about what is checked"; exit 1; }
```

The duplication is deliberate. The two lists exist so that a difference between them is detectable, and the diff fails closed. A target added to the Makefile and not to CI breaks the build, which is the correct direction to fail.

`AGENTS.md` must change one sentence, from `make check` to `make verify`. That is the one existing invariant this design edits, and the edit lands in the same commit as the workflow.

## Cache design

`actions/setup-go` with `cache: true` restores both the module cache and the build cache, keyed on `go.sum`. Every job in the matrix restores the same key, so after the first run on a given `go.sum` all four jobs start warm. That is what makes the fan-out pay.

Two additions:

- **The golangci-lint cache gets its own key**, including the pinned version and the config file's hash. Its analysis cache is invalidated by a `.golangci.yml` edit and not by a `go.sum` edit.
- **`GOFLAGS: -mod=readonly` and `GOTOOLCHAIN: local`** are set for every job. The first stops a build from editing `go.mod` to make itself pass. The second stops a `go` directive bump from silently downloading a different toolchain, so the compiler is exactly the one `setup-go` installed.

## Matrix policy: what runs where

The console reads a terminal through `termios`, so the platforms differ where it matters most. Testing all three everywhere triples the bill.

| Trigger              | Platforms                        | Reasoning                                        |
| -------------------- | -------------------------------- | ------------------------------------------------ |
| Pull request         | `ubuntu-latest`, plus a cross-compile of two other targets | Compilation catches most portability faults, at seconds each |
| Push to `main`       | `ubuntu`, `macos`, `windows`      | The merge is the last point a real fault is cheap |
| Tag                  | `ubuntu`, `macos`, `windows`      | A release is never the first run of a platform    |
| The schedule         | `audit` alone                     | Time changes a dependency's answer, and nothing else's |

`fail-fast: false` on the matrix. "Windows failed" and "Windows and macOS failed" are different bug reports, and cancelling the second one to save a minute costs an hour of diagnosis.

## `-race` and `-shuffle`

Add both to the primary `test` job.

The race detector is not optional for this tree. `internal/trace/sink.go:31` serializes commits under a mutex. `internal/core` was granted `sync` for one reason: stage 2 runs parallel tool groups against one Recorder. `internal/trace/sink_test.go:584` already drives concurrent writers. Those invariants are asserted by tests that cannot fail without the detector.

`-shuffle=on` costs nothing and catches tests that pass only in their written order.

Race instrumentation roughly doubles test time. Measured at 12.7s warm, that is an acceptable trade for the one class of bug this design cannot otherwise see.

## The workflow

```yaml
name: CI

on:
  push:
    branches: [main]          # a PR branch is covered by pull_request, once
    tags: ["v*"]
  pull_request:
  schedule:
    - cron: "17 4 * * *"      # the audit needs a clock, not a commit
  workflow_dispatch:

# A superseded run is cancelled. Tags are exempt: a release run must finish.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}

permissions:
  contents: read

env:
  GOFLAGS: -mod=readonly
  GOTOOLCHAIN: local

jobs:
  quick:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps: [...]              # fmt

  test:
    strategy:
      fail-fast: false
      matrix:
        os: ${{ github.event_name == 'pull_request' && fromJSON('["ubuntu-latest"]')
                || fromJSON('["ubuntu-latest","macos-latest","windows-latest"]') }}
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps: [...]              # build, vet, test -race -shuffle=on, cross-compile check

  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps: [...]              # golangci-lint, gosec included

  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps: [...]              # govulncheck

  gate:
    if: always()
    needs: [quick, test, lint, audit]
    runs-on: ubuntu-latest
    steps:
      - name: Assert every needed job succeeded
        run: |
          set -eu
          echo '${{ toJSON(needs) }}' | grep -q '"result": *"failure"' && exit 1
          echo '${{ toJSON(needs) }}' | grep -q '"result": *"cancelled"' && exit 1
          exit 0
```

`timeout-minutes` on every job. The default is six hours, and a hung job that burns six hours of a shared quota is a worse outcome than a failed one.

**Every third-party action is pinned to a commit SHA, never a tag.** This is the same rule the package registry follows in `docs/reference/architecture.md`, applied to the supply chain that builds the releases. Dependabot raises the pins, so pinning does not mean going stale.

## Observed wall clock

The table this replaced held projections, and said it should be replaced with what was observed. These are the observations, from the runs on 2026-08-10.

| Job                     | Observed                    |
| ----------------------- | --------------------------- |
| `quick`                 | 5–9s                        |
| `platforms` (macOS)     | 27–34s                      |
| `platforms` (Windows)   | 57s                         |
| `audit`                 | 36–37s                      |
| `gosec`                 | 1m17s–1m19s                 |
| `lint`                  | 1m31s–1m39s                 |
| `test`                  | 2m12s–2m43s                 |
| `gate`                  | 4–7s                        |
| `release` (build, sign, attest, publish) | 4m49s      |

| Scenario                 | Before          | Observed after            |
| ------------------------ | --------------- | ------------------------- |
| Push to `main`           | ~40–50s, one job | ~3 min, ten jobs           |
| Tag to published release | n/a             | **7m18s**                  |

Two things the projections got wrong, both worth recording.

**The estimate of ~6 minutes for a release was close** — 7m18s — but for the wrong reason. Most of it is not the build. `release` itself is 4m49s, and the gates it calls run in parallel ahead of it.

**CI on `main` got slower, not faster: 40s to about three minutes.** The projection said 2.5 minutes and treated that as break-even. It is not break-even, it is a four-fold increase, and it buys the race detector, two more operating systems, a security linter, and a dependency audit that the 40-second job never ran. That is the trade, stated as what it is rather than as a saving.

The wins are elsewhere and real: a pull request no longer runs twice, `quick` reports a formatting mistake in nine seconds instead of behind a compile, and a superseded push is cancelled instead of finishing.

The largest single win is not the parallelism. It is deleting the duplicate run.

---

# Part 6 — Dependency audit and Go security

## govulncheck, and the debt it found

`govulncheck` is the gate. It is the Go team's scanner, it reads the official vulnerability database, and it reports by **reachable symbol** rather than by module version. That distinction is what makes it a gate rather than a report: it does not fail a build over a vulnerability in code the binary never calls.

The first run against this tree failed, on two vulnerabilities Eva's own code reached:

| ID              | Module                    | Was      | Now       | Was reached from                          |
| --------------- | ------------------------- | --------- | --------- | ----------------------------------------- |
| `GO-2026-5970`  | `golang.org/x/text`        | `v0.27.0` | `v0.39.0` | `internal/cli/app.go:90`, via `fmt.Fprint` → `norm.Form.Properties` |
| `GO-2026-5320`  | `github.com/yuin/goldmark` | `v1.7.8`  | `v1.7.17` | `internal/render/render.go:473`, via `glamour.TermRenderer.Render` |

Both were indirect dependencies, and both fixes were patch releases. **Both are now bumped, and the scan reports no reachable vulnerabilities.** The table stays as the record of what one run found in a repository that had never been scanned.

The scan still finds seven vulnerabilities in imported packages and three in required modules that Eva's code does not call. Those are not gated on, and that is the correct behaviour.

`GO-2026-5320` is worth keeping in view, because it is a good example of the policy. It is cross-site scripting in an HTML renderer, and Eva renders Markdown to a terminal, so the practical impact here was close to nothing. **It was bumped anyway.** Arguing about impact costs more than the upgrade, and the argument has to be repeated by every future reader. Reserve the judgement for the case where no fixed version exists.

When a fix genuinely does not exist, suppression is explicit and expires: an entry in a `.govulncheck-ignore` file naming the ID, the reason, the person, and a review date. A suppression with no date is a permanent silence dressed as a decision.

## gosec, and why it lands configured rather than blocking

`gosec` was run against this tree. It reports **29 issues**: 9 × G304, 7 × G703, 4 × G115, 3 × G204, 2 × G404, 2 × G101, 1 × G602, 1 × G117.

**Count it with `max-same-issues: 0`.** golangci-lint caps repeated findings at three per rule by default, and the first audit of this tree read 19 because of it. A capped count understates exactly the rules that fire most, which are the ones a policy has to cover.

Seventeen of the 29 are in test files or `tracetest`. The remaining twelve are in production code, and every one was read:

| Finding | Site                            | Verdict                                                             |
| ------- | ------------------------------- | ------------------------------------------------------------------- |
| G101 ×2 | `internal/config/config.go:23,37` | False positive. These are the *names* `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, and the comment above them says a secret enters at the environment boundary and nowhere else |
| G703 ×4 | `internal/config/config.go:280,435,640,646` | False positive. Each path is built from the user's own home directory, and the file is written `0o600` |
| G304 ×2 | `internal/trace/sink.go:66,86`   | By design. The Trace opens the path its configuration names, `O_APPEND` and `0o600`, which is the whole job of a sink |
| G304    | `internal/cli/about.go:88`       | By design. It reads `.git/HEAD`, and the comment says why that is a file read rather than a subprocess |
| G117    | `internal/auth/store.go:108`     | By design. The auth store's purpose is to hold a token, and ADR 0032 decided it |
| G404 ×2 | `internal/providers/retry/retry.go:86`, `internal/tui/caption.go:86` | Correct as written. Retry jitter and picking a caption do not want a cryptographic generator |

So `gosec` cannot be turned on as a blocking gate unchanged. It lands with a policy, inside `golangci-lint` rather than as a separate tool, because that reuses one package load instead of paying for a second. **This config was run against this tree and reports zero issues:**

```yaml
linters:
  enable:
    - depguard
    - gosec

  settings:
    gosec:
      excludes:
        - G115   # integer overflow: every hit constructs a wire position in a test
        - G404   # weak RNG: retry jitter and caption choice, both correct

  exclusions:
    rules:
      - path: _test\.go$
        linters: [gosec]
      - path: internal/trace/tracetest/
        linters: [gosec]
      # The paths below are built from the user's own home directory.
      - path: internal/config/config\.go$
        linters: [gosec]
        text: "G101|G703"
      # The auth store exists to hold a token (ADR 0032).
      - path: internal/auth/store\.go$
        linters: [gosec]
        text: "G117"
      # One reads .git/HEAD; the other opens the Trace its config names.
      - path: (internal/cli/about|internal/trace/sink)\.go$
        linters: [gosec]
        text: "G304"

issues:
  max-same-issues: 0      # a capped count hides the rules that fire most
  max-issues-per-linter: 0
```

Every exclusion is narrow and carries its reason. A blanket `gosec: false` would be simpler and would teach the next reader nothing. A `#nosec` annotation is available for a one-off, and it must carry a reason on the same line or it is a defect.

What this buys is the *next* finding. The eight above are known and dispositioned; the ninth is what the gate is for.

## Integrity, not just vulnerability

| Gate                              | Catches                                                             | Cost   |
| --------------------------------- | ------------------------------------------------------------------- | ------ |
| `go mod verify`                   | A module in the cache whose content no longer matches `go.sum`       | ~1s    |
| `go mod tidy` then fail on a diff | A `go.mod` that drifted from the imports, so `./...` is not honest    | ~3s    |
| `GOFLAGS=-mod=readonly`           | A build that edits `go.mod` to make itself pass                      | free   |
| `GOTOOLCHAIN=local`               | An unpinned toolchain download in the middle of a build              | free   |
| Actions pinned to SHAs            | A tag moved under an action, which is a build-time code substitution  | free   |

`make tidy` exists and nothing asserts its result. The gate is three lines and it closes the gap that ADR 0021 opened by name: `./...` is honest only while the module is.

## Updates arrive on a schedule, not on discovery

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: gomod
    directory: /
    schedule: { interval: weekly }
    groups:
      golang-x:   { patterns: ["golang.org/x/*"] }
      charm:      { patterns: ["charm.land/*", "github.com/charmbracelet/*"] }
      providers:  { patterns: ["github.com/anthropics/*"] }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

Grouping matters more than it looks. Eleven of this module's forty-two dependencies are Charm packages that move together, so one grouped pull request replaces eleven that each rebuild the world.

The `github-actions` ecosystem is the half people forget. It is what keeps SHA pinning from meaning "frozen in 2026".

## The scheduled scan is the important one

A vulnerability appears when it is published, not when a commit is made. A repository with no commits for three weeks is not a repository with no new vulnerabilities. So `audit` runs on a schedule as well as per-change, and a scheduled failure opens a GitHub issue rather than emailing nobody. The period sets the worst case between a publication and a run, and the cron in `audit.yml` is the one place it is written.

`gosec` and `govulncheck` results also upload as SARIF to GitHub code scanning. That gives a finding a place to live between "the build is red" and "somebody remembers".

## What each tool covers

| Tool                | Catches                                   | Blocking | Where                       |
| ------------------- | ----------------------------------------- | -------- | --------------------------- |
| `govulncheck`       | Known CVEs in code Eva actually calls      | yes      | `audit.yml`, per change and scheduled |
| `gosec`             | Unsafe patterns in Eva's own code          | yes      | `security.yml`, its own linter run |
| `depguard`          | A layer importing what it may not          | yes      | `lint`, unchanged           |
| `go mod verify`     | A tampered module cache                    | yes      | `audit.yml`                 |
| `tidy` diff         | A drifted module graph                     | yes      | `audit.yml`                 |
| Dependabot          | Dependencies aging out                     | no       | Weekly pull requests        |
| SBOM                | What a shipped artifact actually contains  | no       | Release assets              |
| Provenance          | Which workflow built an artifact           | no       | Attested at release         |

---

# The order to land it

Each step ships on its own and has a test that can fail. This is the roadmap's rule, applied to a smaller thing.

| # | Step                                                     | Exit test                                                                 | State |
| - | -------------------------------------------------------- | ------------------------------------------------------------------------- | ----- |
| 1 | Add `vuln` to the Makefile. **The two vulnerabilities are already fixed.** | `make vuln` passes, and `make check` still passes         | done |
| 2 | Fix the CI triggers, add `concurrency` and `timeout-minutes` | A pushed PR branch produces one run, not two                          | done |
| 3 | Split CI into `quick`, `test`, `lint`, `audit`, `gate`; add the drift gate | Removing a target from the workflow fails `gate`             | done |
| 4 | Add `-race` and `-shuffle=on`; add the cross-compile check to PRs | A `GOOS=windows` build break fails a PR                           | done |
| 5 | Enable `gosec` with its exclusions; upload SARIF          | `make lint` passes, and a planted `exec.Command(userInput)` fails it       | partly |
| 6 | Add `tidy-check` and `mod-verify`; rename the CI contract to `make verify` | An untidy `go.mod` fails; `AGENTS.md` names `verify` | done |
| 7 | Add Dependabot, grouped, both ecosystems; pin every action to a SHA | A grouped pull request appears, and CI passes on it              | done |
| 8 | Add `version()`'s `Main.Version` fallback and `eva version` | `go install …@v0.1.0` then `eva version` reports `v0.1.0`                | done |
| 9 | Add `.goreleaser.yaml` and `make snapshot`                | `make snapshot` produces five archives locally, with no tag               | done |
| 10 | Add the release workflow: gates, checksums, SBOM, attestation, cosign | Tagging `v0.1.1-rc.1` publishes a prerelease; `gh attestation verify` passes | done |
| 11 | Add `CHANGELOG.md`, generated, with written highlights   | The release notes for a tag list its `feat` and `fix` commits, grouped     | done |
| 12 | Add the install script and the Homebrew tap               | `curl … \| sh` installs `stable`; `--channel next` installs the prerelease  | partly |
| 13 | Document `go install …@main` in the how-to guides          | A person following it gets an unreleased build that reports its own SHA     | done |

Steps 1 and 2 are worth doing today, whatever happens to the rest. One closes a real vulnerability; the other halves the CI bill with a one-line change.

Steps 1 through 8 need no new tool and no secret. Nothing before step 9 can break an existing user, because there are none.

---

# Considered options

- **`-ldflags -X` for the version.** Rejected. `internal/cli/about.go:12` already rejected reading the version from outside the binary, and its reason is unchanged: a link-time version is absent from every build that is not the release build. The tag agrees with the constant instead, and CI enforces the agreement.

- **A moving `stable` git tag.** Rejected on the project's own rule that a ref moves and a SHA does not. In Go it is worse than a style problem: the module proxy caches the first content it sees under a version permanently, so a moved tag serves two different programs under one name.

- **An `edge` channel for the newest build of `main`.** Rejected, and it was in the first draft of this document. `go install …@main` already installs an unreleased build, and it gives a pseudo-version with the commit's SHA in it. Everyone who wants an unreleased build has the toolchain that does it. The channel would have been the only one needing a publish per merge, a build counter, and a version with no tag behind it.

- **Publishing `edge` as workflow artifacts rather than a release.** Rejected with the channel it belonged to. It is cheaper than a rewritten release object and harder to install than either alternative, which leaves it serving nobody.

- **A `channels.json` manifest.** Deferred, not rejected. With two channels, GitHub's `releases/latest` endpoint already resolves `stable` and needs no file kept consistent by the release workflow. The manifest's real value is an unauthenticated, rate-limit-free fetch, and only an in-binary update check needs that. It lands with that decision or not at all.

- **A hand-written changelog only.** Rejected as incomplete by construction. It records what somebody remembered, and this repository already mandates the commit prefixes that make a complete list free.

- **A generated changelog only.** Rejected as meaningless to a reader. A list of subjects does not say what a person can now do. The two-part design keeps the machine's completeness and adds the part only a person can write.

- **Fragment files, as `changie` uses.** A real option, and the standard answer to changelog merge conflicts. Rejected for now because generating at release time has no conflicts either, and it needs no new tool or authoring convention. Revisit if several branches ever land per day.

- **Full automation, as `release-please` does.** Rejected for now. It decides the version bump from the commits and opens a release pull request. Under 1.0, where a minor bump may break, the bump is a judgement rather than a derivation. Revisit at 1.0.

- **Hand-rolled release scripts instead of GoReleaser.** Rejected. It would reimplement the archive matrix, checksums, SBOMs, prerelease detection, and the Homebrew formula. GoReleaser is pinned and run through `go run`, which is the pattern the linter already uses, so it adds no system dependency.

- **`osv-scanner` instead of `govulncheck`.** Rejected as the gate, useful as a supplement. It covers more ecosystems and reports by version rather than by reachable symbol, so as a gate it fails on code the binary never calls. This repository is one Go module, which is exactly `govulncheck`'s case.

- **One CI job per Make target, with no cache design.** Rejected, and it was the first design tried on paper. Four jobs compiling the same graph on two-core runners is slower than one job doing it once. The shared build cache is what makes the split pay, so it comes first.

- **A `setup` job that emits the matrix from the Makefile.** Rejected. It removes the duplicated list, and it adds a serial job's startup latency ahead of every run. The drift gate gets the same guarantee at the end of a run that was already going to happen.

- **Testing all three platforms on every pull request.** Rejected as the default. Cross-compilation catches most portability faults for seconds, and the real matrix runs at merge and at tags. The trade is named rather than hidden: a platform-specific runtime fault can reach `main`, and it is caught there rather than in a release.

- **Larger or self-hosted runners.** Rejected for now. It buys wall clock with money and, for self-hosted, with a security boundary. Nothing here is slow enough to justify either while a duplicate-run fix is still unclaimed.

- **`upx` on the archives.** Rejected. It breaks code signing and reliably triggers antivirus heuristics. 25 MB is what the console's rendering stack costs.

---

# What this costs

Thirteen steps, and roughly a dozen new files. Two of them, `.goreleaser.yaml` and the release workflow, are configuration that only proves itself under a tag — which is why `make snapshot` exists in step 9, before step 10 needs it.

The gates add friction on purpose. A commit with no prefix will be rejected. A dependency with a reachable CVE will stop a merge, sometimes for a reason as thin as XSS in a terminal renderer. That is the trade this project already makes with `depguard`'s strict allow lists, and the reason is the same: a gate that fails closed is worth more than a gate that is convenient.

The recurring cost is small and real. A grouped Dependabot pull request each week, and a scheduled audit that will occasionally be red through nobody's fault. Both are cheaper than the alternative, which is learning about a vulnerability from a user.

# Open questions

1. **Who owns the Homebrew tap?** A `missingstudio/homebrew-tap` repository needs a cross-repository token. That is the first stored secret this design requires, and the only one before macOS signing.
2. **When is notarization worth paying for?** Probably at the first non-Homebrew macOS user who reports a quarantine dialog rather than working around it.
3. **Should `eva` check for updates itself?** This is the question the deferred `channels.json` waits on. A CLI that phones home needs a decision recorded before it is written, not after, and this document does not make it. If the answer is yes, the manifest lands with it, because 60 unauthenticated API calls an hour will not serve a binary that checks on every start.
4. **Does a release deserve an ADR?** The tag-agrees-with-the-constant decision and the no-moving-tags decision both look like ADRs to this author. `docs/adr/` is the ledger, and this page is a plan.
