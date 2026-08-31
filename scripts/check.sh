#!/bin/bash
set -euo pipefail

# Check if in git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Not in a git repository" >&2
  exit 1
fi

# Parse arguments
STAGED_MODE=false
SKIP_TESTS=false
for arg in "$@"; do
  if [ "$arg" = "--staged" ]; then
    STAGED_MODE=true
  elif [ "$arg" = "--skip-tests" ]; then
    SKIP_TESTS=true
  fi
done

# Create temp directory for capturing outputs
TMPDIR=$(mktemp -d) || { echo "Failed to create temp dir" >&2; exit 1; }
trap 'rm -rf "$TMPDIR"' EXIT

# Per-check output outlives the run, in reports/ (gitignored).
#
# It used to live in $TMPDIR and die with the trap above, which meant the only
# copy of a failure was whatever scrolled past on stdout. Wanting a different
# slice of it — more context, a different grep — meant running the check again,
# and for `test` that is a multi-minute round trip to re-read bytes this script
# already paid for. Cleared at the start rather than deleted at the end so the
# newest run's output is what is on disk, with nothing stale beside it.
CHECKS_REPORT_DIR="reports/checks"
rm -rf "$CHECKS_REPORT_DIR"
mkdir -p "$CHECKS_REPORT_DIR" || { echo "Failed to create $CHECKS_REPORT_DIR" >&2; exit 1; }

# Sanitize check names for safe temp filenames (replace : with _)
safe_name() { echo "${1//:/_}"; }

is_license_header_file() {
  local file="$1"
  case "$file" in
    tests/scripts/behavior-audit/fixtures/grep-sample/*) return 1 ;;
    *.md)
      case "$file" in
        docs/*.md) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    src/*|client/*|scripts/*|review-loop/src/*|opencode-agent/src/*|tests/*|drizzle.config.ts)
      case "$file" in
        *.ts|*.tsx|*.js|*.jsx) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

is_oxlint_scoped_file() {
  local file="$1"
  case "$file" in
    src/*|client/*|scripts/*|review-loop/src/*|opencode-agent/src/*|tests/*|drizzle.config.ts)
      case "$file" in
        *.ts|*.tsx|*.js|*.jsx) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

run_license_header_check() {
  local output_file="$1"
  shift
  local missing_headers=()
  local file

  for file in "$@"; do
    # Skip files that no longer exist on disk (e.g. tracked but deleted in worktree).
    [ -f "$file" ] || continue
    case "$file" in
      *.md)
        if ! awk 'NR <= 2 && /^<!--$/ { found=1 } NR >= 2 && NR <= 3 && /SPDX-License-Identifier: BUSL-1\.1/ { found=1 } END { exit found ? 0 : 1 }' "$file" 2>/dev/null; then
          missing_headers+=("$file")
        fi
        ;;
      *)
        if ! awk 'NR <= 5 && /^\/\/ SPDX-License-Identifier: BUSL-1\.1$/ { found=1 } END { exit found ? 0 : 1 }' "$file" 2>/dev/null; then
          missing_headers+=("$file")
        fi
        ;;
    esac
  done

  if [ ${#missing_headers[@]} -gt 0 ]; then
    {
      echo "Missing BUSL-1.1 license header in file(s):"
      local f
      for f in "${missing_headers[@]}"; do
        echo "  $f"
      done
      printf '\nAdd this header to the top of each file:\n'
      printf '  // SPDX-License-Identifier: BUSL-1.1\n'
      printf '  // Copyright (c) 2026 Dmitriy Lazarev\n'
      printf '  // Use of this software is governed by the Business Source License 1.1.\n'
      printf '  // See LICENSE in the project root for details.\n'
      printf '\nFor .md files, use this HTML-comment style header:\n'
      printf '  <!--\n'
      printf '  SPDX-License-Identifier: BUSL-1.1\n'
      printf '  Copyright (c) 2026 Dmitriy Lazarev\n'
      printf '  Use of this software is governed by the Business Source License 1.1.\n'
      printf '  See LICENSE in the project root for details.\n'
      printf '  -->\n'
      printf '\nOr run: bun license:headers\n'
    } >"$output_file"
    return 1
  fi

  printf '%s\n' 'ℹ All checked code and docs files have license headers' >"$output_file"
}

if [ "$STAGED_MODE" = true ]; then
  # Get staged files into array
  staged_files=()
  while IFS= read -r file; do
    [ -n "$file" ] && staged_files+=("$file")
  done < <(git diff --staged --name-only --diff-filter=ACM 2>/dev/null || true)

  # Build arrays of staged files relevant to each checker
  relevant_files=()
  lintable_files=()
  for file in "${staged_files[@]+${staged_files[@]}}"; do
    [ -z "$file" ] && continue
    case "$file" in
      *.ts|*.tsx|*.js|*.jsx|*.json|*.md)
        relevant_files+=("$file")
        ;;
    esac
    case "$file" in
      *.ts|*.tsx|*.js|*.jsx)
        if is_oxlint_scoped_file "$file"; then
          lintable_files+=("$file")
        fi
        ;;
    esac
  done

  # Build array of staged code files requiring license headers.
  header_checked_files=()
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if is_license_header_file "$file"; then
      header_checked_files+=("$file")
    fi
  done < <(git diff --staged --name-only --diff-filter=ACM 2>/dev/null || true)

  # Check if array is empty
  if [ ${#relevant_files[@]} -eq 0 ]; then
    echo "ℹ No relevant staged files to check"
    exit 0
  fi

  echo "ℹ Checking staged files: ${relevant_files[*]}"

  # Run only lint, typecheck, format on staged files
  checks=("lint" "typecheck" "format:check" "license-headers")
  failed=0

  # Filter out files matching .oxlintignore patterns (oxlint ignores --ignore-path
  # when explicit file paths are passed, so we apply the patterns ourselves).
  filtered_lintable_files=()
  if [ ${#lintable_files[@]} -gt 0 ] && [ -f .oxlintignore ]; then
    for file in "${lintable_files[@]}"; do
      keep=true
      while IFS= read -r pattern; do
        # Skip blank lines and comments
        [ -z "$pattern" ] && continue
        case "$pattern" in
          \#*) continue ;;
        esac
        case "$file" in
          ${pattern}*) keep=false; break ;;
        esac
      done < .oxlintignore
      if $keep; then
        filtered_lintable_files+=("$file")
      fi
    done
  else
    filtered_lintable_files=("${lintable_files[@]+${lintable_files[@]}}")
  fi

  # Run lint only on staged files oxlint actually supports
  (
    exit_code=0
    if [ ${#filtered_lintable_files[@]} -eq 0 ]; then
      printf '%s\n' 'ℹ No lintable staged files for oxlint' >"$TMPDIR/lint.out"
    else
      bunx oxlint --config .oxlintrc.json "${filtered_lintable_files[@]}" >"$TMPDIR/lint.out" 2>&1 || exit_code=$?
    fi
    echo "$exit_code" >"$TMPDIR/lint.exit"
  ) &
  lint_pid=$!

  # Run typecheck (project-wide, but fast)
  (
    exit_code=0
    bun run typecheck >"$TMPDIR/typecheck.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/typecheck.exit"
  ) &
  typecheck_pid=$!

  # Run format:check on staged files
  (
    exit_code=0
    format_checked_files=()
    for file in "${relevant_files[@]}"; do
      keep=true
      case "$file" in
        package-lock.json|*/package-lock.json) keep=false ;;
      esac
      # This sweep has to reach the same verdict oxfmt will, because the two
      # disagreeing is not a mismatched warning — it is a failed commit. oxfmt
      # exits 2 with "Expected at least one target file" when everything handed
      # to it is ignored, so a staged set this loop thinks is formattable and
      # oxfmt thinks is empty reports a formatting failure that does not exist.
      # That was every commit touching only `opencode-agent/docs/`: the patterns
      # were matched anchored at the start of the path, so `docs/` caught
      # `docs/a.md` and missed `opencode-agent/docs/a.md`, while oxfmt read the
      # same pattern out of the same file and dropped it.
      #
      # So match them the way a `.gitignore` is read, which is what oxfmt does.
      # A pattern with an internal slash (`client/assets/`, `.opencode/package.json`)
      # is anchored to the repository root; one without (`docs/`, `CHANGELOG.md`)
      # matches at any depth. Only these two forms appear in `.oxfmtignore`; a
      # pattern needing globs or negation would need this to grow with it.
      if $keep && [ -f .oxfmtignore ]; then
        while IFS= read -r pattern; do
          [ -z "$pattern" ] && continue
          case "$pattern" in
            \#*) continue ;;
          esac
          case "${pattern%/}" in
            */*) anchored=true ;;
            *) anchored=false ;;
          esac
          case "$file" in
            ${pattern}*) keep=false; break ;;
          esac
          if ! $anchored; then
            case "$file" in
              */${pattern}*) keep=false; break ;;
            esac
          fi
        done < .oxfmtignore
      fi
      if $keep; then
        format_checked_files+=("$file")
      fi
    done

    if [ ${#format_checked_files[@]} -eq 0 ]; then
      printf '%s\n' 'ℹ No format-checkable staged files for oxfmt' >"$TMPDIR/format_check.out"
    else
      bunx oxfmt --check --ignore-path=.oxfmtignore "${format_checked_files[@]}" >"$TMPDIR/format_check.out" 2>&1 || exit_code=$?
    fi
    echo "$exit_code" >"$TMPDIR/format_check.exit"
  ) &
  format_pid=$!

  # Check license headers in newly added source files
  (
    exit_code=0
    run_license_header_check "$TMPDIR/license-headers.out" "${header_checked_files[@]+${header_checked_files[@]}}" || exit_code=$?
    echo "$exit_code" >"$TMPDIR/license-headers.exit"
  ) &
  license_headers_pid=$!

  # Wait for all background jobs (|| true prevents set -e from aborting on failure)
  wait "$lint_pid" || true
  wait "$typecheck_pid" || true
  wait "$format_pid" || true
  wait "$license_headers_pid" || true

  # Check results and display failures
  failed_checks=()
  passed_checks=()
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    if [ ! -f "$TMPDIR/$fname.exit" ]; then
      failed=$((failed + 1))
      failed_checks+=("$check")
      echo ""
      echo "✗ $check failed (no exit file found)"
      continue
    fi
    exit_code=$(cat "$TMPDIR/$fname.exit")
    if [ "$exit_code" -ne 0 ]; then
      failed=$((failed + 1))
      failed_checks+=("$check")
      echo ""
      echo "✗ $check failed (exit code $exit_code):"
      echo "---"
      cat "$TMPDIR/$fname.out"
      echo "---"
    else
      passed_checks+=("$check")
    fi
  done

  # Print summary
  total=${#checks[@]}
  passed=$((total - failed))
  echo ""
  echo "Summary of executed checks:"
  for check in "${passed_checks[@]+${passed_checks[@]}}"; do
    echo "✓ $check"
  done
  for check in "${failed_checks[@]+${failed_checks[@]}}"; do
    echo "✗ $check"
  done
  echo ""
  echo "$passed/$total checks passed, $failed failed"
  if [ "$failed" -eq 0 ]; then
    exit 0
  else
    exit 1
  fi
else
  # Original behavior: run all checks. Workspace code (review-loop/, mutation-improve/,
  # sdd-runner/, opencode-agent/) is enforced by these root checks alone: root lint
  # (whose tsgolint type-check pass reports every tsgo diagnostic class — see
  # openspec/changes/dedupe-lint-typecheck), format:check walk the workspace dirs,
  # and the default test sweep runs tests/<workspace>/. Per-workspace proxy scripts
  # stay local-only conveniences.
  # test:hooks needs its own leg because .hooks/ is a dot-directory: bun's default discovery
  # never reaches it, so the lane rides in the default `test` sweep for exactly zero files. It
  # went unrun long enough for the TypeScript 7 upgrade to leave enforceWritePolicy failing open
  # for four days (openspec/changes/fix-write-policy-suppression-guard). 185 tests, ~1.3s.
  checks=("lint" "format:check" "license-headers" "knip" "test" "test:hooks" "test:client" "duplicates")
  if [ "$SKIP_TESTS" = true ]; then
    filtered_checks=()
    for check in "${checks[@]}"; do
      # test:hooks deliberately survives --skip-tests. The flag exists to skip the multi-minute
      # suite; this lane is ~1.3s and guards write-time policy, so skipping it buys nothing and
      # costs the one check that catches hook rot.
      case "$check" in
        test|test:client)
          continue
          ;;
      esac
      filtered_checks+=("$check")
    done
    checks=("${filtered_checks[@]}")
  fi

  # Build client bundles before the parallel fan-out when the `test` check is
  # active and the bundles are missing. The `tests/debug/` suites fail fast in
  # beforeAll without them. The guard script no-ops when bundles already exist
  # (repeat local runs, and CI where public/ arrives as a downloaded artifact),
  # so this is cheap except on the first bundle-less run.
  for check in "${checks[@]}"; do
    if [ "$check" = "test" ]; then
      bun scripts/ensure-client-built.ts || exit 1
      break
    fi
  done

  failed=0
  pids=()

  # Run all checks in parallel
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    (
      exit_code=0
      if [ "$check" = "license-headers" ]; then
        header_checked_files=()
        # --cached --others --exclude-standard: tracked files PLUS untracked
        # (not gitignored) ones. A consumer's gate may run full mode on a
        # worktree containing brand-new, never-added files (agent-authored
        # docs/tests); tracked-only enumeration would miss them here and let
        # the pre-commit hook's --staged mode reject them later at git commit.
        while IFS= read -r file; do
          [ -n "$file" ] || continue
          [ -f "$file" ] || continue
          if is_license_header_file "$file"; then
            header_checked_files+=("$file")
          fi
        done < <(git ls-files --cached --others --exclude-standard 2>/dev/null || true)
        run_license_header_check "$CHECKS_REPORT_DIR/$fname.log" "${header_checked_files[@]+${header_checked_files[@]}}" || exit_code=$?
      elif [ "$check" = "test" ]; then
        # CI runners (4 vCPU, all checks already running concurrently) get
        # destabilized by worker-per-file --parallel: the VM is OOM-killed and
        # the runner shuts down mid-job. Run the suite serially there.
        # --timeout 15000 re-applies the per-test ceiling documented in
        # bunfig.toml: bun (verified through 1.4.0) silently ignores [test]
        # timeout, so without this flag every test falls back to the 5000ms default and git-heavy
        # integration tests (e.g. review-loop worktree tests) time out under
        # --parallel worker contention.
        if [ "${CI:-}" = "true" ]; then
          bun test --coverage --timeout 15000 >"$CHECKS_REPORT_DIR/$fname.log" 2>&1 || exit_code=$?
          # The coverage floor is enforced HERE, not by bun. bun's
          # `coverageThreshold` is a per-file rule, so it cannot express an
          # aggregate floor, and it fails silently (no text naming coverage as
          # the cause). coverage:ratchet reads the lcov this run just wrote,
          # compares the aggregate against the floor in bunfig-adjacent config,
          # and prints `measured` vs `floor`. Only run it when the suite itself
          # passed: a test failure is its own diagnostic, and a partial run's
          # lcov would report a meaningless number.
          if [ "$exit_code" -eq 0 ]; then
            bun coverage:ratchet >>"$CHECKS_REPORT_DIR/$fname.log" 2>&1 || exit_code=$?
          fi
        else
          # Through the wrapper, not `bun test` directly, so a check:full run
          # leaves the same reports/test/ artifact a direct run does and the
          # failures are queryable with `bun run test:failures` afterwards. The
          # CI branch above keeps its own invocation: the coverage lane owns the
          # ratchet and must not be rerouted.
          bun run test >"$CHECKS_REPORT_DIR/$fname.log" 2>&1 || exit_code=$?
        fi
        # NOT gated here yet: `bun run analytics:privacy-contract` reads the
        # report's per-file records, and those cannot currently be trusted.
        # Bun's junit reporter collides on basename — two test files with the
        # same basename in different directories collapse to one `file=`
        # attribute, so 53 of 1306 files in a full run have no record at all
        # even though every one of their tests ran and passed. Wiring the gate
        # on that input blocks a green release, which is worse than the nested
        # runs it replaced. The command and its tests ship; the check.sh gate
        # waits on per-file accounting the report can stand behind.
      elif [ "$check" = "test:client" ]; then
        bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/ >"$CHECKS_REPORT_DIR/$fname.log" 2>&1 || exit_code=$?
      else
        bun run "$check" >"$CHECKS_REPORT_DIR/$fname.log" 2>&1 || exit_code=$?
      fi
      echo "$exit_code" >"$TMPDIR/$fname.exit"
    ) &
    pids+=($!)
  done

  # Wait for all background jobs (|| true prevents set -e from aborting on failure)
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done

  # Check results and display failures
  failed_checks=()
  passed_checks=()
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    if [ ! -f "$TMPDIR/$fname.exit" ]; then
      failed=$((failed + 1))
      failed_checks+=("$check")
      echo ""
      echo "✗ $check failed (no exit file found)"
      continue
    fi
    exit_code=$(cat "$TMPDIR/$fname.exit")
    if [ "$exit_code" -ne 0 ]; then
      failed=$((failed + 1))
      failed_checks+=("$check")
      echo ""
      echo "✗ $check failed (exit code $exit_code):"
      echo "---"
      cat "$CHECKS_REPORT_DIR/$fname.log"
      echo "---"
      # Where to look, rather than what to run again. The output above is the
      # whole of it, but a terminal scroll-back is not a place you can query.
      case "$check" in
        test|test:client)
          echo "→ bun run test:failures      (report already on disk; do not re-run to look)"
          ;;
        *)
          echo "→ $CHECKS_REPORT_DIR/$fname.log"
          ;;
      esac
    else
      passed_checks+=("$check")
    fi
  done

  # Print summary
  total=${#checks[@]}
  passed=$((total - failed))
  echo ""
  echo "Summary of executed checks:"
  for check in "${passed_checks[@]+${passed_checks[@]}}"; do
    echo "✓ $check"
  done
  for check in "${failed_checks[@]+${failed_checks[@]}}"; do
    echo "✗ $check"
  done
  echo ""
  echo "$passed/$total checks passed, $failed failed"
  if [ "$failed" -eq 0 ]; then
    exit 0
  else
    exit 1
  fi
fi
