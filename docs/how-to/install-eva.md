# How to install Eva

Get an `eva` binary onto a machine, and know which build you got. At the end,
`eva version` will report it.

Every path below works. What `stable` and `next` currently point at is on the
[releases page](https://github.com/missingstudio/eva/releases), which is the one
place that cannot be out of date.

## Which path

| You want                                     | Use                                                        |
| -------------------------------------------- | ---------------------------------------------------------- |
| The newest release, on macOS                  | [Homebrew](#with-homebrew)                                  |
| The newest release, and you have Go           | [`go install`](#with-the-go-toolchain)                      |
| The newest release, and you do not have Go    | [the install script](#with-the-install-script)               |
| To try a fix before it is released            | [a prerelease](#a-prerelease)                                |
| The newest commit, and you accept a broken day | [`@main`](#the-newest-commit)                               |
| To work on Eva                                | [source](#build-it-from-source)                              |

## With Homebrew

```bash
brew install --cask missingstudio/tap/eva
```

It resolves to `github.com/missingstudio/homebrew-tap` and installs the newest
**stable** release. A prerelease never reaches the tap, so this is the stable
channel by the same rule that decides the release.

Naming the cask in full is deliberate. Homebrew trusts a third-party tap before
it loads anything from it, and a fully-qualified name trusts **only this one
cask**. A `brew tap` first would widen that to everything the tap will ever hold.

Upgrade and removal are the usual pair:

```bash
brew upgrade --cask eva
brew uninstall --cask eva
```

This is the macOS path. The cask clears the quarantine attribute for you, which
is the one thing the install script can only ask you to do. Homebrew on Linux
carries casks too, but nobody has run this one there — use the install script.

## With the Go toolchain

```bash
go install github.com/missingstudio/eva/cmd/eva@latest
```

`@latest` resolves to the newest release that is not a prerelease. That is Go's
own rule, and it is why this lands on the stable channel without naming it.

The binary goes to `$(go env GOPATH)/bin`. Add that to your `PATH` if it is not
there.

## With the install script

```bash
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh
```

It reads your operating system and architecture, downloads the matching archive,
and **checks the signature and then the checksums the release published before
installing anything**. A checksum that does not match installs nothing and says
both figures.

The download draws a progress bar when it has a terminal to draw on. A run whose
output goes to a file or to a CI log writes no bar and no escape character.
`EVA_INSTALL_NO_PROGRESS=1` turns it off anywhere, and `NO_COLOR=1` turns the
colour off while leaving the bar.

The bar is drawn in blocks, and the install signs off with Eva's wordmark, on a
terminal whose locale says UTF-8. Anywhere else the bar falls back to ASCII and
the wordmark is not drawn — nor is it drawn on a terminal too narrow to hold it
whole.

The binary goes to `~/.local/bin` by default. To choose:

```bash
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh -s -- --dir /usr/local/bin
```

macOS may refuse a downloaded binary that nobody notarized. The script prints
the one command that clears it. Notarized builds are not published yet.

### Running it a second time

The script asks what is already installed before it downloads anything, and it
compares the binary at the directory it would write to:

```
  eva 0.1.1 is already at ~/.local/bin/eva. Nothing to do.
  Run again with --force to install it anyway.
```

So the command is safe in a Dockerfile or a CI step: the second run costs one
request and no download. `--force` installs anyway, which is what to use over a
binary you built yourself — a build from a working tree never counts as the
release, so the script installs over that without being asked.

When `eva` on your `PATH` is a different file from the one it compared, it says
so. Two installs in two directories is the one case where a version report and
the program your shell runs can disagree.

## A prerelease

A prerelease is a release Eva has tagged `-rc` and has not promoted. It is for
somebody who will report what breaks.

```bash
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh -s -- --channel next
```

`go install github.com/missingstudio/eva/cmd/eva@latest` will not find one, by
design: Go skips prereleases. Name the version to get one that way.

```bash
go install github.com/missingstudio/eva/cmd/eva@v0.2.0-rc.1
```

## The newest commit

```bash
go install github.com/missingstudio/eva/cmd/eva@main
```

There is no channel for this and no artifact to download. The Go toolchain
already does it, and it resolves `main` to a pseudo-version carrying the commit —
so `eva version` reports something exact and a fault you find is reportable.

This is the newest commit on the default branch. It has passed CI and nothing
else. Expect a broken day now and then.

## Build it from source

```bash
git clone git@github.com:missingstudio/eva.git
cd eva
make eva
```

You need [Go 1.26](https://go.dev/dl/) or newer, and nothing else. The binary
lands in the repository root.

## Verify

```bash
eva version
```

```
eva:      0.1.0+abc1234
go:       go1.26.5
platform: darwin/arm64
```

The first line is the build. `0.1.0` is the version compiled into the binary, and
what follows `+` is the commit it was built from. A build from a working tree with
uncommitted changes says `.dirty`, and a build the module proxy produced reports
the version it was resolved at in brackets instead.

That whole line is what belongs in a fault report. Two people on `0.1.0` can be
on different commits, and this is what tells them apart.

## Verify what you downloaded

An archive from a release carries more than a checksum. Each one is signed by the
workflow that built it, with no key anybody had to store.

The two checks answer different questions, and the difference is the point:

| Check | What it proves |
| --- | --- |
| checksum | the archive is the one `checksums.txt` names |
| signature | `checksums.txt` came from Eva's release workflow |

The checksum alone proves the download is intact. It cannot prove the release is
Eva's, because it is fetched from the same host as the archive — anybody serving
you a bad archive can serve you a matching `checksums.txt`. The signature is what
closes that, because the signing certificate names the workflow, the repository,
and the tag, and no key was stored anywhere for somebody to steal.

**The install script does both.** It checks the signature first, then the
checksum against the file the signature established. A bad signature or a bad
checksum installs nothing.

It needs [cosign](https://github.com/sigstore/cosign) on the machine for the
signature. Without it the install goes ahead on the checksum alone and says so,
under the result rather than over it:

```
  installed  ~/.local/bin/eva
  verified   checksum only — cosign is not installed, so the signature was not checked
             that proves the download is intact, not that the release is Eva's
             install cosign, or pass --require-signature, to check that too
```

With cosign present, that block is one line naming what vouched for the archive:

```
  installed  ~/.local/bin/eva
  verified   checksum, and the signature of missingstudio/eva's release workflow
```

That is a deliberate default — an installer that refused on a machine with no
cosign is an installer nobody runs. To make it a refusal instead:

```bash
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh \
  | sh -s -- --require-signature
```

or set `EVA_REQUIRE_SIGNATURE=1` to decide it once for every install on a
machine. Either way, nothing is installed unless the signature is checked and
matches. This is what a CI job or a hardened machine wants.

### By hand

```bash
# the archive matches the checksums the release published
sha256sum --check --ignore-missing checksums.txt

# the checksums came from this repository's release workflow
cosign verify-blob checksums.txt \
  --bundle checksums.txt.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/missingstudio/eva/\.github/workflows/release\.yml@refs/tags/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# the binary was built by that workflow, from the commit it names
gh attestation verify eva_*_linux_amd64.tar.gz --repo missingstudio/eva
```

The identity is pinned to the workflow and to a tag, not to the account. A token
from any other workflow in this repository signs a certificate this rejects, and
so does one from a repository whose name merely looks like this one. The install
script builds the same expression, from the repository it is installing from.

The attestation is the third check and the script does not make it: it needs `gh`
and an authenticated GitHub session, which an install path cannot assume.

## Troubleshooting

**`eva: command not found` after installing.** The directory it went to is not on
your `PATH`. The install script says which directory that was, and `go env
GOPATH` says it for `go install`.

**`go install` fails to resolve the module.** If the repository is private, Go
needs to be told not to use the public proxy:

```bash
export GOPRIVATE=github.com/missingstudio/*
```

**macOS says the binary is damaged or from an unidentified developer.** It is the
quarantine attribute, not the binary:

```bash
xattr -d com.apple.quarantine "$(command -v eva)"
```

**The checksum does not match.** Nothing was installed, which is the correct
outcome. Download it again. If it fails a second time, open an issue with the two
figures the script printed.

**The signature is not this repository's release workflow.** Nothing was
installed, and this one does not mean try again. It means the `checksums.txt` you
were served was not signed by Eva's release workflow — so do not install those
bytes, and open an issue with the identity the script printed. The most likely
innocent cause is a fork or a mirror: `EVA_REPO` pointing somewhere else makes the
script expect that repository's workflow, and a release copied from elsewhere
carries the original's signature rather than the copy's.

## Related

- [../tutorial/first-run.md](../tutorial/first-run.md) — ask your first question
- [connect-a-provider.md](connect-a-provider.md) — point it at a model
- [../plans/a-release-is-evidence-not-a-claim.md](../plans/a-release-is-evidence-not-a-claim.md) — why the channels and the tags work this way
