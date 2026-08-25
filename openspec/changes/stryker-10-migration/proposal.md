## Why

`@stryker-mutator/core` 10.0.0 is out and dependabot's grouped bump (PR #352) already
proposes it, but that PR is unmergeable as-is: the gate it feeds never actually ran a
mutant under v10, the bun runner (`@hughescr/stryker-bun-runner@1.3.8`) pins its peer to
`^9.0.0`, and the 625-file ratchet baseline in `scripts/mutation/baseline.json` was
measured by the v9 instrumenter. Migrating deliberately — compat first, then a fresh
baseline under the new instrumenter — keeps the gate trustworthy instead of green by
accident.

## What Changes

- Bump `@stryker-mutator/core` to `^10.0.0` (Babel 8 instrumentation, new
  empty-expression mutator; Node ≥ 22 host requirement).
- Make `@hughescr/stryker-bun-runner@1.3.8` installable next to core 10 via a Bun
  `patchedDependencies` patch applying exactly the metadata widening proven in upstream
  PR hughescr/stryker-bun-runner#1 (peer `^9.0.0 || ^10.0.0`, api dep range). **BREAKING**
  for the gate only in the sense that every carried-over mutation score invalidates
  (lockfile is a fingerprint input) and all 625 baseline floors are re-measured.
- Pin Node 22 in the CI `mutation-testing` and `mutation-baseline` jobs via
  `setup-node` (the Stryker CLI host is Node; only test children run on Bun).
- Reseed `scripts/mutation/baseline.json` from a fresh full run under v10
  (`bun test:mutate --update-baseline`), committed as part of this change, so v9-era
  floors can never spuriously fail v10-measured code.
- Drop the patch when the runner ships an upstream release accepting core 10.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The gate's specified behavior — whole-branch evaluation, fingerprint-guarded score
reuse, fresh-only baseline seeding, measured-vs-reused reporting
(`openspec/specs/mutation-gate/spec.md`) — is unchanged; a toolchain bump is an
already-specified fingerprint-invalidation scenario. `skip_specs: true`, matching the
convention for tooling-only changes.

## Non-goals

- **Mutant filtering** (new in Stryker 10) — changes gate semantics and wall-time
  behavior; declined, deserves its own measured change if adopted.
- **`typescript-checker` experimental TS7 support** — the paired runner's coverage-based
  test sets make the checker redundant here; declined.
- **Adopting partial-incremental-report-on-exit config** — arrives from core by default;
  no config work.
- **Touching dependabot PR #352's other eleven bumps** — that PR lands or is recreated
  independently; this change owns only the Stryker delta.
- **Forking the runner under `yourpapai/`** — the patch is two metadata lines; a fork
  outlives its usefulness the day upstream merges #1.

## Impact

- **Runtime scope**: none — no platform/task instances, no config-context state, no
  user-visible behavior. CI tooling only.
- **Code**: `package.json` (+ `patchedDependencies` and `patches/` file),
  `.github/workflows/ci.yml` (two jobs), `scripts/mutation/baseline.json` (regenerated),
  `scripts/mutation/README.md` and `docs/architecture/commands.md` (docs).
- **Dependencies**: `@stryker-mutator/core` 9→10 major; transitive Babel 7→8.
- **Existing coverage**: `scripts/mutation/` paired-runner infra (2,628 LOC) needs no
  changes — `execFileSync` spawn path (`scripts/mutation/paired-run.ts:90`) inherits the
  pinned Node from PATH.
