# An install shows its work, and repeats none of it

Status: **landed**, except where "What came out differently" below says otherwise.

How to make `scripts/install.sh` visible while it downloads, and silent when there is
nothing to do. Four changes, about 55 lines of POSIX `sh`, none of which moves the seam
`scripts/install_test.sh` replaces.

Where it stands today, measured against the live `v0.1.1` release on macOS 25.3,
`darwin/arm64`, over a domestic connection:

| | Today |
| --- | --- |
| A first install | 2.22 s, one line, then two seconds of nothing |
| A second install | 2.12 s, and the same 7.88 MB downloaded again |
| One fetch of a 1,002-byte file, cold | 77.4 s, with nothing printed |
| Requests for `--channel next` | up to 22, against a limit of 60 an hour |

## The work

Build these four and no more.

| # | Change | Net lines | What it buys |
| --- | --- | --- | --- |
| 1 | `next_tag` replaces the per-release walk | about 0 | 22 requests become 2 |
| 2 | `installed_version`, the comparison, and `--force` | about 15 | a second install returns in 0.55 s |
| 3 | The bar, behind a test for a terminal | about 35 | the download is visible, and a stall is legible |
| 4 | `checksums.txt` and the signature bundle fetched in the background | about 4 | one connection instead of three |

Changes 1 and 2 are worth landing on their own. Change 4 needs 3, because a background
fetch needs a foreground that lasts.

## Where the two faults come from

The download is silent because `fetch_to` is `curl -fsSL`, and `-s` silences curl's own
meter. Nothing replaces it.

The second install repeats itself because the order has no step that asks what the
machine already holds:

1. Read the options.
2. Detect the operating system and the architecture.
3. Resolve the channel or the version.
4. Download the archive.
5. Verify.
6. Unpack, move, report.

Step 3 already learns the version. Nothing between step 3 and step 4 compares it to
anything. There is no `--force` either, so there is nothing for a skip to be an exception
to.

## Part 1 — The download draws a bar

### The denominator costs no request

GitHub's release document carries each asset's size in bytes:

```
"name": "eva_0.1.1_darwin_arm64.tar.gz"
"size": 7876726
```

The script already fetches that document to resolve a channel, so nothing needs a `HEAD`
request and nothing parses a response header.

### The bar watches the file, not the downloader

```sh
# download_with_progress <url> <path> <expected bytes>
#
# fetch_to stays the only thing that reaches the network. The bar watches what
# it writes, so it serves curl and wget alike, and the tests that replace
# fetch_to keep working without knowing this exists.
download_with_progress() {
	if ! progress_supported || [ "${3:-0}" -le 0 ]; then
		fetch_to "$1" "$2"
		return $?
	fi

	: >"$2"
	fetch_to "$1" "$2" &
	pid=$!
	progress_watch "$2" "$3" "$pid"
	wait "$pid"
}
```

`fetch` and `fetch_to` stay the only two functions that reach the network, so
`install_test.sh` keeps replacing them and keeps passing. The tests are not a terminal,
so `progress_supported` is false there and the watcher never starts.

`fetch_to` keeps `-fsSL` unchanged: `-s` is what stops curl drawing a second meter under
this one, and `-S` is what keeps a failure audible. The wget branch needs no flag change,
because the bar asks the downloader nothing.

### The watcher and the bar

```sh
PROGRESS_WIDTH=40

# progress_supported is true when there is a terminal to draw on.
#
# A script piped into sh has a pipe on stdin and a terminal on stderr, so
# stderr is the one to ask. NO_COLOR silences the colour, not the bar.
progress_supported() {
	[ -t 2 ] && [ -z "${EVA_INSTALL_NO_PROGRESS:-}" ]
}

# progress_watch <path> <total> <pid>
progress_watch() {
	filled=''
	drawn=0
	delay=$(progress_delay)

	printf '\033[?25l' >&2
	while kill -0 "$3" 2>/dev/null; do
		size=$(wc -c <"$1" 2>/dev/null || echo 0)
		progress_draw "$size" "$2"
		sleep "$delay"
	done
	progress_draw "$2" "$2"
	printf '\033[?25h\n' >&2
}

# progress_draw <bytes> <total>
#
# The bar only grows, so the filled part is appended to and never rebuilt.
# That keeps the whole of the drawing inside the shell: one process per frame,
# and it is the one that reads the size.
progress_draw() {
	pct=$(( $1 * 100 / $2 ))
	[ "$pct" -gt 100 ] && pct=100
	on=$(( pct * PROGRESS_WIDTH / 100 ))

	while [ "$drawn" -lt "$on" ]; do
		filled="$filled#"
		drawn=$(( drawn + 1 ))
	done

	empty=''
	n=$drawn
	while [ "$n" -lt "$PROGRESS_WIDTH" ]; do
		empty="$empty."
		n=$(( n + 1 ))
	done

	printf '\r%s%s %3d%%' "$filled" "$empty" "$pct" >&2
}

# progress_delay is the smallest interval this sleep accepts.
#
# POSIX sleep takes whole seconds. Every sleep this script will meet accepts a
# fraction, and the one that does not gets a bar that steps once a second.
progress_delay() {
	if sleep 0.1 2>/dev/null; then printf '0.1'; else printf '1'; fi
}
```

Three constraints the code above has to keep. Append to the filled part rather than
rebuilding it, because `cut` and `printf '%*s'` each cost a process per frame and `%*s`
is not in the POSIX printf utility. Rebuild the empty part rather than trimming it,
because `${empty%?}` removes one byte in some shells and breaks a multi-byte glyph. Use
`#` and `.`, because they need no locale.

### When the bar does not draw

| Condition | What happens |
| --- | --- |
| stderr is not a terminal | `fetch_to` runs in the foreground, and nothing draws |
| `EVA_INSTALL_NO_PROGRESS` is set | the same |
| the size is unknown or zero | the same |
| `--from-dist` | no download happens, so there is nothing to draw |
| the terminal is narrow | the bar is 40 cells and a percentage, so it fits 48 columns |

One rule covers all of them: when the bar cannot be honest, it does not draw.

### The cursor comes back

`progress_watch` hides the cursor, so the existing trap restores it — otherwise a person
who presses Ctrl-C keeps an invisible cursor in their shell:

```sh
trap "rm -rf '$tmp'; printf '\033[?25h' >&2" EXIT INT TERM
```

## Part 2 — The second install returns at once

### The order gains one step

1. Read the options.
2. Detect the operating system and the architecture.
3. Resolve the channel or the version to a release document. **Now one request.**
4. **Read the version at `$DIR/eva`. When it matches, report it and exit 0.**
5. Download the archive, with the bar.
6. Verify the signature, then the checksum.
7. Unpack, move, report.

Step 4 sits after the resolution because the comparison needs both numbers, and before
the download because that is the work it saves.

### Compare the binary that would be overwritten

Compare `$DIR/eva`, which is the file the install replaces — not whatever `command -v`
answers, which can be a different file. Report both when they differ:

```
eva 0.1.1 is already at ~/.local/bin/eva. Nothing to do.
`eva` on your PATH is /usr/local/bin/eva, which is a different file.
```

### What counts as the same version

`eva version`'s first line carries the build, and `internal/cli/about.go` writes four
shapes. Only two of them may be skipped:

| The first line says | The build is | Skip? |
| --- | --- | --- |
| `0.1.1` | a release, installed by the module proxy | yes |
| `0.1.1+8c8d116` | a release, built from that commit | yes |
| `0.1.1+8c8d116.dirty` | somebody's working tree | no |
| `0.1.1 (v0.1.2-0.2026…)` | a commit the module graph resolved elsewhere | no |

The last two are why the predicate is strict rather than a prefix match: somebody
developing `0.1.1` who installs the released `0.1.1` must not be told there is nothing to
do. `about.go` appends `.dirty` for a modified tree and prints a bracketed module version
only when it differs from the constant, so either mark is enough to install.

```sh
# installed_version <path to an eva binary>
#
# The version of a release build, and nothing otherwise. A .dirty suffix or a
# bracketed module version fails the match, so a working tree and a resolved
# commit both read as "install it" — which is the safe answer, and the same
# answer a missing or unreadable binary gives.
installed_version() {
	[ -x "$1" ] || return 0
	"$1" version 2>/dev/null | head -n 1 |
		sed -n 's/^eva: *\([0-9][^+ ]*\)\(+[0-9a-f]\{1,\}\)\{0,1\}$/\1/p'
}
```

Against the four shapes above it returns `0.1.1`, `0.1.1`, nothing, nothing. It returns
`0.2.0-rc.1` for a prerelease build, so `--channel next` skips correctly too. Running
`eva version` costs 0.073 s and reads no configuration and no network.

### The escape

```
--force   install even when that version is already there
```

One flag and one `if`. It also serves the person whose binary is corrupt, and the person
who wants the release build over their own.

What it saves:

| Path | Today | Proposed |
| --- | --- | --- |
| Second install, stable, no change | 2.12 s | about 0.55 s |
| Bytes transferred | 7.88 MB | 35 KB |

The 0.55 s is one API request at a measured 0.47 s, plus 0.073 s to run `eva version`.

## Part 3 — The request budget

### One request, not twenty-two

`resolve_tag next` fetches the releases list, then fetches each release by tag until one
says it is a prerelease — one request plus up to twenty. Replace the walk with a one-pass
parse that keeps the guarantee the walk was written for. A release's own fields sit at
four spaces and an asset's at eight, so anchoring on the indent cannot read a nested
object as a release's own flag:

```sh
# next_tag reads the newest prerelease from one releases list.
#
# The record boundaries are the anchor, not the braces inside it. A release's
# own fields are indented four spaces and an asset's are indented eight, so
# nothing nested can be read as a release's own flag. The fields are buffered
# and the decision is taken at the end of the record, so the order GitHub
# writes them in does not matter.
next_tag() {
	awk '
		/^  \{/                    { tag=""; pre=0 }
		/^    "tag_name":/         { tag=$0; sub(/^[^:]*: *"/,"",tag); sub(/".*$/,"",tag) }
		/^    "prerelease": *true/ { pre=1 }
		/^  \}/                    { if (pre && tag != "") { print tag; exit } }
	'
}
```

Against the recorded fixtures in `scripts/testdata/` that returns `v0.3.0-rc.1`. The
fixture list holds a stable release ahead of the prerelease, which is the shape that
catches a parser reading the list rather than each record.

The same anchoring reads an asset's size:

```sh
# asset_size <asset name>, from one release document
asset_size() {
	awk -v want="$1" '
		/^    \{/        { name=""; size="" }
		/^      "name":/ { name=$0; sub(/^[^:]*: *"/,"",name); sub(/".*$/,"",name) }
		/^      "size":/ { size=$0; sub(/^[^0-9]*/,"",size); sub(/[^0-9].*$/,"",size) }
		/^    \}/        { if (name == want && size != "") { print size; exit } }
	'
}
```

Against the live `v0.1.1` document: `7876726` for the darwin/arm64 archive, `1002` for
`checksums.txt`, and nothing for a name that is not there. Both parsers use POSIX awk
only, and both ran under the BSD awk macOS ships.

### The budget, before and after

| Path | Requests today | Requests proposed | Archive downloaded |
| --- | --- | --- | --- |
| stable, fresh machine | 1 | 1 | yes |
| next, fresh machine | 1 + N, N up to 20 | 2 | yes |
| `--version`, fresh machine | 0 | 1 | yes |
| stable, already installed | 1 | 1 | **no** |
| next, already installed | 1 + N | 2 | **no** |
| `--from-dist` | 0 | 0 | no |

`next` needs two: the list gives the tag, the release document gives the asset sizes.
`--version` gains one, and gains a failure that says the version is not a release rather
than a 404 body at the archive.

### The small files ride with the archive

Three files are fetched from the release: the archive, `checksums.txt`, and
`checksums.txt.sigstore.json`. Measured, a second curl process costs a new connection
where reusing one costs none:

| How | Time for `checksums.txt` | New connections |
| --- | --- | --- |
| A second curl process | 0.21 s, 15.1 s, 77.4 s | 2 |
| The same process, second URL | 0.066 s | 0 |

Do not pass two URLs to one curl: that puts a second shape through the `fetch_to` seam
and wget cannot serve it. Fetch the two small files in the background while the archive
downloads, so their connection cost disappears inside it:

```sh
fetch_to "$base/checksums.txt" "$tmp/checksums.txt" &
sums_pid=$!
fetch_to "$base/checksums.txt.sigstore.json" "$bundle" &
bundle_pid=$!

download_with_progress "$base/$archive" "$tmp/$archive" "$size" ||
	die "no archive at $base/$archive"

wait "$sums_pid" ||
	die "the release has no checksums.txt, so nothing can be verified"
# The bundle is optional: a release published before signing began has none.
wait "$bundle_pid" || rm -f "$bundle"
```

The order of the checks does not change. The signature is still verified before the
checksum, and nothing is installed before both have been answered.

## The flow, after this lands

```
$ curl -fsSL .../install.sh | sh

resolving the stable channel                       0.47 s
installing eva 0.1.2 (darwin/arm64) from stable
######################################## 100%      1.8 s
signature ok — checksums.txt was signed by missingstudio/eva's release workflow
checksum ok
installed ~/.local/bin/eva

Check it:
  ~/.local/bin/eva version
```

And the second time:

```
$ curl -fsSL .../install.sh | sh

eva 0.1.2 is already at ~/.local/bin/eva. Nothing to do.
Run again with --force to install it anyway.
```

## How this is verified

`install_test.sh` replaces `fetch` and installs nothing, so it takes the parsing and the
comparison. `make rehearse` runs the real path against a snapshot build, so it takes the
skip and the force.

| Case | Where |
| --- | --- |
| `next_tag` finds the prerelease behind a stable release | `install_test.sh` |
| `next_tag` returns nothing when the list holds no prerelease | `install_test.sh` |
| `asset_size` reads a named asset, and rejects a missing one | `install_test.sh` |
| `installed_version` parses `eva: 0.1.1+abc1234` and `eva: 0.1.1` | `install_test.sh` |
| `installed_version` is empty for a missing or silent binary | `install_test.sh` |
| A `.dirty` build is not treated as installed | `install_test.sh` |
| A bracketed module version is not treated as installed | `install_test.sh` |
| A prerelease build parses, so `next` can skip too | `install_test.sh` |
| A run with stderr on a pipe writes no escape byte | `install_test.sh` |
| The cursor is not restored where no bar hid it | `install_test.sh` |
| The signing identity names the release workflow and the tag | `install_test.sh` |
| A required signature that cannot be checked refuses | `install_test.sh` |
| An install from a snapshot build still works | `rehearse.sh`, step 5 |

Write the non-TTY case first. It is what keeps a carriage return every 100 ms out of a CI
log, and it is asserted by counting the bytes on stderr.

**`rehearse.sh` cannot cover the skip, and it was wrong to say it could.** Step 5 installs
from a snapshot, and a snapshot binary reports the version constant while the archive is
named after a snapshot version — so the two never match and the skip never fires there. A
snapshot built from a working tree also reports `.dirty`, which the predicate refuses by
design. The skip is covered by the unit cases above, and by a real install run twice
against the live release.

Two things no case covers. No automated case proves a terminal shows a growing bar, so a
person looks at a real one once. And the script does not cover Windows, which this changes
in no way.

## What came out differently

| Departure | Why |
| --- | --- |
| The signature is untouched | This page was written against a tree with no signature check. One landed first, with two seams of its own and sixteen cases. Nothing here changes it: the small files it fetches are now overlapped, and that is all |
| `progress_stop` exists, and the trap calls it | The trap printed the cursor-show escape unconditionally, which put six bytes of stderr into every piped run — the exact thing the terminal test is for. Found by counting the bytes, not by reading the code |
| The test counts requests in a file, not a variable | A `fetch` inside a command substitution runs in a subshell, so a variable it increments is lost. The counter reported one request for the two `next` makes |
| The skip applies to `--from-dist` too | One rule rather than two. It never fires there, because a snapshot archive is named after a snapshot version and the binary inside it reports the constant |

One thing the measurements did not support. The 0.55 s estimate for a second install came
out at **1.19 s** on the same machine, against 2.12 s before. The API request is the floor,
and it varies more than the estimate allowed for.

## Sequencing

Four commits, one per change. Each leaves the script working and is reviewable alone.

| # | Commit | Depends on |
| --- | --- | --- |
| 1 | `next_tag` and `asset_size` with their cases, the walk deleted, `--version` resolved through the same document | — |
| 2 | `installed_version`, `--force`, and the early exit | 1 |
| 3 | The bar, the cursor in the trap, and the non-TTY case | 1 |
| 4 | The small files fetched in the background | 3 |

Commit 1 carries the parsers and their use in one change, because a parser nothing calls
is a second way to do one thing. It folds `--version` into the same resolution rather than
leaving a second path. It is worth landing even if the rest waits, because it removes a
walk that can spend a third of an hour's rate limit on one install.

Documentation lands with the behaviour that needs it, in commits 2 and 3, not as a step of
its own.
