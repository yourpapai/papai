# Plan: Fix codeindex `no-conditional-in-test` Lint Failures

## Context

The `codeindex` workspace test suite contains 44 `eslint-plugin-jest/no-conditional-in-test` violations. These caused `codeindex:lint` to exit with code 1, which in turn aborted the full `bun check:verbose` pipeline (SIGINT cascade) and blocked verification of the remaining suites (`lint`, `test`, `typecheck`, `knip`, `duplicates`, `review-loop:lint`, `review-loop:test`).

## Root Cause

The two patterns triggering the failures are:

1. **Guard clauses after `parser.parse()`:**
   ```ts
   expect(tree).not.toBeNull()
   if (tree === null) throw new Error('Expected parser to produce a tree')
   ```
2. **Compound boolean assertions inside `.some()`, `.find()`, `.filter()` callbacks:**
   ```ts
   references.some(
     (reference) =>
       reference.edgeType === 'imports' &&
       reference.targetName === 'helper' &&
       reference.targetModuleSpecifier === './helper.js',
   )
   ```

## Files to Fix

| File                                                 | Errors | Pattern                                                                 |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `tests/codeindex/extract-symbols.test.ts`            | 4      | `if (tree === null)` guards                                             |
| `tests/codeindex/indexer/extract-symbols.test.ts`    | 5      | `if (tree === null)` guards                                             |
| `tests/codeindex/indexer/extract-references.test.ts` | 35     | `if (tree === null)` guards + `.some()` / `.find()` compound predicates |

## Refactoring Strategy

### Pattern A: Remove redundant parser guards

After `expect(tree).not.toBeNull()`, the `if` guard is unreachable. Remove it entirely.

```ts
// Before
expect(tree).not.toBeNull()
if (tree === null) throw new Error('Expected parser to produce a tree')

// After
expect(tree).not.toBeNull()
```

> If TypeScript still narrows `tree` as possibly `null`, add a non-null assertion or use `expect(tree).toBeDefined()` first.

### Pattern B: Flatten compound `.some()` / `.find()` predicates into deterministic assertions

Decompose into explicit `expect` calls or use `.filter()` + `expect(...).toBe(true)` on individual properties.

Preferred approach: select the matching element first, then assert each property explicitly.

```ts
// Before
expect(
  references.some(
    (reference) =>
      reference.edgeType === 'imports' &&
      reference.targetName === 'helper' &&
      reference.targetModuleSpecifier === './helper.js',
  ),
).toBe(true)

// After
const importHelper = references.find((reference) => reference.edgeType === 'imports')
expect(importHelper).toBeDefined()
expect(importHelper!.targetName).toBe('helper')
expect(importHelper!.targetModuleSpecifier).toBe('./helper.js')
```

For cases using `.find()` and an immediate `expect(...).toBeDefined()`, keep the same flow but inline the filtering logic into a **single** predicate function assigned to a named constant so the assertion remains branchless.

## Steps

1. **Remove guard clauses** from all three test files (~13 occurrences).
2. **Refactor compound predicates** in `extract-references.test.ts` (~22 occurrences) into explicit assertions.
3. Run `bun codeindex:lint` to confirm zero errors.
4. Run `bun check:verbose` end-to-end to confirm no further cascaded SIGINTs.
5. If any hidden errors emerge in the previously-aborted checks, handle them next.

## Acceptance Criteria

- `bun codeindex:lint` passes (exit code 0).
- `bun check:verbose` completes without SIGINT cascade.
- No new `no-conditional-in-test`, `expect-expect`, or `valid-expect` warnings are introduced.
