<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0054: Guardrail-First Mock Isolation for Bun Tests

## Status

Accepted

## Date

2026-04-11

## Context

ADR-0048 introduced `tests/mock-reset.ts` as a preload-based safety net for Bun's
process-global `mock.module()` behavior. That decision addressed the broad test
pollution problem and established two key conventions:

1. restore commonly mocked modules in global hooks
2. register test-specific module mocks in lifecycle setup, not at module scope

Since then, the repository has evolved:

- `bunfig.toml` excludes `tests/e2e/**` and `tests/client/**` from default test
  discovery
- `package.json` uses explicit unit-test entry points
- current `bun test` runs are green

This means the earlier framing of the issue as "default E2E preload breakage plus
mock leakage" is now historical rather than current.

The remaining active risk is narrower:

- top-level `mock.module()` remains possible and can bypass normal test lifecycle
  isolation
- `tests/bot.test.ts` still contains a module-scope `mock.module()` registration
- the rule against top-level `mock.module()` is documented, but not enforced by a
  dedicated repo check

At the same time, the research note and design spec for this work are useful
background, but they are not the right long-term home for the decision itself.

## Decision Drivers

- **Must preserve order-independent test execution**
- **Must fail fast on new top-level `mock.module()` usage**
- **Must keep the existing preload safety net during transition**
- **Should separate historical exploration from the durable decision record**
- **Should complement ADR-0048 instead of replacing it**
- **Should leave room for the longer-term DI migration path**

## Considered Options

### Option 1: Keep the research note and design spec as the primary record

- **Pros:** No new ADR work; existing material already written
- **Cons:** Splits the decision across exploratory documents; stale framing can
  persist; no clear durable record of the accepted direction
- **Verdict:** Rejected

### Option 2: Immediate full dependency injection migration

- **Pros:** Removes the root cause by eliminating module-level mocking
- **Cons:** Much larger change than the current problem requires; overlaps with
  existing longer-term DI work; does not provide a short-term guardrail
- **Verdict:** Rejected for this phase

### Option 3: Custom lint/plugin solution first

- **Pros:** Strong enforcement path; potentially reusable for future rules
- **Cons:** Adds infrastructure before the repo has validated that a single narrow
  checker is insufficient
- **Verdict:** Deferred

### Option 4: Guardrail-first approach with archived supporting docs (Selected)

- **Pros:** Matches the current risk surface; preserves the proven preload safety
  net; creates a durable ADR; allows narrow enforcement before larger refactors
- **Cons:** Keeps some transitional complexity (`tests/mock-reset.ts`) in place;
  requires a follow-up implementation to add the checker and migrate the
  remaining offender
- **Verdict:** Accepted

## Decision

We will adopt a **guardrail-first mock isolation strategy**:

1. **Use this ADR as the canonical decision record**
2. **Archive the research note and pre-ADR design spec** under `docs/archive/`
3. **Keep `tests/mock-reset.ts`** as the runtime safety net during the transition
4. **Add an AST-based `scripts/check-mock-isolation.ts` checker** that fails on
   top-level `mock.module()` usage in `tests/**/*.test.ts`
5. **Wire the checker into normal verification flows** (`check`, `check:full`,
   `check:verbose`)
6. **Migrate the remaining known top-level offender** in `tests/bot.test.ts` into
   test lifecycle setup

## Rationale

The current repository no longer needs a broad fix for default E2E discovery.
What it needs is a precise protection against the highest-risk remaining pattern:
module-scope `mock.module()`.

A guardrail-first approach is the best fit because it:

1. keeps the already-proven preload reset from ADR-0048
2. adds explicit enforcement for the riskiest remaining pattern
3. avoids expanding scope into a full DI migration prematurely
4. turns exploratory design work into a durable architectural record

## Consequences

### Positive

- The architectural decision now has a single durable home in `docs/adr/`
- Historical analysis and design exploration are preserved without remaining the
  primary source of truth
- The repo retains the working safety net from ADR-0048
- The intended follow-up work is clear: narrow checker first, broader DI later

### Negative

- The final enforcement is still follow-up work; this ADR does not implement it
  by itself
- `tests/mock-reset.ts` remains transitional infrastructure that must be
  maintained
- Contributors still need both documentation and verification wiring until the
  checker lands

### Risks

- **Risk:** The checker is too narrow and misses adjacent isolation problems
  - **Mitigation:** Start with the highest-risk pattern; extend only if the repo
    accumulates evidence for additional rules

- **Risk:** Contributors assume the archived spec is still the live source of
  truth
  - **Mitigation:** Add explicit archive notices pointing back to this ADR

- **Risk:** The remaining top-level offender persists longer than intended
  - **Mitigation:** Track it explicitly in the ADR and implementation follow-up

## Implementation Status

**Partially Implemented**

### Present in the codebase today

- `tests/mock-reset.ts` exists as the preload-based runtime safety net
- `bunfig.toml` preloads `tests/mock-reset.ts` and excludes E2E/client tests from
  default discovery
- this ADR now exists as the canonical decision record
- the earlier research note and design spec are archived as supporting material

### Not yet implemented

- `scripts/check-mock-isolation.ts` does not exist yet
- `package.json` verification scripts do not yet run a dedicated mock-isolation
  checker
- `tests/bot.test.ts` still contains the known top-level `mock.module()` call

## Related Decisions

- [ADR-0048](0048-global-mock-reset-preload.md) — established the preload reset
  safety net this ADR keeps in place
- [ADR-0044](0044-rename-mock-pollution-to-test-health.md) — adjacent test-health
  enforcement work

## References

- Archived historical note:
  `docs/archive/mock-leakage-analysis-2026-04-11.md`
- Archived pre-ADR design exploration:
  `docs/archive/mock-isolation-guardrails-design-2026-04-11.md`
- Existing runtime safety net: `tests/mock-reset.ts`
- Remaining top-level offender: `tests/bot.test.ts`
