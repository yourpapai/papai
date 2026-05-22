<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0011: Knip for Dead Code Detection and Enforced Export Hygiene

## Status

Accepted

## Date

2026-03-18

## Context

Over the course of early development, the papai codebase accumulated significant dead code. Contributing factors were: (1) auto-generated Kaneo OpenAPI schema files that were created speculatively but never imported, (2) backward-compatibility re-export blocks in provider barrel files that were never consumed, (3) types and functions exported "for completeness" but not used outside their own module, and (4) transitive dependencies imported directly in source without being listed in `package.json`. When knip was first run in strict mode, it reported over 250 issues: 49 unused files, 194 unused value exports, 159 unused type exports, 12 duplicate exports, 4 unlisted dependencies, and 1 unresolved import. This created noise in the codebase, increased the cognitive surface area for new contributors, and made it harder to determine which code was load-bearing.

The architectural question was: should dead code detection be a one-time cleanup or a permanently enforced constraint?

## Decision Drivers

- 49 unused schema files in `src/providers/kaneo/schemas/` were auto-generated from the Kaneo OpenAPI spec but never referenced anywhere in the codebase.
- A backward-compatibility re-export block in `src/providers/kaneo/index.ts` (lines 239-291) re-exported ~30 functions and types that had zero consumers; the same pattern appeared in `src/providers/kaneo/api.ts`.
- Unlisted direct imports of `@grammyjs/types`, `@ai-sdk/provider`, and `@gramio/types` created implicit dependency on transitive package resolution order.
- The `check` script in `package.json` runs all quality gates in parallel; adding `knip` to this pipeline enforces the constraint on every CI run.

## Considered Options

### Option 1: One-time manual cleanup, no ongoing enforcement

- **Pros**: Simple; no tooling investment.
- **Cons**: Dead code accumulates again without enforcement; the 250-issue backlog would rebuild over time; offers no structural guarantee.

### Option 2: Knip in strict mode, enforced in CI

- **Pros**: Permanent enforcement; documents intent (unexported = internal); catches unlisted dependencies before they cause silent version drift; integrates with existing `bun run check` pipeline.
- **Cons**: Adds a dev dependency (`knip-bun`); requires upfront cleanup to reach zero-issue baseline; some legitimate patterns (e.g., types used only in test files) may require knip config annotations to suppress false positives.

### Option 3: ESLint with `no-unused-vars` / `@typescript-eslint/no-unused-exports`

- **Pros**: Already familiar to many teams; integrates with lint workflow.
- **Cons**: The project uses oxlint (not ESLint), which does not have an equivalent cross-file dead export analysis; `no-unused-vars` only catches local variables, not exported symbols unused across the module graph.

## Decision

Adopt knip in strict mode (`knip-bun --strict`) as a permanent quality gate, integrated into `bun run check`. Perform a one-time cleanup to reach the zero-issue baseline, then enforce zero issues on every subsequent CI run.

The cleanup was structured as a hierarchy of risk:

1. Delete provably unused files (highest impact, zero risk of regression).
2. Trim backward-compat barrel re-exports that had no consumers.
3. Add unlisted transitive dependencies to `package.json` explicitly.
4. Remove `export` keywords from functions and types never imported outside their module.
5. Deduplicate schema alias exports.

## Rationale

Knip operates at the module-graph level, which neither TypeScript's `noUnusedLocals` nor oxlint can replicate — those tools only see within a single file. Strict mode ensures that every exported symbol must have at least one consumer somewhere in the codebase (or in a designated entry point), which enforces the principle that `export` is a deliberate public API decision, not a default. The `knip-bun` variant is used because it understands Bun-specific entry points (e.g., `bun test` patterns in `package.json`).

## Consequences

### Positive

- 48 auto-generated Kaneo schema files were deleted, removing code that could not be reasoned about or safely modified.
- `src/providers/kaneo/api.ts` barrel file was deleted; `src/providers/kaneo/index.ts` backward-compat block was removed, making the provider's actual public API surface explicit.
- `src/prompts/system.ts` (an exact duplicate of inline code in `bot.ts`) was deleted.
- All three unlisted transitive dependencies (`@grammyjs/types`, `@ai-sdk/provider`, `@gramio/types`) are now explicit in `package.json`, preventing silent breakage on upstream version bumps.
- The `export` keyword now carries meaning: it signals intentional public surface, not habit.
- Knip runs in the `bun run check` parallel pipeline, so violations are caught before merge.

### Negative

- Developers must be aware of knip when adding new exports or files; adding an export that is not consumed anywhere will fail CI.
- Some schema types used only in test files required careful handling to avoid false-positive knip errors (tests must be declared as entry points in `knip.jsonc`).
- The `src/scripts/` directory contains types and functions that are script-local; these required un-exporting rather than deletion, which is a subtle distinction new contributors must understand.

## Implementation Status

**Status**: Implemented

Evidence:

- `src/providers/kaneo/schemas/` — contains 11 files (reduced from 59+); the 48 unused auto-generated files were deleted.
- `src/providers/kaneo/api.ts` — file deleted (confirmed absent).
- `src/providers/kaneo/index.ts` — no backward-compat re-export block present; file begins directly with operational imports.
- `src/prompts/` directory — deleted (confirmed absent).
- `package.json` — `@ai-sdk/provider@^3.0.8` in `dependencies`; `@gramio/types` and `@grammyjs/types` in `devDependencies`.
- `package.json` `scripts.knip` — `"knip-bun --strict"`, included in `scripts.check` parallel pipeline.
- `tests/test-helpers.ts` — exports `restoreAllModules`, `flushMicrotasks`, `storeOriginalModule`, `restoreModule`, `setMockFetch`, and mock factory functions (`createMockTask`, `createMockProject`, etc.); these were added as part of the broader test hygiene work done alongside the knip cleanup.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-18-knip-dead-code-cleanup.md`
