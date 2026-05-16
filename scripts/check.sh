#!/bin/bash
set -euo pipefail

# Check if in git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Not in a git repository" >&2
  exit 1
fi

# Parse arguments
STAGED_MODE=false
for arg in "$@"; do
  if [ "$arg" = "--staged" ]; then
    STAGED_MODE=true
  fi
done

# Create temp directory for capturing outputs
TMPDIR=$(mktemp -d) || { echo "Failed to create temp dir" >&2; exit 1; }
trap 'rm -rf "$TMPDIR"' EXIT

# Sanitize check names for safe temp filenames (replace : with _)
safe_name() { echo "${1//:/_}"; }

is_license_header_file() {
  local file="$1"
  case "$file" in
    src/*|client/*|scripts/*|review-loop/src/*|tests/*|drizzle.config.ts) ;;
    *) return 1 ;;
  esac
  case "$file" in
    *.ts|*.tsx|*.js|*.jsx) return 0 ;;
    *) return 1 ;;
  esac
}

run_license_header_check() {
  local output_file="$1"
  shift
  local missing_headers=()
  local file

  for file in "$@"; do
    if ! awk 'NR <= 5 && /^\/\/ SPDX-License-Identifier: BUSL-1\.1$/ { found=1 } END { exit found ? 0 : 1 }' "$file" 2>/dev/null; then
      missing_headers+=("$file")
    fi
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
      printf '\nOr run: bun license:headers\n'
    } >"$output_file"
    return 1
  fi

  printf '%s\n' 'ℹ All checked code files have license headers' >"$output_file"
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
        lintable_files+=("$file")
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
    bunx oxfmt --check --ignore-path=.oxfmtignore "${relevant_files[@]}" >"$TMPDIR/format_check.out" 2>&1 || exit_code=$?
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
  # Original behavior: run all checks
  checks=("lint" "typecheck" "format:check" "license-headers" "knip" "test" "test:client" "duplicates" "review-loop:lint" "review-loop:typecheck" "review-loop:format:check" "review-loop:test")
  failed=0
  pids=()

  # Run all checks in parallel
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    (
      exit_code=0
      if [ "$check" = "license-headers" ]; then
        header_checked_files=()
        while IFS= read -r file; do
          [ -n "$file" ] || continue
          if is_license_header_file "$file"; then
            header_checked_files+=("$file")
          fi
        done < <(git ls-files 2>/dev/null || true)
        run_license_header_check "$TMPDIR/$fname.out" "${header_checked_files[@]+${header_checked_files[@]}}" || exit_code=$?
      elif [ "$check" = "test" ]; then
        bun run test >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
      else
        bun run "$check" >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
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
fi
