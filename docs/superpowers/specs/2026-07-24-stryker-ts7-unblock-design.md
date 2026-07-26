<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Unblock Stryker mutation testing under TypeScript 7 — design

Date: 2026-07-24
Status: approved (design), pending implementation plan

## Problem

Stryker mutation testing is dead under the repo's current toolchain. The
`mutation-testing-revive` worktree exists to bring it back, but every run crashes
in `@stryker-mutator/typescript-checker`. Root cause is a TypeScript 7 packaging
change, not a Stryker bug.

### Root cause (verified)

TypeScript 7.0.2 restructured its package `exports`. The main entry (`.`) now
resolves to `lib/version.cjs`, which exposes **only** version metadata:

```
node -e "console.log(Object.keys(require('typescript')))"
=> [ 'version', 'versionMajorMinor' ]
```

Every compiler API (`sys`, `createProgram`, `createSolutionBuilderWithWatch`,
`parseConfigFileTextToJson`, `formatDiagnostics`, the AST factory, ...) moved
behind `./unstable/*` subpaths.

`@stryker-mutator/typescript-checker@9.6.1` does `import ts from 'typescript'`
expecting the full TS5-shaped namespace, so the APIs it calls are `undefined`:

- `ts.sys`, `ts.createSolutionBuilderWithWatch`,
  `ts.createEmitAndSemanticDiagnosticsBuilderProgram`,
  `ts.parseConfigFileTextToJson`, `ts.formatDiagnostics`, `ts.forEach/map`.

The checker therefore throws at runtime and Stryker never produces a report.

### Scope of the breakage (verified)

- **`@stryker-mutator/typescript-checker@9.6.1` is the latest published version.**
  Its `peerDependencies.typescript` is `>=3.6` (no upper guard), and the `next`
  dist-tag is a stale `6.4.0-beta.3`. Upstream has **not** shipped TS7 support,
  so there is no upgrade path today.
- **Stryker core does not import `typescript`.**
- **`@hughescr/stryker-bun-runner` does not import `typescript`** — Bun compiles
  TS natively. The **test runner is fully TS7-clean**; only the optional
  type-checker plugin is broken.

The checker was added deliberately in `9d6bc7d87 build(stryker): add
typescript-checker plugin` and `stryker.config.json` is tracked, so removing it
is a real trade-off, not a freebie.

## Approaches considered

| | Approach | Trade-off | Risk |
|---|---|---|---|
| **A** | **Drop the type-checker**; bun runner becomes the sole mutant-killer | Immediate unblock, zero upstream dependency. Lose the type-check kill: mutants that break only types survive instead of being killed → marginally lower score fidelity. | **Low** |
| **B** | **Shim TS7** — local module re-exporting `sys`/`createSolutionBuilderWithWatch`/etc. from `typescript/unstable/*`, aliased via Bun `imports` or `patch-package` | Keeps the type-check kill. But `unstable/*` is not a stable contract, the solution-builder/watch/incremental APIs may be absent or reshaped in the native compiler, and it breaks on any TS patch. | **High** |
| **C** | **Nested TS5** for the checker only | A TS5 checker type-checking TS7-authored source produces spurious errors and version drift; Stryker hoists the project TS. | **Med-high** |

## Accepted approach: A — drop the type-checker

It is the only reliable, low-risk unblock and aligns with the repo's stance that
"Mutation testing (Stryker) is local-only, not in the write-hook pipeline"
(`AGENTS.md`). The bun runner (`coverageAnalysis: perTest`) is the actual
test-quality gate; the type-checker is an optimization that kills mutants no
runtime test would otherwise catch.

## Changes (3 files)

1. **`stryker.config.json`** — remove the checker wiring:
   - `appendPlugins`: drop `"@stryker-mutator/typescript-checker"` →
     `["@hughescr/stryker-bun-runner"]`.
   - delete `"checkers": ["typescript"]`.
   - delete `"tsconfigFile": "tsconfig.json"` (checker-only; JSON forbids
     comments, so the rationale lives here and in the commit message).
2. **`knip.config.ts`** — remove `'@stryker-mutator/typescript-checker'` from
   `ignoreDependencies` (it will no longer be a dependency at all; keep
   `'msw'`, `'@crvy/strybk'`).
3. **`package.json`** — remove
   `"@stryker-mutator/typescript-checker": "^9.6.0"` from `devDependencies`;
   run `bun install` to sync `bun.lock` and drop it from `node_modules`.

## Trade-off accepted

Mutants that break only types (not runtime behavior) now *survive* instead of
being type-check-killed, so the reported mutation score drops slightly. This is
acceptable: the bun runner remains the source of truth for test quality, and
surviving type-only mutants are still surfaced in the report for manual triage.

## Re-enable condition

Re-add the checker only when upstream `@stryker-mutator/typescript-checker`
ships a release compatible with the TS7 package layout — i.e. it consumes the
compiler API via the `typescript/unstable/*` subpaths, or TS7 re-exposes the
full namespace from the main entry. Track via the Stryker repo releases. The
spec/commit message records this so the removal is not mistaken for an accident.

## Error handling

- If the scoped smoke run (below) still fails for an unrelated reason, do **not**
  broaden the change — diagnose the new failure independently and keep this fix
  atomic (config + dependency removal only).
- If `bun install` produces a lockfile diff larger than the single removed
  dependency, treat the current `bun.lock` as the baseline and reconcile only
  that one entry before committing.
- Removal is trivially revertible (`git revert`), so no fallback shim is needed.

## Testing / verification

- `bun install` succeeds; `@stryker-mutator/typescript-checker` is gone from
  `node_modules` and from `bun.lock`.
- **Scoped Stryker smoke run** (the repo's established `/tmp`-config pattern
  from the mutation-measurement investigation): a single-file `--mutate`
  override — e.g. mutate only `src/errors.ts` — initializes, runs, and emits a
  report without the TS7 crash. This proves the unblock without paying for a
  full suite. Full-suite runs are a follow-up, not part of this fix.
- `bun run knip` — green (the removed `ignoreDependencies` entry no longer
  references a phantom dependency).
- `bun run lint`, `bun run typecheck` — green (these are unrelated to the app's
  own typechecking; the checker removal does not affect app typechecking).
- Confirm `git status` shows exactly the 3 files + `bun.lock`.

## Out of scope

bun runner config, coverage settings, the `mutate` globs, any TS7 shim, any TS5
pin, and full-suite mutation score tuning. Those are follow-ups once the lane is
unblocked.
