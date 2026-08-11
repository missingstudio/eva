#!/bin/sh
#
# The Makefile declares what is checked; the workflows run it. This asserts
# every declared target is invoked by a workflow that a push or a pull request
# actually reaches.
#
# The duplication is deliberate: two lists exist so that a difference between
# them is detectable, and this fails closed. A target added to the Makefile and
# to no job stops the build, which is the direction worth failing in. The other
# way round — an extra `make eva` in the release workflow — is harmless.
#
# "Reachable" is the part that used to be missing. Coverage was read out of
# every workflow file, so a target invoked only from a workflow_dispatch job, or
# from audit-report.yml, counted as covered while no push ever ran it. A
# workflow is counted here only when its own `on:` block names push or
# pull_request.
set -eu

cd "$(dirname "$0")/.."

MAKE="${MAKE:-make}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

"$MAKE" check-list | sort -u >"$work/declared"

# A workflow that a commit on a branch reaches: its `on:` block names
# pull_request, or a push with branches.
#
# `push:` alone is not enough, and release.yml is why. Its only trigger is
# `push: tags:`, so a check invoked there and nowhere else runs on no pull
# request and no merge — which is precisely the coverage this is asserting is
# real. The `on:` block ends at the next key in column one, so a `branches:`
# belonging to some job cannot be mistaken for a trigger.
reaches_a_commit() {
	on_block=$(awk '
		/^on:/                    { in_on = 1; next }
		in_on && /^[^[:space:]#]/ { in_on = 0 }
		in_on                     { print }
	' "$1")

	printf '%s\n' "$on_block" | grep -qE '^[[:space:]]+pull_request:' && return 0
	printf '%s\n' "$on_block" | grep -qE '^[[:space:]]+branches:' && return 0
	return 1
}

: >"$work/invoked"
counted=""
for wf in .github/workflows/*.yml; do
	[ -f "$wf" ] || continue
	if ! reaches_a_commit "$wf"; then
		echo "not counted (no push or pull_request trigger): $wf"
		continue
	fi
	counted="$counted ${wf##*/}"

	# Only lines whose first token is `make`, or a `- run: make`. A shell
	# comment mentioning a target begins with #, so it cannot satisfy this.
	grep -hE '^[[:space:]]*(- run: )?make [a-z]' "$wf" |
		sed -E 's/^[[:space:]]*(- run: )?make //' |
		awk '{ print $1 }' >>"$work/invoked"
done
sort -u "$work/invoked" -o "$work/invoked"

echo "counted:$counted"
echo "declared by the Makefile:"
sed 's/^/  /' "$work/declared"
echo "invoked by a workflow a commit reaches:"
sed 's/^/  /' "$work/invoked"

missing=$(comm -23 "$work/declared" "$work/invoked")
if [ -n "$missing" ]; then
	echo "these checks are declared and no workflow a commit reaches runs them:" >&2
	printf '  %s\n' "$missing" >&2
	exit 1
fi
echo "coverage ok — $(wc -l <"$work/declared" | tr -d ' ') declared checks, all covered"
