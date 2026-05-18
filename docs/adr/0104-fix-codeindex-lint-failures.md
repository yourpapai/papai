# ADR-0104: Fix codeindex `no-conditional-in-test` Lint Failures

## Status

Accepted

## Context

The `codeindex` workspace test suite contained **44 `eslint-plugin-jest/no-conditional-in-test` violations** that caused `bun codeindex:lint` to exit with code 1. This failure cascaded into the monorepo-wide `bun check:verbose` pipeline, sending an abort signal that prevented subsequent suites (`test`, `typecheck`, `knip`, `duplicates`, `review-loop:lint`, `review-loop:test`) from running.

The codeindex package (`~/Projects/yourpapai/codeindex/`) lives in a separate repository but is consumed by the main `papai` workspace as a local file dependency. Its CI hygiene is therefore critical to the health of the monorepo-level check pipeline.

## Decision

Refactor the affected test files to satisfy `no-conditional-in-test` by converting branching assertions into flat, deterministic assertions. Do not suppress or disable the rule.

## Decision Drivers

- **Must eliminate lint failures** to restore the full `check:verbose` pipeline.
- **Must preserve test expressiveness** — clearer is better than clever.
- **Should not introduce new Jest/oxlint warnings** (`expect-expect`, `valid-expect`, etc.).

## Refactoring Strategy

Two recurring patterns caused the violations:

### Pattern A: Redundant `if (tree === null)` guard after `expect(tree).not.toBeNull()`

After an explicit non-null assertion, the `if` guard is unreachable. Remove it entirely.

```ts
// Before
expect(tree).not.toBeNull()
if (tree === null) throw new Error('Expected parser to produce a tree')

// After
expect(tree).not.toBeNull()
```

> If TypeScript still narrows the variable to `null | undefined`, use a non-null assertion (`tree!`) after the assertion.

### Pattern B: Compound boolean predicates inside `.some()`, `.find()`, `.filter()` callbacks

These create implicit branching on each row of the callback body.

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

// After — select, then assert properties deterministically
const importHelper = references.filter((reference) => reference.edgeType === 'imports').at(0)
expect(importHelper).toBeDefined()
expect(importHelper!.targetName).toBe('helper')
expect(importHelper!.targetModuleSpecifier).toBe('./helper.js')
```

This pattern was applied across all three affected test files.

## Files Changed

| File                                       | Errors | What was done                                  |
| ------------------------------------------ | ------ | ---------------------------------------------- |
| `tests/extract-symbols.test.ts`            | 4      | Removed guard clauses                          |
| `tests/indexer/extract-symbols.test.ts`    | 5      | Removed guard clauses                          |
| `tests/indexer/extract-references.test.ts` | 35     | Removed guards + flattened compound predicates |

## Consequences

### Positive

- `bun codeindex:lint` exits 0.
- `bun check:verbose` completes without premature SIGINT abort.
- Tests are more readable: instead of a compound `.some()` predicate, each property gets an explicit assertion with a clear failure message.

### Negative

- Slightly more verbose test code (more lines per assertion).
- `.filter(...).at(0)` introduces an extra pass over the array; negligible for test data sizes.

## Verification

- `bun run lint` in the `codeindex` workspace: **0 warnings, 0 errors**
- `bun test` in the `codeindex` workspace: **97 pass, 0 fail**
- `bun check:verbose` in `papai`: **EXIT CODE: 0** — all suites pass

## References

- Implementation plan: `docs/archive/2026-04-25-fix-codeindex-lint-failures.md`
- codeindex workspace: `~/Projects/yourpapai/codeindex/`
