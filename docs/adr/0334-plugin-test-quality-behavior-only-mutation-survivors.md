<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0334: Plugin Test-Quality Improvement — Behavior-Only Mutation Survivor Killing via Indirect Boundary Tests and Paired-Runner Overrides

## Status

Accepted

## Date

2026-07-25

## Context

Two plugin files had poor or unmeasurable paired mutation scores. `plugins/task-provider-youtrack/operations/agiles.ts` sat at ~55% with a survivor cluster around its module-private date parser (`parseSprintTimestamp`/`isLeapYear`/`getDaysInMonth`): only happy-path Z-timestamps reached it, leaving ~45 survived plus ~15 no-coverage mutants in the calendar/timezone/regex validation region. `plugins/task-provider-kaneo/label-resource.ts` sat at ~45% because its `create`/`list`/`update`/`remove` tests asserted body and result but never the HTTP method or path, so ~8 StringLiteral method/path mutants survived.

Both files were also **unmeasurable**: `bun test:mutate:file` reported `skipped=2` for them because the paired runner's companion resolver does not handle `plugins/` paths, so their scores could not be tracked in the ratchet baseline at all.

The design spec had already settled the meta-question (mirroring the update-status test-quality work): chase **behaviorally testable** survivors only (Option A). Log-payload, error-message-string, JSON-equivalent, and validation-backstop survivors are accepted deliberately, not by oversight.

Source: plan `docs/superpowers/plans/2026-07-25-plugin-test-quality.md`; spec `docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md`.

## Decision Drivers

- **No source changes.** Neither `agiles.ts` nor `label-resource.ts` may be modified (e.g. no exporting `parseSprintTimestamp` just for tests); the improvement is pure test additions plus config.
- **Indirect reach over export.** Module-private helpers are exercised through the public API (`createYouTrackSprint`/`updateYouTrackSprint`), keeping the module boundary intact and the tests refactor-resilient.
- **Behavior-only assertions.** Valid timestamps assert the parsed epoch against `new Date(iso).getTime()` as the parsing oracle; invalid ones assert rejection plus zero fetch calls. No log-payload or message-string assertions.
- **Existing harness, existing patterns.** Reuse the youtrack fetch-mock helpers (`mockFetchResponse`/`getFetchBodyAt`) and the kaneo `setMockFetch` + `getRequestMethod` pattern already used by the file's `listForTask`/`addToTask`/`removeFromTask` tests.
- **Measurement before improvement.** Register both plugin files in `scripts/mutation/overrides.json` first so the paired runner measures them (`skipped=0`) and the ratchet baseline can track them.
- **Never weaken validation.** If a boundary test disagrees with the code, fix the test data, not the validation.

## Considered Options

### Option 1 — Indirect behavior tests + overrides registration (chosen)

Pure test additions: register both plugin files in `scripts/mutation/overrides.json` (2-line unblock); add a boundary-validation `describe` to `agiles.test.ts` driving `parseSprintTimestamp` via `createYouTrackSprint` (9 acceptance + 13 rejection cases via `for…of` loops) plus one `updateYouTrackSprint` test for the `previousSprintId` non-null branch; add an HTTP method/path contract `describe` to `label-resource.test.ts` (4 tests capturing `{url, method}` per request).

- **Pros:** no source churn; tests survive internal refactors since they bind to the public API; ~45-survivor cluster collapses without asserting on brittle strings; both files become measurable and ratchet-guarded; each file's new tests mirror patterns already present in that file.
- **Cons:** surviving log/message/JSON-equivalent mutants remain forever accepted, capping the achievable score below 100%; a spec-mandated comment block per new test group is the one exception to the no-comments convention.

### Option 2 — Export `parseSprintTimestamp` and test it directly (rejected)

Export the private helpers from `agiles.ts` and unit-test them in isolation.

- **Pros:** simpler, more direct tests; finer-grained failure messages.
- **Cons:** violates the no-source-changes constraint; widens the module's public surface purely for testability; couples tests to internal function signatures so refactors break them; sets a precedent of exporting privates across plugin code.

### Option 3 — Chase all survivors including log/message strings (Option B in the spec, rejected)

Add assertions on log payloads, error-message text, and description strings to push scores higher.

- **Pros:** higher raw mutation score.
- **Cons:** locks brittle, user-facing-irrelevant strings into tests; every wording tweak churns tests; explicitly rejected by the design spec as low-value coupling — the accepted survivors are a deliberate quality floor, not a gap.

## Decision

Adopt Option 1. Register `plugins/task-provider-kaneo/label-resource.ts` and `plugins/task-provider-youtrack/operations/agiles.ts` in `scripts/mutation/overrides.json`; add indirect boundary-validation tests for `parseSprintTimestamp` through `createYouTrackSprint` (valid timestamps assert the epoch matches `new Date`; invalid ones assert `YouTrackClassifiedError` rejection with zero fetch calls) plus the `previousSprintId` link test; add method/path contract tests for `create`/`list`/`update`/`remove` in `label-resource.test.ts`. Log-payload, message-string, and JSON-equivalent survivors are intentionally accepted.

## Rationale

- Driving private validation through the public API kills the same mutants while keeping the tests refactor-resilient and the module boundary unchanged.
- The `new Date(iso).getTime()` oracle pins acceptance tests to the JavaScript reference semantics rather than duplicating the parser's logic in the test.
- Asserting rejection **plus zero fetch calls** proves validation happens before the network, which is the behavior that actually matters.
- The method/path contract tests target exactly the StringLiteral mutant class that survived, matching the pattern the file's other tests already established.
- Registering overrides first makes before/after scores measurable and lets the monotonic ratchet baseline (`scripts/mutation/baseline.json`) protect the gains.

## Consequences

### Positive

- Both plugin files are measured by `bun test:mutate:file` (`skipped=0`) and tracked in the ratchet baseline.
- `agiles.ts` paired score rose from ~0.55 to **0.782** (baseline.json) — above the 0.68-0.72 target; `label-resource.ts` rose from ~0.45 to **0.539** — inside the 0.52-0.55 target.
- No source files changed; no new public exports; both test files pass (64 tests across the two files at verification time).

### Negative

- The accepted survivor classes (log payloads, message strings, JSON-equivalents) permanently cap both files below a perfect score; anyone reading raw Stryker output must consult the spec to know which survivors are intentional.
- `overrides.json` grows by manual entry per plugin file — generalizing the companion resolver for all `plugins/` paths is explicitly deferred (tracked in the spec).

### Risks

- Boundary-test drift: if `parseSprintTimestamp` semantics intentionally change, the `new Date` oracle may need a test-data update — mitigated by the plan's rule to fix test data, never weaken validation.
- Override-list drift as more plugin files need measurement — mitigated by the deferred resolver generalization being tracked in the spec.

## Related Decisions

- Companion work: `docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md` and the sibling update-status test-quality design (`2026-07-25-update-status-test-quality-design.md`) that established the Option A behavior-only precedent.
- ADR-0328: Stryker TypeScript-Checker Drop / TS7 Unblock — adjacent paired-mutation infrastructure work.

## References

- Plan: `docs/superpowers/plans/2026-07-25-plugin-test-quality.md`
- Spec: `docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md`
- Code: `scripts/mutation/overrides.json`, `scripts/mutation/baseline.json`, `tests/plugins/task-provider-youtrack/operations/agiles.test.ts`, `tests/plugins/task-provider-kaneo/label-resource.test.ts`
