---
status: accepted
---

# An install checks the signature, and says what it could not check

`scripts/install.sh` verifies cosign's signature over `checksums.txt` before it
verifies the archive against it. Where the signature cannot be checked, it installs
on the checksum alone and says on stderr what that leaves unproven.
`--require-signature`, or `EVA_REQUIRE_SIGNATURE=1`, turns that into a refusal.

## What the checksum was actually proving

The release has signed its checksums since the first tag: cosign's keyless flow,
the workflow's own OIDC identity as the key, nothing stored and nothing to rotate.
The install script did not check it. It checked the SHA-256 and stopped.

The gap is not that a checksum is weak. It is that the checksum is fetched from the
same host as the archive:

- An attacker who can serve a bad `eva_darwin_arm64.tar.gz` from that host can
  serve a `checksums.txt` that matches it.
- The same attacker can serve a doctored `install.sh`, because that arrives from
  the same host by `curl … | sh`.

So against the attacker the check appears to defend against, it defends nothing.
What it does establish is real but different: a truncated transfer, a half-published
release whose assets and checksums disagree, and the wrong asset for the platform.
That is integrity of the download. Authenticity of the release was the thing the
signature already made available and nothing automatic consumed.

The script's own header asserted the stronger reading — "nothing it downloads is
installed before its checksum matches" — which is true and which a reader takes for
more than it says.

## Why not simply refuse without cosign

Because the default install path is one `curl` on a machine that has never heard of
Eva, and cosign is not on it. An installer that refused there is an installer
nobody runs, and the failure mode is worse than the one it prevents: people fetch
the archive by hand from the release page and check nothing at all.

So the two cases are separated:

- **A signature that does not hold installs nothing**, whatever the flags say.
  There is no reading of a failed verification that is safe to continue past.
- **A signature that cannot be checked** — no cosign, or a release published before
  signing began — installs on the checksum and says so, in the words of what is
  left unproven rather than only what is missing.

The second is a degradation a person can see, which is the part that makes it
defensible. `--require-signature` exists for the caller who wants no degradation:
a CI job, a hardened machine, an organisation deciding once with
`EVA_REQUIRE_SIGNATURE`.

## Consequences

**The order of the two checks is load-bearing.** The signature is over
`checksums.txt`, so it must be established before the file is spent. Checking the
archive against a file of unknown origin and then asking where the file came from
proves the least of the available orderings.

**The identity is pinned to the workflow and to a tag, not to the account.** It was
read off a published certificate rather than guessed:

```
URI:https://github.com/missingstudio/eva/.github/workflows/release.yml@refs/tags/v0.1.1
```

A keyless signature with no expected identity says only that somebody, somewhere,
signed this — so the expression is anchored at the front, names the workflow, and
requires a tag ref. A token from any other workflow in this repository signs a
certificate this rejects. The repository is regexp-escaped on the way in, because
GitHub allows a dot in a name and an unescaped one matches any character.

**cosign is a seam, not a dependency.** `have_cosign` and `cosign_verify` are two
lines of shell each, and they are functions for the reason `fetch` is one: a test
can neither install cosign nor mint a bundle for a release it did not sign. So the
tests substitute the verdict and assert what the script does with each one, which
is the part that has to be right. Nine defects reached a runner on the first two
releases, every one of them in the release path; this is the class of thing that
would otherwise be reachable only by publishing.

**The rehearsal cannot cover it.** Keyless signing needs an OIDC token a laptop does
not have, so `make snapshot` is unsigned and `make rehearse` exercises the
degraded path — which it now prints, every run, rather than passing over. The
signed path is covered by `install_test.sh` at the seam and by the release itself.

**A third check stays manual.** Each archive carries a provenance attestation, and
`gh attestation verify` needs `gh` and an authenticated session. An install path
cannot assume either, so that one remains documented rather than automatic.

**Falsifier:** the signature stops being the thing that establishes a release.
If GitHub's own asset serving became authenticated end to end such that a checksum
fetched beside an archive were as good as a signature over it, the ordering above
would be ceremony and the degradation message would be telling people to install a
tool that buys them nothing. It would also fall if cosign's keyless verification
stopped being checkable without network access to a transparency log on a machine
that has the bundle — at that point an installer cannot honestly do this check and
the honest move is to stop claiming it.
