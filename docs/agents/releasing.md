# Releasing

GoReleaser, the channels, the guard, and the Homebrew tap are built. This says
**when** to tag, **what** to tag it, and **which** of the two channels it lands
in. The mechanics of what a tag sets off are in
[a release is evidence, not a claim](../plans/a-release-is-evidence-not-a-claim.md);
this page is the decision in front of them.

Three rules hold everything else up.

- **A tag is the only trigger.** Nothing else publishes.
- **Every tag is immutable.** A bad tag is answered by the next tag, never by
  deleting one. In Go this is not a style rule: the module proxy caches the first
  content it sees under a version, permanently.
- **The tag must equal the version the binary reports.** `const Version` in
  `internal/cli/about.go` is the source of truth, and the release guard fails the
  release when a tag disagrees with it.

## 1. Is there anything to release?

The release notes are a fold over commits since the previous tag. It groups
`feat`, `fix`, `refactor`, and `perf`, and it **excludes** `docs`, `test`,
`build`, `ci`, and `chore`. So the fold answers the question by itself:

```bash
git log --oneline "$(git describe --tags --abbrev=0)"..HEAD | grep -cE '(feat|fix|refactor|perf)(\(.+\))?!?:'
```

**Zero means do not release.** Not "release with thin notes" — do not release.
A release whose notes are empty is a release that changed nothing a user can act
on, and it spends a version number to say so. Build, CI, and documentation work
is real work that rides along on the next release that has something to say.

This is why the Homebrew tap did not get a release of its own. It was `build:`
and `docs:` commits, the fold produced nothing, and the cask publishes on
whatever the next stable tag turns out to be.

## 2. Which bump

| Change                                                               | Bump  | Example         |
| --------------------------------------------------------------------- | ----- | --------------- |
| A breaking change to a CLI verb, a config key, or a documented output | minor | `0.1.0 → 0.2.0` |
| A new capability                                                      | minor | `0.1.0 → 0.2.0` |
| A fix with no interface change                                        | patch | `0.1.0 → 0.1.1` |
| The first stable interface promise                                    | major | `0.x → 1.0.0`   |

Under 1.0 a minor bump may break. That is what `0.` means.

Read the table against **what the program does**, not against how much work the
change was. A distribution surface, a workflow, or a refactor with no visible
effect is not a new capability — it is invisible to the person reading the notes,
which is the same answer step 1 gave.

The version is bumped in `internal/cli/about.go` and committed **before** the
tag, because the guard compares the tag to what the built binary reports.

## 3. Candidate, or straight to stable?

| The change touches                                                    | Cut a candidate first |
| ----------------------------------------------------------------------- | --------------------- |
| `.goreleaser.yaml`, `scripts/`, `.github/workflows/`, the Makefile's release targets | **Yes**  |
| A signing, SBOM, attestation, or tap setting                           | **Yes**               |
| Go code, tests, documentation                                          | No                    |

The rule follows from what the first two releases cost. **Nine defects reached a
runner, and every one was in the release path rather than in Eva.** Each was
reachable only by pushing a tag.

`make rehearse` closed most of that gap — it runs the guard, the installer's
cases, a snapshot of every target, an install from what it built, and the cask
the tap would receive. Three things stay outside it and always will:

| Not rehearsable        | Why                                                        |
| ---------------------- | ------------------------------------------------------------ |
| Keyless signing        | cosign needs an OIDC token, which no laptop has              |
| The Homebrew tap push  | It needs the stored token and a published release to point at |
| `HOMEBREW_TAP_TOKEN` reaching GoReleaser | The token template is evaluated only when publishing, so a snapshot passes with it unset |

A candidate is how you spend those three on a release nobody depends on. It is
also the only way to prove the channel rule: `skip_upload: auto` means a
prerelease must leave the tap **untouched**, and the way to know is to tag one
and look.

## 4. The candidate trap, and the setting that answers it

A candidate is not free, and the cost is not obvious.

GoReleaser folds the changelog from the previous tag, and a candidate **becomes**
that previous tag. Measured on the pinned version:

```
• using tags   previous=v0.1.1-rc.1  current=v0.1.1

## Changelog
### Added
* feat: the second feature, after the candidate
```

The first feature shipped in `v0.1.1`. It is in the archive. It is missing from
the release notes, silently, because it landed before the candidate and the fold
only sees what came after.

`git.ignore_tags` fixes it, and it works in the free GoReleaser:

```yaml
git:
  ignore_tags:
    - "*-rc.*"
```

With it, the same two tags resolve `previous=v0.1.0 current=v0.1.1`, and both
features appear. Releasing the **candidate itself** still resolves correctly —
`previous=v0.1.0 current=v0.1.1-rc.1` — because the current tag comes from the
commit being released, not from the search the setting narrows.

So a candidate costs a tag and nothing else, and the release notes stay complete.

## 5. The sequence

```bash
make verify                    # what CI runs
make rehearse                  # when the change touched the release path
```

Then, in order:

1. Bump `const Version` in `internal/cli/about.go`. Commit it.
2. Push the branch, land it, and be on the commit you intend to release.
3. Tag and push:
   ```bash
   git tag v0.1.1-rc.1 && git push origin v0.1.1-rc.1
   ```
4. Watch the run. Every gate — checks, security, audit, guard — runs before
   anything publishes. A failed gate leaves no release and no artifact.
5. Verify what published, from the outside:
   ```bash
   sha256sum --check --ignore-missing checksums.txt
   gh attestation verify eva_*_linux_amd64.tar.gz --repo missingstudio/eva
   ```
6. **On a candidate:** confirm the tap was *not* written to. That is the channel
   rule proving itself.
   **On a stable tag:** confirm `Casks/eva.rb` landed, then install it the way a
   user would and check the version it reports.
7. Write the highlights into `CHANGELOG.md`. The generated fold says what
   changed; only a person can say what it means.

## 6. When it goes wrong

| What happened                          | What to do                                                        |
| -------------------------------------- | ------------------------------------------------------------------- |
| A gate failed                          | Nothing published. Fix it, then tag again with the next version    |
| The tag disagreed with the constant    | The guard caught it and nothing published. Bump, commit, tag again |
| Artifacts published, the tap push failed | Renew or add the token, then commit the cask from the run's `dist` artifact. Do not re-run the release |
| A published release is wrong           | The next tag answers it. Never delete or move a tag                |
| A candidate wrote to the tap           | `skip_upload: auto` is broken. Stop before the stable tag          |

## 7. Cadence

There is none, on purpose. Releases follow the fold, not the calendar. When step
1 returns zero there is nothing to ship; when it returns something a user would
want, ship it.

The one standing exception is a security fix. It is a patch, it goes straight to
stable, and it does not wait for company.

## Related

- [../plans/a-release-is-evidence-not-a-claim.md](../plans/a-release-is-evidence-not-a-claim.md)
  — the channels, the gates, and why the tags work this way
- [../plans/a-tap-is-one-repository-and-one-token.md](../plans/a-tap-is-one-repository-and-one-token.md)
  — the Homebrew surface, and what still needs setting up
- [../how-to/install-eva.md](../how-to/install-eva.md) — what a user does with
  what you published
