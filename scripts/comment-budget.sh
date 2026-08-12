#!/bin/sh
#
# A comment carries a decision or it goes. This holds the shape of that rule,
# and review holds the rest. Six lines names an invariant, a trap, or a rejected
# alternative; it does not argue for one, and an argument belongs in docs/.
#
# A run of lines beginning with // is counted, which over-counts a file that
# embeds Go source in a raw string. The error is always upward, so this fails in
# the safe direction and can never miss a long block.
set -eu

cd "$(dirname "$0")/.."

CAP="${CAP:-6}"
RATIO="${RATIO:-15}"

files=$(git ls-files '*.go')
[ -n "$files" ] || {
	echo "comment-budget: no Go files were read" >&2
	exit 1
}

# shellcheck disable=SC2086
awk -v cap="$CAP" -v ratio="$RATIO" '
	FNR == 1 { run = 0; start = 0; skip = 0 }

	{ lines++ }

	/^[[:space:]]*\/\// {
		# A directive is read by the compiler or the linter, not by a person.
		if (run == 0 && $0 ~ /^[[:space:]]*\/\/(go:|nolint|lint:)/) { skip = 1 }
		if (run == 0) { start = FNR }
		run++
		if (!skip) comments++
		next
	}

	{ close_run() }

	END {
		close_run()
		if (lines == 0) { print "comment-budget: read no lines" > "/dev/stderr"; exit 1 }

		share = 100 * comments / lines
		printf "comment-budget: %d of %d lines (%.1f%%), longest block %d\n",
			comments, lines, share, longest

		if (over > 0) {
			printf "comment-budget: %d block(s) over %d lines\n", over, cap > "/dev/stderr"
			bad = 1
		}
		if (share > ratio + 0.05) {
			printf "comment-budget: %.1f%% is over the %d%% budget\n", share, ratio > "/dev/stderr"
			bad = 1
		}
		exit bad
	}

	function close_run() {
		if (run > longest && !skip) longest = run
		if (run > cap && !skip) {
			printf "%s:%d: a comment block of %d lines, over the cap of %d\n",
				FILENAME, start, run, cap > "/dev/stderr"
			over++
		}
		run = 0
		skip = 0
	}
' $files
