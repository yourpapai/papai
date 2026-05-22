<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0028: Staged-Only Pre-Commit Checks

## Status

Accepted

## Context

Our pre-commit hooks were running the full `bun check` suite on every commit, which includes:

- lint (oxlint)
- typecheck (TypeScript)
- format:check (oxfmt)
- knip (dead code detection)
- test (unit tests)
- duplicates (jscpd)
- mock-pollution (test isolation checks)

This was causing significant delays (10-30 seconds) for every commit, even when only small documentation changes were made. Developers were skipping hooks or bypassing checks due to the friction.

The full check suite is valuable for CI/CD, but overkill for local pre-commit validation where the goal is catching obvious errors before they reach the repository.

## Decision Drivers

- **Must reduce commit latency** for typical code changes
- **Must maintain code quality** by catching syntax and type errors early
- **Should run full checks in CI** where time is less critical
- **Should be transparent** - developers should understand what's being checked

## Considered Options

### Option 1: Skip pre-commit entirely

- **Pros**: Zero latency, maximum developer freedom
- **Cons**: Poor code quality, broken commits, CI failures
- **Verdict**: Rejected - defeats purpose of quality gates

### Option 2: Run full checks (status quo)

- **Pros**: Comprehensive validation on every commit
- **Cons**: 10-30s delay per commit, developer frustration
- **Verdict**: Rejected - too heavy for local development

### Option 3: Staged-only checks for local, full checks in CI

- **Pros**: Fast local commits (~2-5s), comprehensive CI validation
- **Cons**: Slightly more complex script, potential for missing global issues
- **Verdict**: Accepted - best balance of speed and safety

## Decision

Implement a staged-only check mode that runs only lint, typecheck, and format:check on modified files, while keeping the full 7-check suite for CI and manual `bun check:full` invocations.

## Implementation

Created `scripts/check.sh` with `--staged` flag support:

```bash
# Staged mode (used by pre-commit hook)
./scripts/check.sh --staged

# Full mode (CI and manual runs)
./scripts/check.sh
bun check:full
```

**Staged checks** (local pre-commit):

- lint on modified files only
- typecheck (project-wide but cached)
- format:check on modified files only

**Full checks** (CI/manual):

- All 7 checks including tests, knip, duplicates, mock-pollution

## Consequences

### Positive

- Commit time reduced from 10-30s to 2-5s for typical changes
- Developer experience improved, fewer bypasses
- CI still catches all issues before merge
- Pre-commit hook remains mandatory and useful

### Negative

- Type errors in unchanged files may not be caught locally
- Format issues in other files may slip through
- Requires CI to be properly configured

### Mitigations

- TypeScript typecheck is still project-wide (cached)
- CI runs full suite before merge
- `bun check:full` available for local validation when needed

## Related Decisions

- ADR-0026: Proactive Assistance (uses same pattern of splitting work between local and remote)
- Package.json scripts: `check`, `check:full`, `check:verbose`

## References

- Implementation plan: `docs/plans/done/2025-03-24-staged-only-precommit-implementation.md`
- Script: `scripts/check.sh`
