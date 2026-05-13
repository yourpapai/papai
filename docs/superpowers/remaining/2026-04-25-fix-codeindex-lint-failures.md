# Remaining Work: 2026 04 25 fix codeindex lint failures

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-25-fix-codeindex-lint-failures.md`

## Completed

_None identified._

## Remaining

- Remove redundant `if (tree === null)` guard clauses in `tests/codeindex/extract-symbols.test.ts`, `tests/codeindex/indexer/extract-symbols.test.ts`, and `tests/codeindex/indexer/extract-references.test.ts`.
- Refactor compound predicates in `.some()`, `.find()`, or `.filter()` calls in `tests/codeindex/indexer/extract-references.test.ts` into deterministic assertions.
- Verify all fixes by running `bun codeindex:lint` and `bun check:verbose`.

## Suggested Next Steps

1. Execute Pattern A: Remove the `if (tree === null)` guard clauses across the three identified test files.
2. Execute Pattern B: Decompose compound boolean predicates in `tests/codeindex/indexer/extract-references.test.ts` into explicit `expect` calls.
3. Run `bun codeindex:lint` to confirm zero violations remain.
