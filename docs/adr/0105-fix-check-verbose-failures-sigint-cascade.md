<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0105: Fix `bun check:verbose` Failures — SIGINT Cascade Remediation

## Status

Implemented

## Context

`bun check:verbose` runs lint, typecheck, format-check, knip, test, duplicates, and review-loop suites in parallel via `bun --parallel`. Failures in one task propagate as SIGINT to the rest, hiding the true extent of breakages. The cascade was triggered by `review-loop:lint` (14 `no-conditional-in-test` errors) and revealed four additional pre-existing issues in the main workspace.

This remediation is the **papai workspace** counterpart to ADR-0104 (codeindex lint failures). Both were needed to restore the monorepo-level `check:verbose` pipeline.

### Original Issues

| #   | Workspace   | Check     | Errors/Fails | Trigger            | Root Cause                                                        |
| --- | ----------- | --------- | ------------ | ------------------ | ----------------------------------------------------------------- |
| 1   | review-loop | lint      | 14           | **SIGINT cascade** | `no-conditional-in-test` in review-loop test files                |
| 2   | main        | lint      | 6+           | cascade            | `no-conditional-in-test` in `tests/tools/recurring-tools.test.ts` |
| 3   | main        | typecheck | 10           | cascade            | `scripts/behavior-audit/repro-test-tools.ts` (dead file)          |
| 4   | main        | knip      | 1            | cascade            | same dead file flagged as unused                                  |
| 5   | main        | test      | 2            | cascade            | Telegram forum topic tests timeout after 5000ms                   |

## Decision

Address all five issue categories without disabling any lint rules.

## Decision Drivers

- **Must restore `check:verbose` integrity** — the parallel pipeline is the authoritative quality gate.
- **Must not weaken enforcement** — `no-conditional-in-test` catches test smells that mask real assertion failures.
- **Must not leave dead code** — an unused script with type errors is noise for every contributor.
- **Must keep tests deterministic** — timeouts caused by missing mock setup, not slow real code.

## Considered Options

### Option A: Refactor tests to satisfy the rule (adopted)

Replace conditional guards and ternary response mocks with explicit assertions and deterministic lookup tables. See Patterns A–D below.

- **Pros**: Keeps rule active; tests become more self-documenting; no hidden branches.
- **Cons**: More verbose test code; requires understanding each violation's intent.

### Option B: Temporarily disable `no-conditional-in-test`

Add `/* oxlint-disable */` or remove the rule from `.oxlintrc.json`.

- **Pros**: Fastest path to green CI.
- **Cons**: Rule has genuine value; disabled once tends to stay disabled; defeats the purpose of enforcing test quality.

### Option C: Delete the timeout tests

Remove the two Telegram forum topic callback-query tests.

- **Pros**: Quick fix.
- **Cons**: Would lose coverage for thread-aware interaction menu routing.

### Option D: Patch the `check:verbose` runner to ignore SIGINT

Wrap `bun --parallel` with `--continue-on-error` logic.

- **Pros**: Would show all failures at once.
- **Cons**: Would mask real breakages from review-loop lint; doesn't fix the underlying problems.

## Refactoring Strategy — Pattern Library

### Pattern A: Remove null-guard throws after array indexing

Replace `if (x === undefined) throw` with `expect(x).toBeDefined()` + non-null assertion.

```ts
// Before
const runId = readdirSync(runRoot)[0]
if (runId === undefined) {
  throw new Error('Expected a fake run directory')
}

// After
const runId = readdirSync(runRoot)[0]
expect(runId).toBeDefined()
text = readFileSync(path.join(runRoot, runId!, 'summary.txt'), 'utf8')
```

### Pattern B: Replace ternary responses with deterministic lookup tables

Pre-build response arrays to avoid ternary branch selection in mock functions.

```ts
// Before
const reply = reviewerPrompts.length === 1
  ? JSON.stringify({ round: 1, issues: [...] })
  : JSON.stringify({ round: 2, issues: [] })

// After
const mockReplies = [
  JSON.stringify({ round: 1, issues: [...] }),
  JSON.stringify({ round: 2, issues: [] }),
]
const reply = mockReplies[reviewerPrompts.length - 1] ?? JSON.stringify({ round: 999, issues: [] })
```

### Pattern C: Replace `??` fallback with explicit assertion + guard

```ts
// Before
const text = reviewerReplies[reviewerIndex++] ?? JSON.stringify({ round: 999, issues: [] })

// After
const text = reviewerReplies[reviewerIndex++]
expect(text).toBeDefined()
```

### Pattern D: Sequential `if` chains → lookup map

```ts
// Before
if (promptIndex === 1) return reply1
if (promptIndex === 2) return reply2
return reply3

// After
const repliesByIndex: Record<string, () => object> = {
  '1': () => reply1,
  '2': () => reply2,
}
const replyFn = repliesByIndex[promptIndex] ?? (() => reply3)
return replyFn()
```

## Files Changed

### Part 1 — review-loop `no-conditional-in-test` ( CASCADE TRIGGER)

| File                                               | Errors | Pattern                                                     | Refactor Approach |
| -------------------------------------------------- | ------ | ----------------------------------------------------------- | ----------------- |
| `tests/review-loop/loop-controller.test.ts`        | 8      | `??` fallback, ternary length check, sequential `if` chains | Patterns C, D     |
| `tests/review-loop/issue-ledger.test.ts`           | 4      | `if (undefined) throw` after `.find()`                      | Pattern A         |
| `tests/review-loop/progress-log.test.ts`           | 2      | Ternary call-count check                                    | Pattern C         |
| `tests/review-loop/fake-agent-integration.test.ts` | 1      | `if (undefined) throw` after `readdirSync[0]`               | Pattern A         |

### Part 2 — Main workspace lint (`recurring-tools.test.ts`)

| File                                  | Errors | Pattern                    | Refactor Approach |
| ------------------------------------- | ------ | -------------------------- | ----------------- |
| `tests/tools/recurring-tools.test.ts` | 6+     | `if (!tool.execute) throw` | Pattern A         |

### Part 3 — Typecheck + Knip (dead file removal)

| File                                         | Errors | Action                       |
| -------------------------------------------- | ------ | ---------------------------- |
| `scripts/behavior-audit/repro-test-tools.ts` | 10     | **Deleted** — unused, broken |

### Part 4 — Test timeouts (Telegram forum topic)

| File                                | Failures | Fix (`git log` artifact)                                                        |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `tests/chat/telegram/index.test.ts` | 2        | Thread-aware interaction fixed in separate commit between plan and verification |

## Consequences

### Positive

- `bun check:verbose` completes with all 8 parallel tasks exiting code 0.
- `bun review-loop:lint` passes with zero warnings.
- `bun lint` (main workspace) passes with zero warnings.
- No dead code: `repro-test-tools.ts` removed, knip clean.
- Tests are more deterministic — no more hidden branches per mock invocation.
- The parallel check pipeline is trustworthy again.

### Negative

- Slightly larger test file sizes (explicit assertions per value).
- `.at(0)` / `.filter(...)` introduces extra array passes; negligible for test data.

## Verification

| Command                  | Expected | Actual                     |
| ------------------------ | -------- | -------------------------- |
| `bun review-loop:lint`   | 0 errors | 0 errors (exit 0)          |
| `bun lint`               | 0 errors | 0 errors (exit 0)          |
| `bun typecheck`          | 0 errors | 0 errors (exit 0)          |
| `bun knip`               | 0 unused | 0 unused (1 tag hint only) |
| `bun test` (main)        | 0 fails  | 3018 pass, 0 fail          |
| `bun test` (review-loop) | 0 fails  | 54 pass, 0 fail            |
| `bun check:verbose`      | 0 SIGINT | all tasks exit 0           |

## Related Decisions

- [ADR-0104](0104-fix-codeindex-lint-failures.md): Fix codeindex `no-conditional-in-test` Lint Failures — adjacent workspace remediation.
- [ADR-0043](0043-tdd-hooks-integration.md): TDD Hooks Integration — the test-quality enforcement that makes `no-conditional-in-test` non-negotiable.
- [ADR-0111: Knip for Dead Code Detection](0011-knip-dead-code-detection.md): Knip caught the dead file.

## References

- Implementation plan: `docs/archive/2026-04-25-fix-all-check-verbose-failures.md`
- `no-conditional-in-test` rule: [eslint-plugin-jest](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-conditional-in-test.md)
