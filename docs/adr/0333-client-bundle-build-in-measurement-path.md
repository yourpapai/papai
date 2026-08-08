<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0333: Client-Bundle Build Guard in the Measurement Path — Presence-Checked `ensure-client-built` Invoked by `check.sh` and `test:coverage`

## Status

Accepted

## Date

2026-07-25

## Context

The local measurement path — `bun check:full` (via `scripts/check.sh`) and `bun test:coverage` — did not build the client bundles (`public/debug.*`, `admin.*`, `settings.*`) before running the test suite. The two `tests/debug/` suites (`debug-smoke.test.ts`, `server.test.ts`) fail fast in `beforeAll` via `ensurePublicBuilt()` when any of the nine bundles is absent, by design: they are meant to test the real built assets, not to self-build them. On a clean checkout (or after `public/` was removed), this made 3 tests fail locally and local coverage output untrustworthy, since the failing suites poisoned the aggregate. CI never had this problem: its `build` job produces `public/` as an artifact and the `check`/`stories` jobs download it before running tests.

A secondary defect compounded the noise: on the bundle-less path, `debug-smoke.test.ts`'s `beforeAll` threw before assigning `db`, so the `afterAll` `db.close()` threw a second, confusing `TypeError` that obscured the real failure message.

## Decision Drivers

- **Keep the debug suites strict.** `ensurePublicBuilt()`'s fail-fast is a deliberate guard against testing stale or absent assets; it must not be weakened into an auto-build.
- **No CI change.** The artifact flow already places bundles before any measurement job; any guard must be a no-op there, not a "fix" to `ci.yml`.
- **No-op when bundles exist.** Repeat local runs and CI must not pay a rebuild; presence, not timestamps or content hashing, is the check.
- **Unit-testable without a slow real build.** The decision logic (missing-bundle detection, build-once behavior) must be exercisable with fake dependencies.
- **Fail loudly on a broken build.** A non-zero `bun build:client` exit must abort the measurement run, not proceed to a misleading "3 failing tests" state.
- **One clear error on the bundle-less ad-hoc path.** Running `bun test tests/debug/debug-smoke.test.ts` with no bundles should surface only the missing-bundles failure, not a teardown cascade.

## Considered Options

### Option 1 — Presence-guarded build guard in the measurement entry points (chosen)

A single DI-shaped guard script, `scripts/ensure-client-built.ts`, exports `REQUIRED_BUNDLES` (the nine basenames both debug suites assert on), a pure `missingBundles()` presence check, an `EnsureDeps` seam, and `ensureClientBuilt(deps): 'present' | 'built'`. Its `main()` wires real collaborators (spawn `bun build:client`, throw on non-zero exit, log to stderr). `scripts/check.sh`'s full-check branch invokes it before the parallel fan-out only when the active `checks` array contains `test`; `package.json`'s `test:coverage` runs it first. The `debug-smoke` teardown is hardened with `let db: Database | undefined` and `if (db !== undefined) db.close()`.

- **Pros:** measurement path becomes self-sufficient on clean checkouts; zero cost when bundles exist (repeat runs, CI artifact flow); decision logic fully unit-tested with fake deps; build failures abort loudly; no CI change, no test-suite behavior change when bundles are present.
- **Cons:** one more script in the `check.sh` path; `bun run test` (the ad-hoc default suite) remains non-self-building by design — developers must know to build once or use `test:coverage`.

### Option 2 — Make the debug suites auto-build in `beforeAll` (rejected)

Replace the `ensurePublicBuilt()` fail-fast with an inline build when bundles are missing.

- **Pros:** any invocation path (including ad-hoc `bun test`) self-heals.
- **Cons:** weakens a deliberate strictness guard — a suite that silently rebuilds can mask a broken or stale build instead of failing on it; also injects slow build wall-clock into test setup on every clean run; violates the existing contract documented in `docs/architecture/commands.md`.

### Option 3 — Build unconditionally at the start of `check.sh` / `test:coverage` (rejected)

Always run `bun build:client` before measuring, no presence check.

- **Pros:** simplest possible wiring; always fresh bundles.
- **Cons:** pays the full build cost on every repeat local run and would be wasted work in CI where bundles arrive as a downloaded artifact — the exact costs the presence guard exists to avoid.

## Decision

Option 1, implemented as:

1. **`scripts/ensure-client-built.ts`.** Exports `REQUIRED_BUNDLES` (9 basenames), `missingBundles(publicDir, required)` (pure fs presence check; a missing dir yields all of `required`), `type EnsureDeps` (`publicDir` / `required` / `missing` / `build` / `log`), and `ensureClientBuilt(deps)` returning `'present'` (no-op + log) or `'built'` (logs missing set, builds exactly once). `main()` runs only under `import.meta.main`, spawns `bun build:client` with inherited stdio, and throws on non-zero exit.
2. **`tests/scripts/ensure-client-built.test.ts`.** Five unit tests: `missingBundles` over a temp dir (absent dir → all required; all present → empty; subset → in-order remainder) and `ensureClientBuilt` with fake deps (no build when present; one build + missing-name logs when absent).
3. **`scripts/check.sh` wiring.** Inside the full-check (`else`) branch, after the `SKIP_TESTS` filter finalizes `checks` and before `failed=0`, a loop runs the guard once if `test` is among the active checks (`bun scripts/ensure-client-built.ts || exit 1`). The `STAGED_MODE` branch never includes `test`; `--skip-tests` runs filter `test` out, so both need no guard.
4. **`package.json` wiring.** `test:coverage` becomes `bun scripts/ensure-client-built.ts && bun test --coverage`.
5. **Teardown hardening.** `tests/debug/debug-smoke.test.ts`: `let db: Database | undefined` and `if (db !== undefined) db.close()` (explicit guard, not optional chaining, per the `oxc/no-optional-chaining` error rule).
6. **Deliberate non-change.** No `ci.yml` edit — the guard is a no-op where `public/` arrives as an artifact.

## Rationale

- Presence-only checking matches the failure mode: the debug suites assert presence, so the guard's precondition is exactly the suites' precondition — no hash/timestamp machinery that can disagree with what the tests actually require.
- DI-shaped decision logic keeps the slow real build out of unit tests while still letting `main()` fail loudly on a broken client build.
- Gating on the active `checks` array (not on the branch alone) makes the guard compose correctly with `--skip-tests` and `STAGED_MODE` without touching those paths.
- The teardown hardening is separable but included: on the ad-hoc bundle-less path (where the guard intentionally does not run), the suite now emits one clear error instead of a cascade.

## Consequences

### Positive

- `bun check:full` and `bun test:coverage` pass on a clean checkout with no manual `bun build:client` step; local coverage numbers are trustworthy again.
- Repeat runs and CI pay zero rebuild cost (the guard logs "skipping build" and exits).
- A broken client build fails the measurement run at the guard with the build's stderr, not as 3 confusing test failures later.
- The bundle-less ad-hoc `bun test tests/debug/debug-smoke.test.ts` run produces a single clear missing-bundles error.

### Negative

- `bun run test` on a clean checkout still fails the debug suites — a documented, deliberate asymmetry (README and `docs/architecture/commands.md` both state to build once before it).
- The nine-name `REQUIRED_BUNDLES` list duplicates what the debug suites assert on; a new client app (e.g. a fourth bundle family) must be added in both places.

### Risks

- Bundle-list drift between `REQUIRED_BUNDLES` and the debug suites' expectations — mitigated by both reading from the same documented contract and by the guard's unit tests pinning the list.
- Guard silently skipping a genuinely stale build — accepted: presence (not freshness) is the suites' contract; developers force a rebuild with `bun build:client`.

## Related Decisions

- ADR-0327: CI Line-Coverage Floor via Custom Aggregate Gate — the coverage-measurement work whose trustworthiness depends on this path being green locally.
- ADR-0282: Hermetic E2E Master Baseline — adjacent measurement-path hardening work from the same period.

## References

- Plan: `docs/superpowers/plans/2026-07-25-client-bundle-build-in-measurement-path.md`
- Spec: `docs/superpowers/specs/2026-07-25-client-bundle-build-in-measurement-path-design.md`
- Code: `scripts/ensure-client-built.ts`, `tests/scripts/ensure-client-built.test.ts`, `scripts/check.sh`, `package.json` (`test:coverage`), `tests/debug/debug-smoke.test.ts`, `docs/architecture/commands.md`
