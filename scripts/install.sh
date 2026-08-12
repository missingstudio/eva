#!/bin/sh
#
# Install Eva from a published release.
#
#   curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh
#   curl -fsSL … | sh -s -- --channel next
#   curl -fsSL … | sh -s -- --version 0.2.0 --dir /usr/local/bin
#
# A channel is resolved here rather than stored anywhere. Nothing in this script
# can move a version.
#
# The signature is checked first, then the checksum against the file the
# signature established. The checksum alone proves the download is intact, not
# that the release is Eva's — whoever serves a bad archive serves a matching
# checksums.txt. Without cosign the install goes ahead on the checksum and says
# what that leaves unproven; --require-signature makes it a refusal instead.
#
# Windows is not covered. Use the archive from the release page, or `go install`.
#
# Two seams make this testable. `fetch` is the only thing that reaches the
# network, so tests replace it with recorded releases. `cosign_verify` and
# `have_cosign` are the second: a test cannot mint a sigstore bundle, so it
# substitutes the verdict and asserts what this script does with each one.
#
# Sourcing this file with EVA_INSTALL_LIB=1 defines the functions and installs
# nothing.
set -eu

REPO="${EVA_REPO:-missingstudio/eva}"
API="https://api.github.com/repos/$REPO"

# REQUIRE_SIG is whether a signature that cannot be checked stops the install.
#
# It is read here as well as from the flag, so that a machine can decide once for
# every install on it rather than at every call site. install_main overrides it
# when --require-signature is given, and never the other way round: a flag may
# tighten this and nothing may loosen it.
REQUIRE_SIG="${EVA_REQUIRE_SIGNATURE:-0}"

# The issuer that vouches for a release's signing certificate.
#
# It is GitHub's OIDC provider because the signing happens in a GitHub Actions
# job, and it is written here rather than passed in because a caller who could
# name a different issuer could name their own.
SIG_ISSUER="https://token.actions.githubusercontent.com"

# The bar is 40 cells, so it and its percentage fit a 48-column terminal.
PROGRESS_WIDTH=40

die() {
	echo "install: $*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Install Eva.

USAGE:
  install.sh [--channel stable|next] [--version X.Y.Z] [--dir <path>]
             [--force] [--from-dist <dir>] [--require-signature]

OPTIONS:
  --channel <name>   stable (default) is the newest release; next is the newest
                     prerelease
  --version <X.Y.Z>  install exactly this version, whatever any channel says
  --dir <path>       where the binary goes; default ~/.local/bin, or
                     $EVA_INSTALL_DIR when that is set
  --force            install even when that version is already installed there
  --from-dist <dir>  install from a local `make snapshot` build rather than a
                     release, reaching no network. This is how the rehearsal
                     runs this script before there is a tag.
  --require-signature
                     install nothing unless the release's signature is checked
                     and matches. Without it, a machine with no cosign installs
                     on the checksum alone and is told so. $EVA_REQUIRE_SIGNATURE
                     sets it for every install on a machine.
  --help             show this

VERIFICATION:
  The signature proves the checksums came from this repository's release
  workflow; the checksum proves the archive matches them. A bad signature or a
  bad checksum installs nothing, whatever the flags say.

PROGRESS:
  A download draws a bar when it has a terminal to draw on, and draws nothing
  when its output is a file or a log. EVA_INSTALL_NO_PROGRESS turns it off.

Eva reports what it is with `eva version`.
EOF
}

# The seam.
#
# fetch <url>              writes the body to stdout
# fetch_to <url> <path>    writes the body to a file
#
# Defined from whichever tool is present, and replaced wholesale by the tests.
# Everything that reaches the network goes through these two.
#
# curl keeps -s, which silences its own progress meter, because this script
# draws its own. -S stays with it, so a failure is still audible.
install_choose_fetch() {
	if command -v curl >/dev/null 2>&1; then
		fetch() { curl -fsSL "$1"; }
		fetch_to() { curl -fsSL -o "$2" "$1"; }
	elif command -v wget >/dev/null 2>&1; then
		fetch() { wget -qO- "$1"; }
		fetch_to() { wget -qO "$2" "$1"; }
	else
		die "neither curl nor wget is installed"
	fi
}

# The artifact contract.
#
# The one place this script states what a release is called. It mirrors
# .goreleaser.yaml's name_template and its windows format_override, and
# `make rehearse` asserts the two agree by checking these names against the
# files a snapshot build actually wrote.
archive_name() {
	case "${2:-}" in
	windows) printf 'eva_%s_%s_%s.zip' "$1" "$2" "$3" ;;
	*) printf 'eva_%s_%s_%s.tar.gz' "$1" "$2" "$3" ;;
	esac
}

# The platform, in the names the archives are built under.
detect_os() {
	os=$(uname -s | tr '[:upper:]' '[:lower:]')
	case "$os" in
	darwin | linux) printf '%s' "$os" ;;
	*) return 1 ;;
	esac
}

detect_arch() {
	case $(uname -m) in
	x86_64 | amd64) printf 'amd64' ;;
	arm64 | aarch64) printf 'arm64' ;;
	*) return 1 ;;
	esac
}

# Channels.
#
# Every path resolves one release document and then reads it. The document names
# the tag, and it names each asset's size — which is where the progress bar gets
# its total, at the cost of no extra request.
#
# The parsers are dependency-free, because jq is not on every machine that will
# run this. They are anchored on the indentation, which is what replaces the
# walk that cost a request per release: splitting the whole releases list on `{`
# split the nested author and assets objects too, and --channel next found
# nothing. A release's own fields are indented four spaces in the list and an
# asset's are indented eight, so nothing nested can be read as a release's own
# flag.

# release_tag reads the tag from one release document.
release_tag() {
	awk '/^  "tag_name":/ { sub(/^[^:]*: *"/,""); sub(/".*$/,""); print; exit }'
}

# next_tag reads the newest prerelease from one releases list.
#
# The fields are buffered and the decision is taken at the end of each record,
# so the order GitHub writes them in does not matter.
next_tag() {
	awk '
		/^  \{/                    { tag=""; pre=0 }
		/^    "tag_name":/         { tag=$0; sub(/^[^:]*: *"/,"",tag); sub(/".*$/,"",tag) }
		/^    "prerelease": *true/ { pre=1 }
		/^  \}/                    { if (pre && tag != "") { print tag; exit } }
	'
}

# asset_size <name> reads one named asset's size from one release document.
#
# Empty when the document names no such asset, which is what a half-published
# release looks like. The bar treats an empty total as unknown and does not
# draw, rather than guessing one.
asset_size() {
	awk -v want="$1" '
		/^    \{/        { name=""; size="" }
		/^      "name":/ { name=$0; sub(/^[^:]*: *"/,"",name); sub(/".*$/,"",name) }
		/^      "size":/ { size=$0; sub(/^[^0-9]*/,"",size); sub(/[^0-9].*$/,"",size) }
		/^    \}/        { if (name == want && size != "") { print size; exit } }
	'
}

# release_doc <channel> <version> <path> writes the release document to <path>.
#
# One request for a named version, and one for the stable channel. Two for next,
# because the list says which release is the prerelease and the release itself
# says how big its assets are.
release_doc() {
	if [ -n "$2" ]; then
		fetch "$API/releases/tags/v${2#v}" >"$3" 2>/dev/null ||
			die "v${2#v} is not a release of $REPO
The releases page lists what is: https://github.com/$REPO/releases"
		return 0
	fi

	case "$1" in
	stable)
		fetch "$API/releases/latest" >"$3" 2>/dev/null ||
			die "no stable release found for $REPO
A prerelease may exist: try --channel next."
		;;
	next)
		tag=$(fetch "$API/releases?per_page=20" 2>/dev/null | next_tag)
		[ -n "$tag" ] || die "no prerelease found for $REPO
Try --channel stable."
		fetch "$API/releases/tags/$tag" >"$3" 2>/dev/null ||
			die "the release $tag cannot be read"
		;;
	*) return 1 ;;
	esac
}

# What is already installed.
#
# installed_version <path to an eva binary> writes the version of a release
# build, and nothing otherwise.
#
# The match is strict on purpose. internal/cli/about.go appends `.dirty` to a
# build from a modified tree, and prints a bracketed module version only when
# that version differs from the constant. Either mark means the binary is not
# the plain release, so either mark fails this match and the install proceeds:
# somebody developing 0.1.1 who installs the released 0.1.1 must not be told
# there is nothing to do.
#
# A missing binary, one that cannot run, and one that answers with something
# unreadable all report nothing — which is the same safe answer: install it.
installed_version() {
	[ -x "$1" ] || return 0
	"$1" version 2>/dev/null | head -n 1 |
		sed -n 's/^eva: *\([0-9][^+ ]*\)\(+[0-9a-f]\{1,\}\)\{0,1\}$/\1/p'
}

# report_installed <version> <dir> says the work is already done.
#
# It names the file it compared, because that is the file an install would
# replace. When the PATH resolves `eva` to a different file it says so: the
# person is otherwise told a version is installed while their shell runs
# another one.
report_installed() {
	echo "eva $1 is already at $2/eva. Nothing to do."

	onpath=$(command -v eva 2>/dev/null || true)
	if [ -n "$onpath" ] && [ "$onpath" != "$2/eva" ]; then
		# shellcheck disable=SC2016 # the backticks are literal: they quote a command name.
		printf '`eva` on your PATH is %s, which is a different file.\n' "$onpath"
	fi
	echo "Run again with --force to install it anyway."
}

# Progress.
#
# The bar watches the file the download writes. It asks the downloader nothing,
# so it serves curl and wget alike, and the seam above stays the only thing that
# reaches the network. A test that replaces fetch_to is not a terminal, so none
# of this runs there.

# progress_supported is true when there is a terminal to draw on.
#
# A script piped into sh has a pipe on stdin and a terminal on stderr, so stderr
# is the one to ask. This is what keeps a carriage return every tenth of a
# second out of a CI log.
progress_supported() {
	[ -t 2 ] && [ -z "${EVA_INSTALL_NO_PROGRESS:-}" ]
}

# progress_stop shows the cursor again, and writes nothing where no bar hid it.
#
# The trap calls this on every exit, including the paths that never draw. An
# unconditional escape here put six bytes on the stderr of every piped run,
# which is the thing progress_supported exists to prevent.
progress_stop() {
	if progress_supported; then
		printf '\033[?25h' >&2
	fi
	return 0
}

# progress_delay is the smallest interval this sleep accepts.
#
# POSIX sleep takes whole seconds. Nearly every sleep this will meet accepts a
# fraction, and the one that does not gets a bar that steps once a second rather
# than an error inside the loop.
progress_delay() {
	if sleep 0.1 2>/dev/null; then printf '0.1'; else printf '1'; fi
}

# progress_draw <bytes> <total>
#
# The filled part is appended to and never rebuilt, because the bar only grows.
# That keeps the whole of the drawing inside the shell: the one process a frame
# costs is the one that read the size.
#
# The arithmetic is in kibibytes. Bytes times a hundred overflows a 32-bit shell
# at 21 MB, and an archive will reach that.
progress_draw() {
	total_kb=$(($2 / 1024))
	[ "$total_kb" -gt 0 ] || total_kb=1
	pct=$((($1 / 1024) * 100 / total_kb))
	[ "$pct" -gt 100 ] && pct=100
	on=$((pct * PROGRESS_WIDTH / 100))

	while [ "$drawn" -lt "$on" ]; do
		filled="$filled#"
		drawn=$((drawn + 1))
	done

	empty=''
	n=$drawn
	while [ "$n" -lt "$PROGRESS_WIDTH" ]; do
		empty="$empty."
		n=$((n + 1))
	done

	printf '\r%s%s %3d%%' "$filled" "$empty" "$pct" >&2
}

# progress_watch <path> <total> <pid>
#
# It stops when the file is whole, and when the process writing it is gone. The
# first of those is what makes it stop on every shell: a child that has exited
# and has not been reaped still answers kill -0.
#
# The last frame draws the size the file reached. A download that failed at 43%
# says 43%, because a bar that ends at 100% over a failure is a bar that lies.
progress_watch() {
	filled=''
	drawn=0
	delay=$(progress_delay)

	printf '\033[?25l' >&2
	while kill -0 "$3" 2>/dev/null; do
		size=$(wc -c <"$1" 2>/dev/null || echo 0)
		progress_draw "$size" "$2"
		[ "$size" -ge "$2" ] && break
		sleep "$delay"
	done

	size=$(wc -c <"$1" 2>/dev/null || echo 0)
	progress_draw "$size" "$2"
	printf '\033[?25h\n' >&2
}

# download_with_progress <url> <path> <expected bytes>
#
# The plain fetch when there is no terminal, and when the size is unknown. A bar
# with a guessed denominator is worse than no bar.
download_with_progress() {
	if ! progress_supported || [ "${3:-0}" -le 0 ]; then
		fetch_to "$1" "$2"
		return $?
	fi

	: >"$2"
	fetch_to "$1" "$2" &
	dl_pid=$!
	progress_watch "$2" "$3" "$dl_pid"
	wait "$dl_pid"
}

# The second seam.
#
# have_cosign      reports whether a signature can be checked at all
# cosign_verify    checks one, and reports whether it held
#
# Functions for the reason fetch is: a test can neither install cosign nor mint
# a sigstore bundle, so it replaces the verdict and asserts what this script
# does with it.
have_cosign() { command -v cosign >/dev/null 2>&1; }

# cosign_verify <bundle> <subject> <identity regexp> <issuer>
#
# The identity and the issuer are given rather than looked up here. A keyless
# signature with no expected identity says only that somebody signed this, so a
# verification that pins neither is not a verification.
#
# Output is discarded and the exit status is the whole answer. The caller says
# something better than cosign does, in both directions.
cosign_verify() {
	cosign verify-blob "$2" \
		--bundle "$1" \
		--certificate-identity-regexp "$3" \
		--certificate-oidc-issuer "$4" \
		>/dev/null 2>&1
}

# Verification.
#
# regexp_escape makes a literal string safe to put in a regexp.
#
# Everything but a letter, a digit, an underscore, a slash, or a hyphen. GitHub
# allows a dot in a repository name, and an unescaped dot matches any character
# — so `evilXcom/eva` would satisfy an identity built for `evil.com/eva`.
regexp_escape() { printf '%s' "$1" | sed 's/[^A-Za-z0-9/_-]/\\&/g'; }

# signer_identity is the identity a release's signing certificate must carry.
#
# It is the workflow, in this repository, running on a tag — which is read off a
# published certificate rather than guessed at:
#
#   URI:https://github.com/missingstudio/eva/.github/workflows/release.yml@refs/tags/v0.1.1
#
# Anchored at the front, and open at the end because the tag is what changes.
# Pinning the workflow as well as the repository makes this a statement about
# the release path rather than about the account.
signer_identity() {
	printf '^https://github\.com/%s/\.github/workflows/release\.yml@refs/tags/' \
		"$(regexp_escape "$REPO")"
}

# unverified reports a signature that could not be checked, and stops when the
# caller said it must be.
#
# The second line is the point of the first. "cosign is not installed" is a fact
# about a machine; what a person needs is what that leaves unproven. It goes to
# stderr because it is not the result of the install.
unverified() {
	if [ "$REQUIRE_SIG" = "1" ]; then
		die "$1
--require-signature was given, so nothing was installed."
	fi
	echo "warning: $1" >&2
	echo "         the checksum proves the download is intact, not that the release is Eva's" >&2
	echo "         install cosign, or pass --require-signature, to check that too" >&2
}

# verify_signature <subject> <bundle>
#
# A signature that does not hold installs nothing, whatever the flags say. A
# signature that cannot be checked is the degradation above.
verify_signature() {
	if [ ! -f "$2" ]; then
		unverified "this build publishes no signature for ${1##*/}"
		return 0
	fi
	if ! have_cosign; then
		unverified "cosign is not installed, so the signature was not checked"
		return 0
	fi

	identity=$(signer_identity)
	if ! cosign_verify "$2" "$1" "$identity" "$SIG_ISSUER"; then
		# Two things fail here and cosign reports one status for both: the file
		# changed after it was signed, or it was signed by somebody else. Which one
		# is in cosign's own prose, and this does not parse a dependency's prose to
		# find out — so the message names both causes and neither is guessed at.
		die "the signature on ${1##*/} did not verify
  expected identity: $identity
  expected issuer:   $SIG_ISSUER
Either the file was changed after it was signed, or it was not signed by this
repository's release workflow. Nothing was installed, and this is not a case to
retry: check it by hand before trusting these bytes.
  https://github.com/$REPO/blob/main/docs/how-to/install-eva.md#verify-what-you-downloaded"
	fi
	echo "signature ok — ${1##*/} was signed by $REPO's release workflow"
}

# checksum_of <file> writes the file's SHA-256 to stdout.
checksum_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d' ' -f1
	else
		die "neither sha256sum nor shasum is installed, so the archive cannot be verified"
	fi
}

# published_checksum <checksums.txt> <archive name>
published_checksum() {
	sed -n "s/^\\([0-9a-f]\\{64\\}\\)[[:space:]]*\\*\\{0,1\\}$2\$/\\1/p" "$1" | head -n 1
}

# verify_archive <archive path> <checksums.txt> <archive name>
#
# Nothing is installed before its checksum matches. A download that cannot be
# checked is a download that is thrown away.
#
# This establishes that the archive is the one checksums.txt names. Whether
# checksums.txt is Eva's own is the signature's question, asked before this.
verify_archive() {
	sum=$(checksum_of "$1")
	want=$(published_checksum "$2" "$3")
	[ -n "$want" ] || die "checksums.txt names no entry for $3"

	if [ "$sum" != "$want" ]; then
		die "the checksum does not match
  archive:  $sum
  published: $want
Nothing was installed."
	fi
	echo "checksum ok"
}

# Installing.
#
# unpack_and_install <archive path> <workdir> <destination dir>
unpack_and_install() {
	tar -xzf "$1" -C "$2"
	[ -f "$2/eva" ] || die "the archive holds no eva binary"

	mkdir -p "$3"
	# A move across filesystems is a copy, and mv handles that. install(1) is
	# not on every machine.
	mv "$2/eva" "$3/eva"
	chmod 0755 "$3/eva"
	echo "installed $3/eva"
}

report_path() {
	case ":$PATH:" in
	*":$1:"*) ;;
	*) echo "
$1 is not on your PATH. Add it:
  export PATH=\"$1:\$PATH\"" ;;
	esac
}

report_quarantine() {
	if [ "$1" = "darwin" ]; then
		echo "
macOS may refuse an unsigned binary that was downloaded. If it does:
  xattr -d com.apple.quarantine \"$2/eva\"
Notarized builds are not published yet."
	fi
}

# Main.
install_main() {
	CHANNEL="stable"
	VERSION=""
	DIR="${EVA_INSTALL_DIR:-$HOME/.local/bin}"
	FROM_DIST=""
	FORCE=""

	while [ $# -gt 0 ]; do
		case "$1" in
		--channel)
			[ $# -ge 2 ] || die "--channel needs a name"
			CHANNEL="$2"
			shift 2
			;;
		--version)
			[ $# -ge 2 ] || die "--version needs a number"
			VERSION="${2#v}"
			shift 2
			;;
		--dir)
			[ $# -ge 2 ] || die "--dir needs a path"
			DIR="$2"
			shift 2
			;;
		--force)
			FORCE="1"
			shift
			;;
		--from-dist)
			[ $# -ge 2 ] || die "--from-dist needs a directory"
			FROM_DIST="$2"
			shift 2
			;;
		--require-signature)
			REQUIRE_SIG=1
			shift
			;;
		--help | -h)
			usage
			exit 0
			;;
		*) die "unknown option $1 (try --help)" ;;
		esac
	done

	case "$CHANNEL" in
	stable | next) ;;
	*) die "unknown channel $CHANNEL: it is stable or next" ;;
	esac

	os=$(detect_os) ||
		die "no release is built for $(uname -s); use \`go install github.com/$REPO/cmd/eva@latest\`"
	arch=$(detect_arch) || die "no release is built for $(uname -m)"

	tmp=$(mktemp -d)
	# shellcheck disable=SC2064 # tmp is expanded now on purpose: it cannot change.
	trap "rm -rf '$tmp'; progress_stop" EXIT INT TERM

	# A local snapshot build, reaching no network. Everything past this point
	# is the same for a release and for a rehearsal.
	if [ -n "$FROM_DIST" ]; then
		[ -d "$FROM_DIST" ] || die "$FROM_DIST is not a directory"
		[ -n "$VERSION" ] || VERSION=$(dist_version "$FROM_DIST") ||
			die "cannot tell what version $FROM_DIST holds"

		archive=$(archive_name "$VERSION" "$os" "$arch")
		[ -f "$FROM_DIST/$archive" ] ||
			die "$FROM_DIST holds no $archive
The archive names this script derives and the ones the build wrote disagree."

		if [ -z "$FORCE" ] && [ "$(installed_version "$DIR/eva")" = "$VERSION" ]; then
			report_installed "$VERSION" "$DIR"
			return 0
		fi
		echo "installing eva $VERSION ($os/$arch) from $FROM_DIST"

		cp "$FROM_DIST/$archive" "$tmp/$archive"
		[ -f "$FROM_DIST/checksums.txt" ] ||
			die "$FROM_DIST has no checksums.txt, so nothing can be verified"

		# A snapshot is unsigned, and this says so rather than passing over it. The
		# rehearsal is the caller that sees this line every time, which is correct:
		# what it is rehearsing is the path, and the signature is the one step of it
		# that a tag has and a laptop does not.
		verify_signature "$FROM_DIST/checksums.txt" "$FROM_DIST/checksums.txt.sigstore.json"
		verify_archive "$tmp/$archive" "$FROM_DIST/checksums.txt" "$archive"

		unpack_and_install "$tmp/$archive" "$tmp" "$DIR"
		report_path "$DIR"
		echo "
Check it:
  $DIR/eva version"
		return 0
	fi

	install_choose_fetch

	# One document, whichever path asked for it. It carries the tag, and it
	# carries the size the bar counts to.
	release="$tmp/release.json"
	release_doc "$CHANNEL" "$VERSION" "$release"
	tag=$(release_tag <"$release")
	[ -n "$tag" ] || die "the release document names no tag"
	VERSION="${tag#v}"

	archive=$(archive_name "$VERSION" "$os" "$arch")
	base="https://github.com/$REPO/releases/download/v${VERSION}"

	# The work this install does not have to do. It is asked after the version is
	# known and before anything is downloaded.
	if [ -z "$FORCE" ] && [ "$(installed_version "$DIR/eva")" = "$VERSION" ]; then
		report_installed "$VERSION" "$DIR"
		return 0
	fi

	echo "installing eva $VERSION ($os/$arch) from the $CHANNEL channel"

	# The two small files ride inside the archive's transfer, so their connection
	# cost disappears into it. The seam stays one URL at a time, which a curl
	# given both URLs would not be, and which wget could not serve.
	#
	# The bundle is optional, so a release published before signing began still
	# installs — on the checksum alone, and saying so. The file is removed on a
	# failed fetch because curl and wget both leave one behind, and an empty file
	# would reach cosign as a bundle rather than as an absence.
	bundle="$tmp/checksums.txt.sigstore.json"
	fetch_to "$base/checksums.txt" "$tmp/checksums.txt" &
	sums_pid=$!
	fetch_to "$base/checksums.txt.sigstore.json" "$bundle" &
	bundle_pid=$!

	size=$(asset_size "$archive" <"$release")
	download_with_progress "$base/$archive" "$tmp/$archive" "${size:-0}" ||
		die "no archive at $base/$archive
Check the version, or the release page: https://github.com/$REPO/releases"

	wait "$sums_pid" ||
		die "the release has no checksums.txt, so nothing can be verified"
	wait "$bundle_pid" || rm -f "$bundle"

	# The signature first, because it is what makes the checksums Eva's. Checking
	# the archive against a file of unknown origin and then asking where the file
	# came from would be doing the two in the order that proves the least.
	verify_signature "$tmp/checksums.txt" "$bundle"
	verify_archive "$tmp/$archive" "$tmp/checksums.txt" "$archive"
	unpack_and_install "$tmp/$archive" "$tmp" "$DIR"

	report_path "$DIR"
	report_quarantine "$os" "$DIR"

	echo "
Check it:
  $DIR/eva version"
}

# dist_version <dir> reads the version a snapshot build stamped into its
# metadata, so the rehearsal does not have to be told what it just built.
dist_version() {
	[ -f "$1/metadata.json" ] || return 1
	v=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/metadata.json" | head -n 1)
	[ -n "$v" ] || return 1
	printf '%s' "$v"
}

[ "${EVA_INSTALL_LIB:-}" = "1" ] || install_main "$@"
