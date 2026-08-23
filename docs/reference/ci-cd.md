# CI and CD

How a change is checked and how a release is shipped. The jobs inside `ci.yml`
and what each one is for belong to [toolchain.md](toolchain.md) §5; this file
owns the workflow fleet around them, the release path, and every channel a
person installs Eva from.

Everything here is designed for what this tree is: a Bun monorepo that ships
one compiled CLI. OpenCode ships the same shape — a Bun-compiled TUI, from a
monorepo, to binaries and npm — and is the closest prior art, so its release
path is cited where a decision follows it and where one deliberately does not.

**Status.** All seven workflow files, the release scripts in `scripts/release/`,
and `scripts/install.sh` are in the tree, and the whole release path short of
publishing runs at a desk with `bun run rehearse`. What remains is outside the
repository: the npm trusted-publisher configuration on npmjs.com, the
`HOMEBREW_TAP_TOKEN` secret and the tap repository, and the branch ruleset that
requires the gate and names the release workflow as the one actor allowed to
push to `main`.

## 1. Seven files, one release path

Each file exists because its verdict changes for a different reason, and a
workflow that mixes two reasons for failing cannot be trusted at a glance.

| File                 | Verdict changes when          | Trigger                                    |
| -------------------- | ----------------------------- | ------------------------------------------ |
| `ci.yml`             | the tree changes              | push to `main`, pull request               |
| `security.yml`       | the tree changes              | push to `main`, pull request               |
| `audit.yml`          | an advisory is published      | push, pull request, **schedule**, dispatch |
| `audit-report.yml`   | a scheduled audit fails       | `workflow_run` on Audit                    |
| `release.yml`        | a person cuts a release       | `workflow_dispatch`                        |
| `measure.yml`        | the model changes             | **schedule**, dispatch                     |
| `measure-report.yml` | a scheduled measurement fails | `workflow_run` on Measure                  |

`ci.yml` and `security.yml` are pure functions of the tree, so neither has a
schedule — a scheduled run would spend a runner confirming the last commit's
answer. `audit.yml` is the one file that earns a schedule, because a dependency
advisory is published on somebody else's timetable: without a clock, a
repository that sits quiet for three weeks reports green for three weeks and
means "green as of the last push".

`ci.yml`, `security.yml`, and `audit.yml` all declare `workflow_call`, because
`release.yml` runs them by calling the files rather than restating their steps.
A release can then never be the one run that checked less than a pull request
does.

`audit-report.yml` watches `audit.yml` from outside rather than being a job
inside it, and the reason is load-bearing: a reusable workflow may not request
more permission than its caller grants, so an `issues: write` job inside
`audit.yml` would make it un-callable by the release workflow. Watching from
outside keeps the audit gate asking for nothing but `contents: read`. It files
a scheduled failure as a GitHub issue and comments on the open one rather than
filing a second — a vulnerability unfixed for a month is one issue with four
notes. A failure on a push or a pull request is already in front of the person
who caused it and files nothing.

`measure.yml` is the measured half of Stage 1's exit test: the five canned
Workflows in `packages/exit-test/fixture`, run against the pinned model, with
the ratios printed from the one fold. Its verdict changes when the model
changes, not when the tree does, so it earns a schedule the way `audit.yml`
does and can never live in `ci.yml`. The reason it is not a per-push gate is
not cost — a full run is about $12 to $20 at the vendored rates — it is
nondeterminism, wall clock, and a stored provider secret.
`measure-report.yml` watches it from outside exactly as `audit-report.yml`
watches the audit, and for the same permission reason.

Branch protection requires exactly one check: `ci.yml`'s gate job, which
asserts every job it needs actually succeeded. A skipped job is not a passing
one, and naming jobs individually in a ruleset is how a matrix entry that never
ran reads as green.

Three rules hold across every file. Actions are pinned to commit SHAs, because
a tag is a pointer somebody else controls. Every file declares `permissions:
contents: read` at the top and widens per job, never per file (§9). Every job
has a timeout, because the default is six hours of a stuck runner.

## 2. What a release publishes

Everything below is produced before anything is published — a failed gate
leaves no release and no partial upload.

| Guarantee    | Artifact                                               | Proves                                             |
| ------------ | ------------------------------------------------------ | -------------------------------------------------- |
| The binary   | one archive per target, §3                             | —                                                  |
| Integrity    | `checksums.txt`, sha256 over every archive             | the download is the bytes that were built          |
| Authenticity | `checksums.txt.sigstore.json`, cosign keyless          | the checksums came from this repository's workflow |
| Contents     | one SBOM per archive, syft                             | what is inside, auditable without building         |
| Provenance   | a build attestation per archive                        | which workflow built it, from which commit         |
| Notes        | a changelog folded over the commits since the last tag | what changed                                       |

The integrity chain is three links, and each closes a hole the previous one
leaves. A checksum proves the download is intact, not that it is Eva's —
whoever serves a bad archive serves a matching `checksums.txt`. The signature
closes that: cosign signs with the release workflow's own OIDC identity, so
there is no key to store and nothing to rotate, and verifying it proves the
checksums came from this repository's workflow. Provenance closes the last gap
— which commit, which workflow — and is verified with `gh attestation verify
<archive> --repo missingstudio/eva`.

This is not ceremony. A CLI that people pipe into `sh` and run against their
own repositories is exactly the artifact worth attesting, and every link is one
step in a workflow that already has the OIDC identity for free.

## 3. The binary

`bun build --compile` produces a standalone executable per target: the packed
CLI, the Bun runtime, and OpenTUI's native renderer in one file. A person who
installs it needs no runtime — which is the point of a binary channel when the
full terminal surface needs FFI that only Bun carries
([toolchain.md](toolchain.md) §1).

| Target         | Archive                  |
| -------------- | ------------------------ |
| `darwin-arm64` | `eva-darwin-arm64.zip`   |
| `darwin-x64`   | `eva-darwin-x64.zip`     |
| `linux-arm64`  | `eva-linux-arm64.tar.gz` |
| `linux-x64`    | `eva-linux-x64.tar.gz`   |
| `windows-x64`  | `eva-windows-x64.zip`    |

Five targets: both macOS architectures, both Linux architectures, and the one
Windows architecture with users. Bun cross-compiles every target from one
Linux runner, so there is no build matrix and no per-OS runner to keep alive.
musl, baseline (pre-AVX2), and `windows-arm64` variants — all of which OpenCode
ships — are deferred until a user reports the gap; each is one line in the
target list when it earns its place.

Two traps, both found by OpenCode before us:

**Native dependencies must be installed for every platform before compiling.**
OpenTUI's renderer is one prebuilt package per platform, named as optional
dependencies and resolved for the machine doing the install. A cross-compile
needs them all: `bun install --os="*" --cpu="*"` before the target loop, or
every foreign binary ships without its renderer and fails at first draw.

**The compiled binary cannot read `package.json` at run time.**
`apps/cli/src/version.ts` answers from the manifest, which is correct from
source and from the packed build, and absent from a compiled binary's file
snapshot. The release build injects the version with `--define`, and the code
prefers the injected value. The guard in §4 asks the built binary rather than
the source, so a wrong wiring here reports `0.0.0` and fails before anything
publishes.

Each target the runner can execute gets a smoke test — run `--version`, expect
the version — so "it compiled" is never mistaken for "it starts".

## 4. Cutting a release

A release is one button: `workflow_dispatch` on `release.yml`, with a choice of
`major`, `minor`, or `patch`, or an explicit version for the cases a bump
cannot spell — the first release, a release candidate. The workflow computes
the version from the latest tag and the chosen bump, and everything else is
mechanical.

The decision stays human — somebody chooses the moment and the bump — and the
mechanics stay in CI, where they are logged, reviewed, and identical every
time. What the dispatch model removes is the ritual: no local bump commit, no
tag typed by hand, no push race between the two, and no way to tag the wrong
commit, because the workflow acts on `main`'s head and names the commit it
acted on.

_Rejected:_ tag-push as the trigger. It splits one decision across two local
commands, and the mistakes it invites — a tag on the wrong commit, a tag that
disagrees with the manifest — each need a guard that the dispatch model makes
unnecessary. _Rejected:_ OpenCode's branch-push publishing, where every push to
a release branch ships. That makes merging and releasing the same act, and a
release is a decision, not a side effect. _Rejected:_ changesets. It versions
many packages independently; Eva ships one artifact, and the machinery would
outweigh the version number it manages.

The run, in order:

**Gates.** `checks`, `security`, and `audit` — the three files from §1, called
on the dispatched commit. All three, because a release that skipped one would
be a release nobody checked that thing on.

**Version.** Compute the version, refusing a tag that already exists and a
release with no commits since the previous one — an empty release is a mistake
being published, and it is caught before anything is built. Then write the
version into `apps/cli/package.json`, refresh the lockfile (`bun.lock` records
the workspace version), and commit `release: v<version>` — locally, unpushed,
so the tag names the tree that was built.

**Build and guard.** Compile every target (§3), archive, checksum. Then the
guard: the binary reports the version being published — asked of the program,
not read from the manifest, because what ships is the binary's answer, and
this is what catches a broken `--define` (§3).

**The point of no return.** Tag the bump commit and push both. Everything
before this can fail and leave the repository untouched; everything after this
is publishing. The bump commit is the one push to `main` any workflow makes,
and the branch ruleset names the release workflow as the one actor allowed to
make it. If `main` moved between dispatch and push, the push fails
fast-forward and the run stops having published nothing — dispatch again.

**Publish.** Sign, SBOM, create the GitHub release with the folded notes,
attest. Then the channels, in an order chosen by what a late failure costs:

1. GitHub release assets — everything else points at them.
2. npm (§5) — each publish checks whether the version already exists first, so
   a re-run republishes nothing and fills only what is missing.
3. The Homebrew tap — last, after the release is public, so an expired tap
   token leaves a public release and a stale tap rather than a failed release.
   The recovery is a commit to the tap, not a re-run.

A failed publish is re-entered by dispatching again with `republish` naming
the tag — a tag that exists is a release that already happened, so the version
input refuses it. The republish job runs no gates and pushes nothing: it
downloads the release's own assets, proves them against `checksums.txt`,
rebuilds the packages from those bytes, and every channel already published
skips itself. Everything built is also uploaded as a workflow artifact for 14
days, so a failed publish still leaves the evidence of what was built.

## 5. The channels

| Channel        | Command                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Homebrew       | `brew install --cask missingstudio/tap/eva`                                                    |
| Install script | `curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh \| sh` |
| npm            | `npm i -g @missingstudio/eva` — or `bunx` / `npx @missingstudio/eva`                           |
| The release    | download an archive from §3, verify it with §2                                                 |

**Homebrew** is a cask, not a formula: the release publishes a prebuilt binary
and a cask installs one, where a formula's contract is building from source.
The release writes the cask file and pushes it to `missingstudio/homebrew-tap`.
The cask clears the quarantine attribute on install, because the binary is not
notarized — the honest spelling of that gap until Apple signing earns its
secrets (§9).

**The install script** resolves a version from the GitHub API, downloads the
archive for the host behind a progress bar, verifies the signature first and
then the checksum against the file the signature established, and installs
into `~/.local/bin` (or `--dir`, or `$EVA_INSTALL_DIR`). Without cosign on the
host it proceeds on the checksum and says what that leaves unproven;
`--require-signature` makes it a refusal instead. Windows is not covered — use
the archive or npm. The signer identity it pins is the release workflow on
`main`, because that is the ref a dispatch runs on. The script carries two
test seams: `fetch` is the only thing that reaches the network, and the cosign
verdict is substitutable, so tests replay recorded releases and assert what
the script does with each verdict. `--from-dist` installs from a local
rehearsal build, reaching no network — which is how the rehearsal runs it.

**npm** ships the compiled binary, not the packed JavaScript. One package per
target — `@missingstudio/eva-darwin-arm64` and so on, each holding one binary —
and the wrapper `@missingstudio/eva` names them all as `optionalDependencies`,
so the installer's package manager downloads exactly one. The wrapper's `bin`
is a small script that resolves the installed platform package and executes it.
No postinstall, so `--ignore-scripts` installs work, which is where OpenCode's
postinstall model sends its users an error message instead.

_Rejected:_ publishing the packed JavaScript as the npm artifact. It runs, but
the surface depends on the runtime that happens to invoke it — full TUI under
Bun, the stream renderer under Node — and an install command whose result
depends on the installer is a support thread. The binary is the product;
every channel ships the same one.

## 6. Versions and prereleases

`apps/cli/package.json` is where the released version lives, and the release
workflow is what writes it (§4). Between releases the manifest holds the last
release's number, and a build from source reports it — the compiled binary is
the only artifact that carries a version anybody resolved a download by.

A prerelease is a version: `0.3.0-rc.1`, given to the dispatch as an explicit
version. Every mechanism reads the version string rather than a second setting
that could disagree with it — the GitHub release marks itself prerelease,
`latest` follows from the same fact, npm publishes under the `next` dist-tag
instead of `latest`, and the tap skips the upload. So the stable channel is
`brew`, `npm i @missingstudio/eva`, and the install script's default; the next
channel is `npm i @missingstudio/eva@next` and `install.sh --channel next`.

The release notes are a fold over the commits since the previous tag, grouped
by the prefixes [AGENTS.md](../../AGENTS.md) requires. Two rules keep the fold
honest:

- Release-candidate tags are ignored when finding the previous tag. Otherwise
  `v0.3.0` released after `v0.3.0-rc.1` lists only what landed between the
  two, and everything the candidate already carried goes missing from the
  notes of the release that shipped it.
- Nothing checks the commit prefixes, so a commit written without one is
  omitted from the notes silently. The fold cannot group what does not match.

## 7. Rehearse

The release path, run without a dispatch: `bun run rehearse` compiles every
target, archives, checksums, smoke-tests the host's binary through the guard,
writes the cask file and the npm packages into `dist/`, and then runs the real
installer against that build with `--from-dist` — publishing nothing. The
installer step is what asserts the archive names `install.sh` derives and the
ones `build.ts` wrote agree. It needs no token and no version, so a wrong
archive name or a broken target is caught at a desk or on a pull request
rather than on the one run where finishing matters most.

In CI it is a job in `ci.yml` that runs when a change can reach the release
path — the release scripts, the workflows, the CLI's build configuration — and
decides that in a step rather than an `if:`, because a skipped job is not a
passing one and the gate would need a second exception to tell the two apart.
Everything the rehearsal asserts about the tree's correctness is already
asserted by the other jobs on every push; what it adds is the path itself.

## 8. Security and audit

**`security.yml` runs CodeQL** over the tree's own code — unsafe patterns
written here, rather than vulnerabilities inherited from a dependency. CodeQL
because it is the one analyzer with a native seat in the place findings should
land: code scanning, as SARIF, where a finding is an alert with a state rather
than a line in a job's log. It fails because of the diff in front of you, so
it runs on every change and never on a schedule.

**`audit.yml` owns the dependency graph** — what Eva inherited rather than
what it wrote. Three gates:

- `bun install --frozen-lockfile`: the lockfile still matches every manifest.
- `bun audit --audit-level=high`: no known-exploitable advisory against
  anything installed.
- The install itself enforces `bunfig.toml`'s `minimumReleaseAge` — no
  dependency version younger than three days, the window in which a
  compromised release is usually found and pulled. The exceptions are named in
  that file, each with its reason.

The schedule is Mondays at 07:23 UTC, the morning Dependabot opens its grouped
pull requests, so the week's dependency news arrives together: what needs
bumping, and what is already known to be exploitable. An odd minute, because
everything scheduled on the hour queues behind everything else scheduled on
the hour. This line and this table are the only places the cadence is written.

One consequence for `ci.yml`: today its `verify` job runs `bun audit`, because
one file is all there is. When `audit.yml` lands, the audit step leaves
`ci.yml` — a red CI must mean the commit is wrong, and an advisory published
overnight is not the commit's doing. The desk command `bun run verify` keeps
the audit step, because a person asking "is everything fine" wants the whole
answer.

## 9. Permissions and secrets

The default token is read-only everywhere; a job that needs more asks for it
by name:

| Job            | Permission            | For                                   |
| -------------- | --------------------- | ------------------------------------- |
| release        | `contents: write`     | the bump commit, the tag, the release |
| release        | `id-token: write`     | cosign keyless signing, npm publish   |
| release        | `attestations: write` | the provenance attestation            |
| audit-report   | `issues: write`       | filing the failure                    |
| measure-report | `issues: write`       | filing the failure                    |

npm publishing uses trusted publishing: npm trusts this repository's release
workflow through OIDC, so there is no `NPM_TOKEN` to store, and every publish
carries npm provenance for free. That leaves exactly two stored secrets:
`HOMEBREW_TAP_TOKEN`, fine-grained, `contents: write` on the tap and nothing
else, spent after the release is public; and `ANTHROPIC_API_KEY`, spent only
by the scheduled measurement in `measure.yml`, which requests `contents:
read` and nothing more.

Named gaps, so nobody mistakes silence for coverage: the Windows binary is not
Authenticode-signed and SmartScreen will say so; the macOS binary is not
notarized and the cask clears quarantine instead. Both are solved with money
and certificates, not engineering — OpenCode carries Azure Trusted Signing and
Apple certificates for exactly this — and each arrives when enough users hit
the warning to justify the secret sprawl.

## 10. Taken from OpenCode, and not

Taken, with the reasoning above: the dispatch-with-bump release trigger (§4);
cross-compiling every target with Bun from one runner and smoke-testing what
the runner can execute (§3); installing native dependencies for all platforms
before the target loop (§3); platform npm packages under a wrapper with
`optionalDependencies` (§5); idempotent publishes that skip versions already
on the registry (§4).

Not taken: publishing on branch pushes (§4); the postinstall binary shim (§5);
a beta branch with hourly sync; Windows and macOS signing infrastructure (§9);
AUR and a container image — both are afternoon-sized additions to the publish
step when someone asks, and channels nobody asked for are channels nobody
maintains.

## 11. The runbook: from a desk to a published release

Everything above says why; this section says what to type. It reads start to
finish as one release.

### 11.1 Once, before the first release

Each of these lives outside the repository, and §9 carries the reasoning:

1. On npmjs.com, configure a trusted publisher for `@missingstudio/eva` and
   each `@missingstudio/eva-<os>-<arch>` package: repository
   `missingstudio/eva`, workflow `release.yml`. A package npm refuses to
   configure before it exists gets its first version published by hand from
   `dist/npm/<dir>` after a rehearsal — `npm publish --access public` — and is
   configured after.
2. Store `HOMEBREW_TAP_TOKEN`: a fine-grained token, `contents: write`, on
   `missingstudio/homebrew-tap` and nothing else.
3. In the `main` ruleset: require the `gate` check and nothing else, and let
   GitHub Actions bypass the push restriction — the bump commit and the tag
   are the one push a workflow makes (§4).

### 11.2 Test at the desk

```sh
bun install && bun run verify
```

The whole desk gate — check, tests, pack, audit — and exactly what CI runs on
every change. Then the release path itself:

```sh
bun run rehearse
```

Five targets compiled, the host binary smoke-tested through the guard, the
archives and `checksums.txt` written, the cask and the six npm packages
generated, the notes folded, and the real installer run against the build
(§7). When this is green, the only things a release can still fail on are
credentials and the network.

To see what a dispatch would decide before dispatching:

```sh
EVA_BUMP=minor bun scripts/release/version.ts
```

It prints the version, or refuses for the reason a release would refuse — the
tag exists, or nothing has landed since the previous one. The artifacts are
inspectable where the rehearsal left them: `dist/notes.md` is the release
notes, `dist/homebrew/Casks/eva.rb` is the cask, `dist/npm/` is what npm would
receive, and `cd dist && shasum -a 256 -c checksums.txt` re-proves the
archives.

### 11.3 Dispatch

Releases are never automatic — merging to `main` ships nothing (§4). From a
terminal:

```sh
gh workflow run release.yml -f bump=minor
```

```sh
gh run watch
```

Or from the browser: Actions → Release → Run workflow → choose the bump. One
input, not both: `bump` for a normal release, `version` for what a bump cannot
spell — `-f version=0.2.0-rc.1` for a candidate (npm `next`, GitHub
prerelease, no tap), or the first release. Given both, the explicit version
wins. And `-f republish=v0.2.0` re-enters a release whose publish failed (§4),
touching nothing already published.

The run then does what §4 describes, in that order: the three gates, the
version, the bump commit, five binaries, the guard, the tag push, the release
with its checksums and signature and SBOMs, the attestations, npm, the tap.

### 11.4 Verify what shipped

```sh
gh release view v0.2.0 --repo missingstudio/eva
```

```sh
npm view @missingstudio/eva version
```

```sh
brew install --cask missingstudio/tap/eva && eva --version
```

```sh
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh
```

And the provenance, on any downloaded archive:

```sh
gh attestation verify eva-darwin-arm64.zip --repo missingstudio/eva
```

Then `git pull` — the release put the bump commit and the tag on `main`, and
the desk should hold what shipped.

### 11.5 When it fails

Where it failed says what exists. Before the tag push, nothing: no commit, no
tag, no artifact — fix and dispatch again. After the tag push, the tag and the
release exist and some channels may not; dispatch again with the explicit
version — `-f version=0.2.0` — and every step that already published skips
itself (§4), so the re-run fills only what is missing. The failed run's `dist`
artifact holds what was built, for 14 days, whatever happened after.
