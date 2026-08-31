# exclude-research-poc-tests

## Why

The default `bun test` run spends **37.9 s serial** (3.5 % of the suite's 1 077 s in-test total) on 16 self-check files under `docs/research/analytics-metrics/poc/` — a research PoC tree, not product tests. They run on every full suite and every CI run only because bun's discovery is cwd-wide and their filenames contain `.test.` (measured in `docs/research/2026-08-26-test-suite-speedup-methods.md`, Method 1); two fixture self-checks carry 34.2 s of the total. That is ~7× the entire measured ceiling of test-case consolidation (`test-consolidation-speed-evidence`), for a one-line exclusion.

## What Changes

- The 16 poc test files leave default `bun test` discovery, via `pathIgnorePatterns += "docs/**"` in `bunfig.toml`.
- A `bun run test:research` script runs them explicitly (explicit-path `bun test` runs any filename), so the PoC self-checks stay runnable and are not lost.
- Nothing else: the poc's *source* modules stay where they are (`tests/analytics/intent/taxonomy.test.ts` imports `poc/intent/taxonomy.js` — that import bypasses discovery and is unaffected); no test is deleted, no assertion weakened, no coverage-floor impact (the poc files import no `src/`/`plugins/` code, so they contribute nothing to the lcov denominator).

## Capabilities

### New Capabilities

- `research-poc-test-isolation`: governs how the analytics-metrics research PoC's self-check tests are kept runnable but out of the default test lane — what is excluded, how it stays runnable, and what the default run must not lose by excluding them.

### Modified Capabilities

- None. The default lane's behavior is unchanged except for the files it no longer discovers; no gate, threshold, or runner contract moves.

## Impact

- Code: `bunfig.toml` (one `pathIgnorePatterns` entry), `package.json` (one script). No `src/`, no `tests/` edits.
- Sequencing constraint: `bunfig.toml` is on the story-refactor frozen list (`tests/CLAUDE.md`), so this change must land on master **between** story-refactor qualifications, never on a qualification branch; the proposal deliberately takes the bunfig route over renaming files because renaming research fixtures churns a documented tree for a lane concern.
- Full-suite case count drops by exactly the 53 poc cases (16 files); in-test serial total drops by ~37.9 s; coverage ratchet unaffected (denominator unchanged — the files never imported production code).
- Known coupling: the `package.json` edit one-time invalidates mutation score caches repo-wide (same budgeted consequence as `tests-consolidation`'s `test:audit` and `test-consolidation-speed-evidence`'s `test:benchmark`).

## Non-goals

- No restructuring or relocation of the poc tree itself — it stays a documented research artifact.
- No changes to which *product* tests run: `tests/**`, `client/`, stories, e2e lanes untouched.
- No CI wiring for `test:research` (the self-checks are on-demand tooling; a CI job is a separate decision if the PoC is ever revived).
- Not the vehicle for any other speedup method — git-fixture acceleration and fake-seam work are separate changes.
