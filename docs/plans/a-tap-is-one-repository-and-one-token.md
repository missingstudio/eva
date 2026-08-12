# A tap is one repository and one token

A Homebrew tap sounds like infrastructure and is not. It is one public
repository, one token, and one config block.

The end state is one command:

```bash
brew install --cask missingstudio/tap/eva
```

It resolves to `github.com/missingstudio/homebrew-tap`, installs the newest
**stable** release, and leaves the binary on the `PATH` with no quarantine
dialog. Upgrade and removal are `brew upgrade --cask eva` and
`brew uninstall --cask eva`.

Naming the cask in full is deliberate. Homebrew requires a third-party tap to be
trusted before it loads anything from it, and a fully-qualified name trusts
**only that one cask**. Documenting the short form would add a `brew tap` and a
`brew trust` step, and would widen what the user trusts to everything the tap
will ever hold.

---

## Decision 1 — a public repository, written only by CI

Homebrew resolves `<owner>/tap` to a repository named `homebrew-tap`. That name
is Homebrew's rule, not a preference.

| Property   | Value                                                                       |
| ---------- | --------------------------------------------------------------------------- |
| Name       | `<owner>/homebrew-tap`                                                      |
| Visibility | Public. A private tap needs a token on every user's machine                 |
| Contents   | `Casks/<name>.rb`, written by the release, and a README written by a person |
| CI         | None                                                                        |
| Writers    | The release workflow, and nobody else                                       |

The cask is created by the first stable release that runs with the token. It is
not committed by hand and it is not reviewed: GoReleaser writes `DO NOT EDIT` at
the top of it, and a generated file has no reviewer.

**Seed the repository before the first release.** A tap with no commits has no
branch to push to. GitHub reports a `default_branch` for an empty repository
anyway, so the first release would *probably* create it on write — and
**probably** is the problem, because this is a release-time path with no dry run,
on the far side of the one step that cannot be rehearsed. A `README.md` on the
default branch costs one commit and turns the unknown into a fact. It also gives
a reader somewhere to land when they follow the tap back from the cask.

## Decision 2 — a fine-grained token, scoped to one repository

`GITHUB_TOKEN` cannot do this. It is scoped to the repository that minted it, and
the tap is a second repository. For most projects this is the first stored
secret, so it is worth being exact about how small it can be.

| Setting        | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Type           | Fine-grained personal access token                    |
| Resource owner | The tap's owner                                       |
| Repositories   | The tap only — **not** the product's repository       |
| Permissions    | Contents: **Read and write**. Nothing else.           |
| Expiry         | The shortest the holder will actually renew           |
| Stored as      | Repository secret `HOMEBREW_TAP_TOKEN` on the product |

Contents write is repository-wide — Homebrew has no per-directory permission — so
this token can rewrite anything the tap ever holds. That is a property of taps
rather than a choice, and it is the reason a tap is worth keeping to generated
files and a README.

**The expiry is the recurring cost, and it fails late.** The cask is pushed after
the release is published, so an expired token gives a public release and a stale
tap rather than a failed release. Keep the recovery in "When it breaks" reachable.

## The config

```yaml
homebrew_casks:
  - name: eva
    ids: [eva]
    binaries: [eva]

    repository:
      owner: missingstudio
      name: homebrew-tap
      token: "{{ .Env.HOMEBREW_TAP_TOKEN }}"

    homepage: https://github.com/missingstudio/eva
    description: An autonomous, AI-native software factory

    # `auto` reads the tag the way `release.prerelease` does: v0.3.0-rc.1 is
    # skipped and v0.3.0 is published. The tap is the stable channel by the same
    # fact that decides the release, not by a second rule that could disagree.
    skip_upload: auto

    hooks:
      post:
        install: |
          if OS.mac?
            system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{staged_path}/eva"]
          end
```

The `postflight` hook is the load-bearing part. Nothing notarizes these builds,
so macOS quarantines what it downloaded, and clearing that attribute is the one
thing an install script cannot do for a person — it can only print the command
and ask. On a project that does notarize, the hook comes out and Homebrew becomes
a convenience rather than a fix.

Three fields are absent on purpose:

- **No `url.verified`.** It is needed only when the download domain differs from
  the homepage domain. Both are `github.com` here.
- **No `directory`.** `Casks` is the default and is what Homebrew expects.
- **No `license`.** A cask has no such stanza.

`skip_upload: auto` is what makes the tap the stable channel. It reads the tag
with the same rule `release.prerelease: auto` uses, so there is no second setting
to keep in agreement with the first.

## Verify it before a tag

This is the part worth copying to any project that publishes to a second
repository. A tap push happens after the release is public, so a wrong cask is
found by a user rather than by the run that wrote it — unless something reads it
first.

`goreleaser release --snapshot --skip=publish,sign,sbom,announce` still runs the
cask pipe and writes the file locally:

```
  • homebrew cask
    • writing    cask=dist/homebrew/Casks/eva.rb
```

So the exact file the tap would receive is on disk, on a laptop, with no tag and
no token. `make rehearse` already builds a snapshot, so reading it costs no extra
build. It asserts three things:

| Assertion                               | The defect it catches                                     |
| --------------------------------------- | --------------------------------------------------------- |
| A cask was written at all               | a skip flag or config change that silently stops the pipe |
| It declares `binary "<name>"`           | a cask that downloads and installs nothing                |
| Every archive it names exists in `dist` | a cask pointing at a file the build did not write         |

The third is the one that would otherwise reach a person. GoReleaser derives the
cask's URLs and the archive names from the same template, so they drift only when
somebody edits one of them — and the release that publishes the drift *succeeds*,
because the archives upload fine and the cask is merely wrong about them.

An assertion that has never failed is a guess. Break each one on purpose before
trusting it:

| Assertion                              | How to make it fail                         | What it must say                                                                      |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| The cask installs the binary           | `binaries: [evax]` in the config            | `rehearse: the cask installs no eva binary`                                           |
| Every archive the cask names was built | move a `darwin_arm64` archive out of `dist` | `rehearse: the cask names dist/…_darwin_arm64.tar.gz, which this build did not write` |

No new Make target, so `make check-coverage` needs nothing and `make check` is
unchanged.

## When it breaks

| Failure                                       | What you see                                               | Recovery                                                                      |
| --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The secret is not passed to the release step  | The template fails on `.Env.HOMEBREW_TAP_TOKEN`, at publish time only | Add it to the step's `env:`. A snapshot never evaluates it, so nothing local sees this |
| Token expired or revoked                      | The release publishes; the job then fails on the cask push | Renew the secret, then commit the cask from the run's `dist` artifact         |
| The tap has no branch to push to              | Same — the push fails on an empty repository               | Seed the README, then commit the cask from the artifact                       |
| Tap repository missing or renamed             | Same — a 404 on push, after publishing                     | Create it, then commit the file from the artifact                             |
| `brew` reports a checksum mismatch            | A user's install fails                                     | An archive was replaced after release. Re-tag; never edit a published archive |
| The cask names an archive that does not exist | The rehearsal, before any tag                              | Fix the archive template and the cask together                                |

The first row is the one the rehearsal cannot reach, and it is worth saying out
loud because it looks like it should. GoReleaser evaluates the token template
only when it is about to publish, so a snapshot passes with the variable unset
and a tag fails with it unset. **The workflow step that runs GoReleaser must
name the secret in its own `env:`** — the repository secret alone does not reach
it.

Rows two through four share one recovery, and it is a copy rather than a re-run only
because the release workflow keeps the cask with the artifacts it uploads:

```yaml
          path: |
            dist/*.tar.gz
            dist/*.zip
            dist/checksums.txt*
            dist/*.sbom.json
            dist/homebrew/Casks/*.rb
```

Re-running the release job is the worse recovery. It republishes artifacts that
are already public to fix a file in another repository.

## The order to do it

Each step has a test that can fail, and the ordering is what keeps a mistake
cheap.

| #   | Step                                                              | Exit test                                                                                              |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Add the `homebrew_casks` block                                    | A snapshot writes `dist/homebrew/Casks/<name>.rb`, and `goreleaser check` is clean                     |
| 2   | Add the rehearsal assertions, and the cask to the artifact upload | Breaking the cask makes the rehearsal fail                                                             |
| 3   | Create `<owner>/homebrew-tap`, public                             | `git clone` succeeds with no credentials                                                               |
| 4   | Seed it with a `README.md` on the default branch                  | The repository reports a non-zero size                                                                 |
| 5   | Mint the fine-grained token; store it as `HOMEBREW_TAP_TOKEN`     | The secret is listed on the product repository                                                         |
| 6   | Tag a prerelease, `vX.Y.Z-rc.1`                                   | The release publishes and **the tap is untouched** — `skip_upload: auto` proved                        |
| 7   | Tag the stable `vX.Y.Z`                                           | The cask appears in the tap; `brew install --cask <owner>/tap/<name>` then the binary reports that tag |
| 8   | Document the surface                                              | The install guide names Homebrew in its which-path table                                               |

Steps 1 and 2 come first because they touch nothing a user can see and are
reversible by reverting a commit. They are also what makes steps 6 and 7 worth
attempting: the cask is read and asserted on a laptop before either tag is spent.

Step 6 before step 7 proves the channel rule on a release nobody depends on.

Step 8 comes last on purpose. A guide that documents an install path is a claim
that the path works, and it does not until step 7 has filled the tap.

## Considered options

- **Homebrew core, instead of a tap.** Rejected. It requires notability most
  projects do not have, and it hands the formula to people who do not read the
  repository. A version bump becomes a pull request against another project,
  gated on their review. A tap publishes in the job that builds the archives, and
  is deleted by deleting a repository.

- **A formula (`brews:`).** Not a choice. GoReleaser deprecated the key and
  `goreleaser check` exits non-zero on it. Noted only because most examples still
  online use it, and the failure is otherwise puzzling.

- **A GitHub App token instead of a personal one.** A real option, deferred. An
  App does not expire and is not attached to a person, which is the right answer
  eventually. It is also a second identity with a private key, an installation,
  and a token-minting step in the workflow — for one write to one repository. It
  becomes correct when the token's expiry causes a second outage, or when the
  owner has a bot account.

- **`repository.pull_request: true`, opening a pull request into the tap.**
  Rejected. The file says `DO NOT EDIT` at the top and is generated from
  artifacts that are already published and checksummed. A review of it is a
  rubber stamp, and a rubber stamp between a release and its install path is a
  release that is half-published for as long as nobody looks.

- **A separate workflow, triggered after the release.** Rejected. GoReleaser
  already does this in the job that has the artifacts. A second workflow adds a
  trigger, a second checkout, and a new way for the tap to disagree with the
  release it came from.

- **A second cask for the prerelease channel.** Deferred. It doubles the tap's
  surface for an audience an install script already serves with one flag, and
  that audience has agreed to report faults — the audience least in need of
  convenience.

- **Shell completions in the cask.** Deferred until the binary has a completion
  command to generate them from. The cask stanza exists and costs four lines when
  there is something to point it at.

## What it costs

One config block, one rehearsal step, one line in the artifact upload, one
public repository, and one secret. No new tool, no new Make target, no new
workflow, and nothing added to the check contract.

The recurring cost is a token that expires. It is a calendar entry, and when it
is missed it costs a stale tap and a copied file rather than a broken release.

## Open questions

1. **Does a tap serve Linux?** GoReleaser writes `on_linux` blocks into the cask,
   and Homebrew's cask support on Linux is partial and untested here. Present
   Homebrew as the macOS path and an install script as the Linux one, rather than
   implying something nobody has run.
2. **When is notarization worth paying for?** The `postflight` hook covers the
   Homebrew path, which is where most macOS users will arrive. The question
   returns with the first user who downloads an archive by hand and reports the
   dialog.

## Related

- [a-release-is-evidence-not-a-claim.md](a-release-is-evidence-not-a-claim.md) —
  the channels, the tags, and the release this hangs off
- [../how-to/install-eva.md](../how-to/install-eva.md) — every install path a
  person has today
