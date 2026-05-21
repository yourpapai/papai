<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mock Isolation Guardrails Design

**Archive status:** Archived after ADR-0054 recorded the accepted direction.
This document remains the pre-ADR design exploration and is no longer the
canonical source of truth. See `docs/adr/0054-mock-isolation-guardrails.md`.

**Date:** 2026-04-11  
**Status:** Proposed  
**Scope:** Test-suite mock isolation, static guardrails, and documentation alignment

## Problem Statement

`docs/archive/mock-leakage-analysis-2026-04-11.md` captures a real historical
failure mode,
but it no longer matches the current repository.

Today the repo already has meaningful isolation controls:

- `bunfig.toml` excludes `tests/e2e/**` and `tests/client/**` from default test
  discovery.
- `package.json` runs unit tests through an explicit `bun test ...` target rather
  than relying on broad discovery.
- `tests/mock-reset.ts` restores commonly mocked modules in global hooks before
  each test.

The broad claim that "default `bun test` fails because E2E tests are loaded
without preload and unit mocks leak into them" is now stale. Current default
`bun test` runs are green.

The remaining risk is narrower:

1. Bun `mock.module()` still behaves process-globally enough that **top-level**
   registration can create order-dependent behavior.
2. The repo still has a concrete top-level offender in `tests/bot.test.ts`.
3. The stale research note can send future contributors toward the wrong fix.

This means the right design is no longer "repair a broken test split". It is
"add guardrails so the current suite stays isolated and future regressions fail
fast."

## Current State Analysis

### What already works

#### 1. E2E separation is already in place

The repo no longer relies on implicit discovery to keep E2E isolated:

- `bunfig.toml` ignores `tests/e2e/**` by default
- `package.json` exposes `bun test:e2e` with the required preload

That removes the main operational problem described in the research note.

#### 2. A reset safety net already exists

`tests/mock-reset.ts` captures real exports of commonly mocked modules at startup
and re-registers them in a global `beforeEach`. This is the current safety net
for Bun's module-mock behavior.

That safety net is valuable and should remain in place for now.

#### 3. Most current `mock.module()` usage already follows the intended pattern

Current module mocks are mostly installed inside `beforeEach` blocks or other
test-local setup, which matches the guidance in `tests/CLAUDE.md`.

### What remains risky

#### 1. Top-level `mock.module()` is still a footgun

A top-level module mock runs as soon as the file is loaded, before per-test reset
hooks execute. That is the highest-risk shape for cross-file pollution because it
is decoupled from normal test lifecycle boundaries.

#### 2. Guardrails are documentary, not executable

`tests/CLAUDE.md` already says not to call `mock.module()` at file top-level, but
there is no dedicated repo check that enforces that rule.

#### 3. The research note is now misleading

The note still frames the problem as "E2E preload + leaked Kaneo mocks". That was
useful historical context, but it is not the current failure mode contributors
need to reason about.

## Goals

1. Keep unit test execution order-independent.
2. Prevent new top-level `mock.module()` usage from landing.
3. Preserve `tests/mock-reset.ts` as a safety net during incremental cleanup.
4. Update documentation so the current source of truth reflects the current repo.
5. Complement, not replace, the longer-term dependency injection roadmap.

## Non-Goals

- Eliminating all `mock.module()` calls in this phase.
- Replacing the E2E harness or changing the Docker preload workflow.
- Deleting `tests/mock-reset.ts`.
- Building a generalized lint plugin system for all testing conventions.

## Alternatives Considered

### 1. Documentation-only update

This fixes the stale note, but it does not prevent the next top-level
`mock.module()` from landing.

### 2. Immediate full dependency injection migration

This is the best long-term end state, but it is substantially larger than the
problem at hand and overlaps with the existing DI design work.

### 3. Custom oxlint plugin first

This would work, but it adds plugin infrastructure before the rule set is large
enough to justify that complexity.

### 4. Guardrail-first static checker (recommended)

Add one narrow repo-local checker for the specific high-risk pattern, keep the
existing reset preload, and let the DI roadmap continue independently.

This gives the repo an immediate, enforceable safety boundary without overbuilding
the solution.

## Recommended Approach

Adopt a **guardrail-first mock isolation architecture** with four parts:

1. **Correct the source-of-truth docs**
2. **Ban top-level `mock.module()` with a dedicated checker**
3. **Keep `tests/mock-reset.ts` as the runtime safety net**
4. **Migrate the remaining top-level offender**

This treats the problem as a regression-prevention issue rather than a broken
runtime split.

## Design

### 1. Documentation Layer

Update `docs/archive/mock-leakage-analysis-2026-04-11.md` to mark it as
historical and link to this design.

The note should remain in the repo because it explains why the topic mattered, but
it should no longer read like the current operational diagnosis.

### 2. Static Enforcement Layer

Add a repo-local checker:

- **Proposed file:** `scripts/check-mock-isolation.ts`
- **Proposed script:** `bun run mock:isolation`

The checker should scan `tests/**/*.test.ts` and flag:

1. `mock.module()` calls with no enclosing function ancestor
2. equivalent top-level forms such as `void mock.module(...)`

The implementation should use an AST, not regex, so it can report precise
file/line locations and avoid comment/string false positives.

#### Why AST-based checking

Regex is too brittle for this rule:

- it cannot reliably distinguish module scope from hook scope
- it is noisy around comments and wrapped expressions
- it becomes hard to extend if the repo later adds related rules

An AST-based Bun script keeps the checker precise while staying lightweight.

### 3. Runtime Safety Layer

Keep `tests/mock-reset.ts` in place.

Its role in this design is explicit:

- restore commonly mocked modules before each test
- provide a safety net while the suite still contains legitimate `mock.module()`
- reduce blast radius if a test-local mock is not cleaned up as expected

This file remains a transitional control, not the primary prevention mechanism.

### 4. Targeted Cleanup Layer

Migrate `tests/bot.test.ts` so its `message-queue` module mock is registered from
test setup instead of module scope.

The design does not require a full rewrite of the test. It only requires moving
the risky registration into normal lifecycle boundaries so the reset hooks and
test guidance can do their job.

## Components

| Component                                                     | Responsibility                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/archive/mock-leakage-analysis-2026-04-11.md`            | Historical note with an explicit pointer to the accepted ADR |
| `docs/archive/mock-isolation-guardrails-design-2026-04-11.md` | Archived pre-ADR design exploration                          |
| `scripts/check-mock-isolation.ts`                             | Fail fast on top-level `mock.module()` patterns              |
| `package.json` / `scripts/check.sh`                           | Run the checker in normal verification flows                 |
| `tests/mock-reset.ts`                                         | Runtime safety net for commonly mocked modules               |
| `tests/bot.test.ts`                                           | First concrete migration target                              |

## Data Flow

### Authoring and verification flow

1. A contributor writes or edits a test file.
2. Repo verification runs `bun run mock:isolation`.
3. The checker parses test files and inspects every `mock.module()` call.
4. If a call is at module scope, the checker fails with:
   - file path
   - line number
   - a short remediation message telling the author to move the mock into
     `beforeEach` or another setup function
5. If the checker passes, normal test execution proceeds with the existing Bun
   preload and mock reset hooks.

### Failure message shape

Violations should fail loudly and specifically. Example:

```text
Top-level mock.module() is not allowed.
File: tests/bot.test.ts:19
Move this module mock into describe-level beforeEach/setup so test isolation
respects the global reset lifecycle.
```

## Integration

### Verification entry points

The checker should be wired into the same commands developers already use:

1. `bun run check`
2. `bun run check:full`
3. `bun run check:verbose`

Optionally, `bun run test` can also invoke the checker first, but the minimum
requirement is that normal repo verification and CI both enforce it.

### Relationship to `tests/CLAUDE.md`

`tests/CLAUDE.md` already documents the desired behavior:

- prefer DI over `mock.module()`
- never call `mock.module()` at file top-level

This design turns that specific rule into executable policy. The doc remains the
human explanation; the checker becomes the enforcement.

### Relationship to the DI roadmap

This design complements `2026-04-05-dependency-injection-test-refactor.md`:

- **Guardrail design:** short-term containment and regression prevention
- **DI roadmap:** long-term removal of the root cause

The two documents should coexist, with this one handling immediate safety and the
DI spec handling eventual simplification.

## Rollout Plan

### Phase 1: Align the docs

1. Mark `docs/archive/mock-leakage-analysis-2026-04-11.md` as historical
2. Add a pointer to this design spec

### Phase 2: Remove the known top-level offender

1. Refactor `tests/bot.test.ts` so its mock is no longer module-scoped
2. Verify targeted and full test runs still pass

### Phase 3: Enforce the rule

1. Add `scripts/check-mock-isolation.ts`
2. Add a package script for it
3. Wire it into repo verification and CI

### Phase 4: Reassess follow-on rules

Once the top-level rule is stable, decide whether the checker should also enforce
adjacent conventions, such as:

- discouraging redundant `afterAll(() => { mock.restore() })`
- warning when a new high-risk shared module needs a reset strategy

Those should remain follow-on decisions, not part of the initial scope.

## Testing Strategy

The eventual implementation should prove:

1. the checker catches a synthetic top-level `mock.module()` fixture
2. the checker allows hook-scoped `mock.module()` usage
3. the migrated `tests/bot.test.ts` still passes
4. `bun test` remains green

`bun test --randomize` is a useful hardening check once the implementation lands,
but it is not required to define the architecture.

## Risks and Trade-Offs

### Risk: checker is too narrow

That is acceptable in phase 1. The goal is to block the highest-risk pattern, not
to encode every test convention immediately.

### Risk: checker is too broad

Using an AST-based scope check reduces this risk. The implementation should only
flag module-scope calls, not every `mock.module()` usage.

### Trade-off: keep `tests/mock-reset.ts`

This preserves some existing complexity, but it avoids combining two large
changes:

1. guardrail rollout
2. total elimination of module mocks

That separation keeps the change reviewable and lowers migration risk.

## Acceptance Signals

This design is successful when all of the following are true:

1. the research note no longer claims current `bun test` runs fail for E2E preload
   reasons
2. the test suite has zero top-level `mock.module()` calls
3. repo verification fails immediately if a new top-level `mock.module()` is
   introduced
4. the DI roadmap remains free to continue independently
