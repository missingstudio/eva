# How to install Eva

Get an `eva` binary onto a machine, and know which build you got. At the end,
`eva version` will report it.

Nothing is released yet, so two of the paths below work today and three do not.
[`@main`](#the-newest-commit) and [source](#build-it-from-source) need no release.
The other three wait for one.

## Which path

| You want                                     | Use                                                        |
| -------------------------------------------- | ---------------------------------------------------------- |
| The newest release, and you have Go           | [`go install`](#with-the-go-toolchain)                      |
| The newest release, and you do not have Go    | [the install script](#with-the-install-script)               |
| To try a fix before it is released            | [a prerelease](#a-prerelease)                                |
| The newest commit, and you accept a broken day | [`@main`](#the-newest-commit)                               |
| To work on Eva                                | [source](#build-it-from-source)                              |

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
and **checks the archive against the checksums the release published before
installing anything**. A checksum that does not match installs nothing and says
both figures.

The binary goes to `~/.local/bin` by default. To choose:

```bash
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh -s -- --dir /usr/local/bin
```

macOS may refuse a downloaded binary that nobody notarized. The script prints
the one command that clears it. Notarized builds are not published yet.

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
eva:      0.1.0+78a2478
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

```bash
# the archive matches the checksums the release published
sha256sum --check --ignore-missing checksums.txt

# the checksums came from this repository's release workflow
cosign verify-blob checksums.txt \
  --bundle checksums.txt.sigstore.json \
  --certificate-identity-regexp 'https://github.com/missingstudio/eva/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# the binary was built by that workflow, from the commit it names
gh attestation verify eva_*_linux_amd64.tar.gz --repo missingstudio/eva
```

The install script does the first of these for you. The other two are for
somebody who wants to know that the release is Eva's and not somebody else's.

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

## Related

- [../tutorial/first-run.md](../tutorial/first-run.md) — ask your first question
- [connect-a-provider.md](connect-a-provider.md) — point it at a model
- [../plans/a-release-is-evidence-not-a-claim.md](../plans/a-release-is-evidence-not-a-claim.md) — why the channels and the tags work this way
