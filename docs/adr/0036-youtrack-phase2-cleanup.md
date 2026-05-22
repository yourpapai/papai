<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0036: Re-enable Strict Type Safety Lint Rules for Test Suite

## Status

Accepted

## Date

2025-04-09

## Context

During the YouTrack Phase 2 implementation, two TypeScript lint rules were temporarily disabled in `.oxlintrc.json` to allow rapid development:

- `typescript/no-unsafe-type-assertion` (line 49)
- `typescript/no-unsafe-argument` (line 50)

These rules were disabled in the test file overrides section (`.oxlintrc.json` lines 41-52) to allow using `as` type assertions and unsafe argument passing in test files. However, this created a blind spot where type safety violations could accumulate without detection.

Additionally, the `clearBundleCache` export from `src/providers/youtrack/bundle-cache.ts` was only used in test files, requiring a `knip.jsonc` `ignoreIssues` entry that masked potential export hygiene issues.

## Decision Drivers

- **Must maintain type safety** in test code to catch real bugs early
- **Should eliminate tool configuration debt** (disabled lint rules, knip ignores)
- **Should use idiomatic TypeScript patterns** (`satisfies` instead of `as`)
- **Must not break existing test functionality** during cleanup

## Considered Options

### Option 1: Keep Rules Disabled

- **Pros**: No work required, tests continue to pass
- **Cons**: Type safety violations accumulate silently, technical debt grows, potential for runtime errors in tests

### Option 2: Re-enable Rules and Fix All Violations Systematically

- **Pros**: Restores full type safety coverage, eliminates configuration debt, improves code quality
- **Cons**: Requires refactoring ~40 type assertions across 6 test files

### Option 3: Use Less Strict Type Checking

- **Pros**: Faster to implement, fewer changes needed
- **Cons**: Still allows some unsafe patterns, doesn't fully address the debt

## Decision

We will **re-enable both disabled lint rules** and systematically fix all violations using idiomatic TypeScript patterns.

## Implementation Approach

### Pattern 1: Replace `as` with `satisfies` (20 violations in mappers.test.ts)

**Before:**

```typescript
const result = mapIssueToTask(issue as unknown as z.infer<typeof IssueSchema>)
```

**After:**

```typescript
const makeIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: '123',
  idReadable: 'PROJ-1',
  summary: 'Test Task',
  // ... defaults
  ...overrides,
})

const result = mapIssueToTask(makeIssue({ id: '456' }))
```

### Pattern 2: Type Guards Instead of `as` Assertions (5 violations)

**Before:**

```typescript
const classifiedError = error as YouTrackClassifiedError
const errorMessage = (error as { message: string }).message
```

**After:**

```typescript
const classifiedError = error instanceof YouTrackClassifiedError ? error : null
const errorMessage = error instanceof Error ? error.message : String(error)
```

### Pattern 3: Property Existence Checks (3 violations in work-items.test.ts)

**Before:**

```typescript
expect((body['duration'] as Record<string, unknown>)?.['minutes']).toBe(90)
```

**After:**

```typescript
const duration = body['duration']
expect(typeof duration === 'object' && duration !== null && 'minutes' in duration ? duration.minutes : undefined).toBe(
  90,
)
```

### Pattern 4: Zod Schema Validation for Mock Data (12 violations in statuses.test.ts)

Created a `getFetchCall()` helper using Zod schema validation instead of tuple type assertions:

```typescript
const getFetchCall = (index: number): [string, RequestInit] | null => {
  const call = fetchMock.mock.calls[index]
  if (!Array.isArray(call) || call.length < 2) return null
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return null
  return [parsed.data[0], parsed.data[1]]
}
```

### Pattern 5: Test Helper for Cross-File Exports

Created `tests/providers/youtrack/test-helpers.ts` to re-export `clearBundleCache`, eliminating the need for knip ignore:

```typescript
import { clearBundleCache } from '../../../src/providers/youtrack/bundle-cache.js'
export { clearBundleCache }
```

## Consequences

### Positive

- Full type safety coverage restored for test suite
- Eliminated 2 disabled lint rules from `.oxlintrc.json`
- Removed `ignoreIssues` entry from `knip.jsonc`
- Test code now uses idiomatic TypeScript patterns (`satisfies`, type guards)
- All 1790+ tests continue to pass

### Negative

- Initial refactoring effort (~4 hours)
- Some test code is slightly more verbose (type guards vs. `as` assertions)

### Risks

- Potential for subtle behavioral changes if type guards don't match original logic
- Mitigation: All tests pass, mutations testing confirms coverage

## Verification

All checks pass after implementation:

```bash
bun test              # All 1790+ tests pass
bun lint              # No unsafe type assertion or argument errors
bun typecheck         # No type errors
bun knip              # No unused export errors
bun check:full        # All quality gates pass
```

## Files Changed

| File                                                     | Change                                  |
| -------------------------------------------------------- | --------------------------------------- |
| `tests/providers/youtrack/test-helpers.ts`               | Created to re-export `clearBundleCache` |
| `tests/providers/youtrack/bundle-cache.test.ts`          | Updated import to use test helper       |
| `tests/providers/youtrack/index.test.ts`                 | Updated import to use test helper       |
| `tests/providers/youtrack/relations.test.ts`             | `satisfies` instead of `as`             |
| `tests/providers/youtrack/operations/users.test.ts`      | Type guard for error handling           |
| `tests/providers/youtrack/operations/work-items.test.ts` | Property existence checks               |
| `tests/providers/youtrack/operations/statuses.test.ts`   | Zod validation helper, type guards      |
| `tests/providers/youtrack/mappers.test.ts`               | Type-safe factories with `satisfies`    |
| `.oxlintrc.json`                                         | Removed 2 disabled rules                |
| `knip.jsonc`                                             | Removed `ignoreIssues` block            |

## Lessons Learned

1. **Temporary disables become permanent without tracking** — Document all "temporary" workarounds with tickets
2. **`satisfies` > `as`** — TypeScript's `satisfies` keyword provides type safety without casting
3. **Test helpers improve both code and tooling** — Re-exporting through test helpers fixes both imports and knip detection
4. **Incremental fixes reduce risk** — Processing files by violation count (1→20) allowed early verification

## Related Decisions

- ADR-0008: Layered Architecture Current State and Violations — Type safety is part of overall code quality
- ADR-0014: Testing Strategy — Type-safe tests are maintainable tests

## References

- [TypeScript `satisfies` Keyword](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
- [oxlint no-unsafe-type-assertion Rule](https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-unsafe-type-assertion.html)
- Original implementation plan: `docs/archive/youtrack-phase2-cleanup-2025-04-09.md`
