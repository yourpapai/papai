<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0328: Drop the TS7-Incompatible `@stryker-mutator/typescript-checker` — Bun Runner Becomes the Sole Mutant-Killer

## Status

Accepted

## Date

2026-07-24

## Context

Mutation testing (StrykerJS 9.6.1 + `@hughescr/stryker-bun-runner` 1.3.8) stopped running after the repo moved to `typescript@7.0.2`. TS7 moved all compiler APIs behind the `typescript/unstable/*` subpaths, so `require('typescript')` now returns only `{ version, versionMajorMinor }`. `@stryker-mutator/typescript-checker@9.6.1` — the latest published version, with no upstream TS7 support — does `import ts from 'typescript'`, receives the version-metadata stub, and crashes at runtime when it calls compiler APIs (`ts.sys`, `parseConfigFileTextToJson`, …). The checker had been added deliberately (commits `9d6bc7d87`/`60666618b`, "build(stryker): add typescript-checker plugin") to type-kill mutants that the bun test runner cannot observe, so `stryker.config.json` is tracked and its removal must be a documented, reversible decision — not a silent config edit.

The design spec (`docs/superpowers/specs/2026-07-24-stryker-ts7-unblock-design.md`) established that Stryker core and the bun runner never import `typescript` (Bun compiles TS natively), so dropping the checker is sufficient to unblock mutation testing with no source changes and no shim. The implementation plan (`docs/superpowers/plans/2026-07-24-stryker-ts7-unblock.md`) scoped the change to four files — `stryker.config.json`, `knip.config.ts`, `package.json`, `bun.lock` — plus an ephemeral scoped smoke run proving Stryker completes a real mutation cycle under TS7 with no checker crash.

## Decision Drivers

- **Unblock mutation testing now.** Every `bun test:mutate*` lane (full suite, `test:mutate:changed` PR gate, per-file ratchet baseline) is dead while the checker crashes; waiting on upstream leaves the mutation gate dark indefinitely.
- **Removal, not workaround.** The checker imports the bare `typescript` namespace; no config flag changes that. A shim faking the compiler API surface would be a large, fragile maintenance surface for zero upstream commitment.
- **Keep the trade-off explicit and reversible.** Dropping the checker means mutants that break only types now survive instead of being type-check-killed; the decision record must state this and carry the re-enable condition so a future bump does not silently re-add a still-incompatible plugin.
- **Leave no phantom references.** The checker appears in `stryker.config.json` (`appendPlugins`/`checkers`/`tsconfigFile`), `package.json` devDependencies, `knip.config.ts` `ignoreDependencies` (runtime-loaded, knip-untraceable), and `bun.lock` — all four must move together or knip/lockfile hygiene breaks.
- **Local tooling only.** No `src/` or `tests/` code is touched; the blast radius is exactly the build/test tooling config surface.

## Considered Options

### Option 1 — Remove the checker; bun runner becomes the sole mutant-killer (chosen)

Drop `@stryker-mutator/typescript-checker` from `appendPlugins` (along with the checker-only `checkers` and `tsconfigFile` keys), from `devDependencies`, from `knip.config.ts` `ignoreDependencies` (with its stale comment), and sync `bun.lock`. Verify with a scoped Stryker smoke run on `src/errors.ts` using an ephemeral `/tmp/stryker.smoke.json` config.

- **Pros:** unblocks mutation testing immediately with four file edits; no shim to maintain; Stryker core and the bun runner are verified not to import `typescript`, so nothing else breaks; knip's ignore list drops a phantom entry (`['msw', '@crvy/strybk']`), matching ADR-0292's minimal-justified-ignore guardrail.
- **Cons:** type-only mutants (mutants that fail `tsc` but pass the bun test suite) now survive, so reported mutation scores drop in killing power compared to the checker era; the loss is silent unless documented.

### Option 2 — Pin TypeScript 6 for Stryker while the app uses TS7 (rejected)

Keep a TS6 copy resolvable for the checker (e.g. an alias or nested install) so the checker keeps type-killing mutants.

- **Pros:** preserves the type-kill lane; no loss of mutant-killing power.
- **Cons:** two compiler lines in the dependency tree is a permanent divergence hazard — the checker would type-check mutants against TS6 semantics while the app compiles under TS7, so kills/survivals can diverge from reality; aliasing `typescript` for one plugin is exactly the fragile-shim maintenance surface this decision exists to avoid. (A partial form of this — resolving TS6 only for Stryker core's tsconfig rewrite — shipped later as a separate, narrower change; it does not restore the checker.)

### Option 3 — Wait for upstream TS7-compatible checker (rejected)

Leave the checker in place and defer mutation testing until `@stryker-mutator/typescript-checker` ships TS7 support.

- **Pros:** zero repo churn; type-kill lane returns intact when upstream lands.
- **Cons:** no upstream commitment or timeline exists (9.6.1 is the latest and imports the bare namespace); every mutation gate stays dark in the meantime, including the CI per-file ratchet — an unbounded quality-gate outage traded for a hypothetical future convenience.

### Option 4 — Write/maintain a custom TS7 checker shim (rejected)

Provide a compatibility layer exposing the old compiler API shape over `typescript/unstable/*`.

- **Pros:** keeps the type-kill lane without waiting on upstream.
- **Cons:** the unstable API surface is explicitly unstable — the shim would chase breaking subpath changes each TS7 release; hand-rolling a compiler-API facade for a third-party plugin is disproportionate to a local-tooling problem and far exceeds the maintenance budget of Option 1's accepted trade-off.

## Decision

Remove `@stryker-mutator/typescript-checker` entirely; the bun test runner (`coverageAnalysis: perTest`) is the sole mutant-killer. Shipped in commit `be0f7c520` ("build(stryker): drop TS7-incompatible typescript-checker"):

1. **`stryker.config.json:3`** — `appendPlugins` is `["@hughescr/stryker-bun-runner"]`; the `checkers: ["typescript"]` and `tsconfigFile` keys are gone (they were checker-only).
2. **`knip.config.ts:147`** — `ignoreDependencies: ['msw', '@crvy/strybk']`; the checker entry and its stale two-line comment are removed (it is no longer a dependency at all, so nothing needs ignoring).
3. **`package.json`** — `"@stryker-mutator/typescript-checker": "^9.6.0"` removed from `devDependencies`; `@stryker-mutator/core` remains (referenced via `appendPlugins`, keeping knip green).
4. **`bun.lock`** — synced via `bun install`; `node_modules/@stryker-mutator/` contains only `core` (plus `api`/`instrumenter`/`util` as core's transitives in the lockfile).
5. **Smoke verification** — an ephemeral `/tmp/stryker.smoke.json` scoped to `src/errors.ts` (`incremental: false`, `break: 0`) ran Stryker under TS7 to completion: no TS7 crash signatures in the log, and a JSON report containing `errors.ts` was produced. The throwaway config/log were deleted after the run, per the established repo pattern.

**Re-enable condition:** re-add a type-checker only when upstream `@stryker-mutator/typescript-checker` (or a successor plugin) ships support for the TS7 package layout (`typescript/unstable/*`). Do not re-add the 9.x checker against TS7 — it crashes on the bare-namespace import.

## Consequences

### Positive

- Mutation testing runs again under `typescript@7.0.2`: full suite, the `test:mutate:changed` PR gate, and the per-file ratchet baseline (`scripts/mutation/baseline.json`) are all unblocked with a four-file change.
- The config surface is simpler: no checker wiring, no `tsconfigFile` indirection, and knip's `ignoreDependencies` drops to two entries with no phantom reference.
- No source or test code changed; the decision is fully reversible via the re-enable condition when upstream ships TS7 support.
- The removal commit message and this record document the trade-off, so the score drop in killing power is explainable rather than silent.

### Negative

- **Type-only mutants now survive.** Mutants that would fail `tsc` but pass the bun test suite are no longer killed; measured mutation scores are strictly weaker than during the checker era for type-sensitive files. Accepted as the price of an unblocked gate.
- **Score comparability break.** Scores measured before the removal (checker era) are not directly comparable to post-removal scores; the ratchet baseline established after this change is the new reference point.

### Risks

- **Silent re-addition.** A future dependency bump or config merge could reintroduce the checker and re-crash the gate. Mitigated by the re-enable condition in the commit message, the spec, and this ADR; knip would also flag a re-added checker as an unignored/untraceable change requiring an explicit entry.
- **Upstream may never ship TS7 support.** Then the type-kill lane stays off permanently; the accepted trade-off becomes the steady state. Mitigation: periodic re-check of upstream releases against the re-enable condition.

## Related Decisions

- ADR-0017 — Mutation Testing with StrykerJS (pruned 0001–0100 batch; referenced via the index): the original adoption of StrykerJS that this decision keeps operational under TS7.
- [ADR-0292](0292-knip-ignore-cleanup.md) — Knip Ignore-List Cleanup: established the minimal-justified-ignore guardrail; this decision removes the checker's `ignoreDependencies` entry outright (the dependency itself is gone), keeping that surface honest.

## Implementation Notes

Verified present against the shipped tree.

| File | Role | Evidence |
| --- | --- | --- |
| `stryker.config.json:3` | `appendPlugins: ["@hughescr/stryker-bun-runner"]`; no `checkers`/`tsconfigFile` keys. | `read` confirms. |
| `knip.config.ts:147` | `ignoreDependencies: ['msw', '@crvy/strybk']`; no checker entry or stale comment. | `grep` confirms. |
| `package.json` | No `@stryker-mutator/typescript-checker` in `devDependencies`. | `grep` confirms. |
| `bun.lock` | No `typescript-checker` entries; `@stryker-mutator/core`/`api`/`instrumenter`/`util` present. | `grep` confirms. |
| `node_modules/@stryker-mutator/` | Contains only `core`. | `ls` confirms. |
| `git log` | Commit `be0f7c520` "build(stryker): drop TS7-incompatible typescript-checker". | `git log` confirms. |

Plan-vs-implementation notes:

- **Plan checkboxes are all unchecked (`- [ ]`) despite full implementation.** The plan's 17 steps shipped exactly as written (same four files, same commit message), but the author never flipped the checkboxes — verification rests on the shipped tree and commit `be0f7c520`, not the plan's checkbox state.
- **Task 2's smoke run is ephemeral by design.** `/tmp/stryker.smoke.json` and its log were deleted after verification; no repo artifact proves the run beyond the commit. This matches the plan's "NOT committed" constraint.
- **Scope held.** Only the four intended files changed; no `src/`/`tests/` churn, no runner/coverage/`mutate`-glob edits (the plan's out-of-scope list stayed out).

## References

- Plan: `docs/superpowers/plans/2026-07-24-stryker-ts7-unblock.md`
- Design spec: `docs/superpowers/specs/2026-07-24-stryker-ts7-unblock-design.md` (carries the re-enable condition)
- Implementation commit: `be0f7c520` ("build(stryker): drop TS7-incompatible typescript-checker")
