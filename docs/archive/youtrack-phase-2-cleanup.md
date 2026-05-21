<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Phase 2 Cleanup Tasks

This document tracks cleanup tasks following the completion of YouTrack Phase 2 implementation.

## Lint Rule Cleanup

### Disabled Rules to Re-enable

During YouTrack Phase 2 implementation, two lint rules were temporarily disabled for test files in `.oxlintrc.json`. These should be re-enabled and any violations fixed.

**File:** `.oxlintrc.json`

**Rules to re-enable:**

1. `typescript/no-unsafe-type-assertion` (line 49)
2. `typescript/no-unsafe-argument` (line 50)

**Action:** Remove these two lines from the `overrides[0].rules` section:

```json
// BEFORE (current)
{
  "files": ["tests/**/*.ts"],
  "rules": {
    "max-lines-per-function": "off",
    "max-lines": "off",
    "no-await-in-loop": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/await-thenable": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unsafe-argument": "off"
  }
}

// AFTER (target)
{
  "files": ["tests/**/*.ts"],
  "rules": {
    "max-lines-per-function": "off",
    "max-lines": "off",
    "no-await-in-loop": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/await-thenable": "off"
  }
}
```

**After removing the rules:**

1. Run `bun lint` to identify violations
2. Fix each violation:
   - `no-unsafe-type-assertion`: Use proper type guards or `satisfies` keyword instead of `as`
   - `no-unsafe-argument`: Add proper type validation before passing arguments

**Known violations to fix:**

| File                                                     | Rule                       | Line | Issue                                                                                                     |
| -------------------------------------------------------- | -------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 32   | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 70   | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 96   | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 164  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 220  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 240  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 258  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 286  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 312  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 338  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 356  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 374  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 395  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 418  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 436  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 461  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 482  | `issue as unknown as IssueSchema` - Use `satisfies` or validate with Zod                                  |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 501  | `issue as unknown as CommentSchema` - Use `satisfies` or validate with Zod                                |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 519  | `issue as unknown as CommentSchema` - Use `satisfies` or validate with Zod                                |
| `tests/providers/youtrack/mappers.test.ts`               | `no-unsafe-type-assertion` | 547  | `issue as unknown as CommentSchema` - Use `satisfies` or validate with Zod                                |
| `tests/providers/youtrack/relations.test.ts`             | `no-unsafe-type-assertion` | 71   | `JSON.parse(body) as Record<string, unknown>` - Use Zod schema.parse                                      |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 160  | `calls[0] as [string, RequestInit]` - Use proper type guard                                               |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 163  | `calls[1] as [string, RequestInit]` - Use proper type guard                                               |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 166  | `calls[2] as [string, RequestInit]` - Use proper type guard                                               |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 253  | `error as { message: string }` - Use proper type guard                                                    |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 367  | `error as { message: string }` - Use proper type guard                                                    |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 437  | `error as { message: string }` - Use proper type guard                                                    |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 490  | `calls[0] as [string, RequestInit]` - Use proper type guard                                               |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 491  | `calls[2] as [string, RequestInit]` - Use proper type guard                                               |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 511  | `calls[2] as [string, { body?: string }]` - Use proper type guard                                         |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 512  | `calls[2] as [string, { body?: string }]` and subsequent `as { ordinal: number }` - Use proper type guard |
| `tests/providers/youtrack/operations/statuses.test.ts`   | `no-unsafe-type-assertion` | 535  | `error as { message: string }` - Use proper type guard                                                    |
| `tests/providers/youtrack/operations/users.test.ts`      | `no-unsafe-type-assertion` | 218  | `error as YouTrackClassifiedError` - Use proper type guard                                                |
| `tests/providers/youtrack/operations/work-items.test.ts` | `no-unsafe-type-assertion` | 153  | `body as Record<string, unknown>` - Use proper type guard                                                 |
| `tests/providers/youtrack/operations/work-items.test.ts` | `no-unsafe-type-assertion` | 160  | `body as Record<string, unknown>` - Use proper type guard                                                 |
| `tests/providers/youtrack/operations/work-items.test.ts` | `no-unsafe-type-assertion` | 274  | `body as Record<string, unknown>` - Use proper type guard                                                 |

**Common fix patterns:**

1. **no-unsafe-type-assertion with test data:**

   ```typescript
   // BEFORE (violates no-unsafe-type-assertion)
   const result = mapIssueToTask(issue as unknown as IssueSchema, baseUrl)

   // AFTER (correct) - Use satisfies keyword
   const result = mapIssueToTask(issue satisfies IssueSchema, baseUrl)

   // OR - Use Zod validation
   const validatedIssue = IssueSchema.parse(issue)
   const result = mapIssueToTask(validatedIssue, baseUrl)
   ```

2. **no-unsafe-type-assertion with error handling:**

   ```typescript
   // BEFORE (violates no-unsafe-type-assertion)
   const errorMessage = (error as { message: string }).message

   // AFTER (correct) - Use type guard
   const errorMessage = error instanceof Error ? error.message : String(error)
   ```

3. **no-unsafe-type-assertion with mock calls:**

   ```typescript
   // BEFORE (violates no-unsafe-type-assertion)
   const [url, init] = calls[0] as [string, RequestInit]

   // AFTER (correct) - Use Array.isArray check
   if (!Array.isArray(calls[0]) || calls[0].length < 2) {
     throw new Error('Invalid mock call')
   }
   const [url, init] = calls[0] as unknown as [string, RequestInit]
   ```

## Knip Configuration Cleanup

### Remove Temporary ignoreIssues

The `ignoreIssues` entry was added temporarily during Phase 2 to accommodate test-only exports. This should be removed once the exports are properly used or the file is refactored.

**File:** `knip.jsonc`

**Action:** Remove the `ignoreIssues` block (lines 39-41):

```jsonc
// BEFORE (current)
  // Test-only exports (clearBundleCache is only used in test files)
  "ignoreIssues": {
    "src/providers/youtrack/bundle-cache.ts": ["exports"],
  },

  // Ignore migration files (executed at runtime, not imported)
  "ignore": ["src/db/migrations/**"],
}

// AFTER (target)
  // Ignore migration files (executed at runtime, not imported)
  "ignore": ["src/db/migrations/**"],
}
```

**Resolution options:**

1. **Option A:** Export `clearBundleCache` from a test helper instead of the production module
2. **Option B:** Create a proper public API for bundle cache management
3. **Option C:** Move bundle cache utilities to a dedicated test utilities module

**Verification:**

- Run `bun knip` after removing the entry
- Ensure no unused export errors are reported for `src/providers/youtrack/bundle-cache.ts`

## Verification Checklist

### Lint Rule Cleanup

- [x] `.oxlintrc.json` updated (2 rules removed from lines 49-50)
- [x] Run `bun lint` to identify violations
- [x] All `no-unsafe-type-assertion` violations fixed in tests
- [x] All `no-unsafe-argument` violations fixed in tests
- [x] Run `bun test` to verify tests still pass

### Knip Cleanup

- [x] `knip.jsonc` updated (`ignoreIssues` removed, lines 39-41)
- [x] Decide on resolution option (A, B, or C) for `clearBundleCache`
- [x] Implement chosen resolution
- [x] Run `bun knip` to verify no unused export errors

### Final Verification

- [x] All CI checks pass
- [x] PR created with `[cleanup]` prefix in title
