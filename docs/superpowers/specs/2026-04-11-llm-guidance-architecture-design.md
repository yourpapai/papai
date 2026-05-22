<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# LLM Guidance Architecture Design

**Date:** 2026-04-11  
**Status:** Proposed  
**Scope:** Repo-wide AI guidance ownership, scoped instruction architecture, static enforcement, and rollout

## Problem Statement

`docs/research/llm-guidance-research.md` correctly identifies the core papai problem: at this repo size, LLMs drift toward generic patterns unless they are guided by project-specific conventions and backed by hard guardrails.

The research's main recommendation was:

1. Add path-scoped instruction files so rules load only when relevant.
2. Add static enforcement so repeated drift patterns fail fast.

That direction is still correct, but papai is no longer starting from zero. The repository already has:

- path-scoped Copilot instructions in `.github/instructions/*.instructions.md`
- path-local `CLAUDE.md` files under `src/` and `tests/`
- a root `CLAUDE.md` with broad project guidance
- strong generic linting and TDD enforcement hooks

The remaining problem is now **architecture drift**, not missing architecture:

1. Guidance is split across multiple surfaces with overlapping ownership.
2. Some guidance is already stale or contradictory.
3. Repo-specific drift patterns are documented, but not enforced by oxlint.
4. There is no explicit promotion path from "soft guidance" to "hard guardrail".

## Current State Analysis

### What Already Exists

#### 1. Scoped instruction loading is already implemented

The repo already ships path-scoped instruction files for the main code areas:

- `src/**` general rules
- `src/providers/**`
- `src/tools/**`
- `src/commands/**`
- `src/chat/**`
- `tests/**`
- `tests/e2e/**`
- `src/**` TDD workflow

This means the research's highest-priority recommendation has already been partially executed.

#### 2. Claude-specific scoped guidance also exists

The repo also maintains path-local `CLAUDE.md` files in:

- `src/chat/`
- `src/commands/`
- `src/providers/`
- `src/tools/`
- `tests/`

This gives good tool coverage, but also creates a second scoped-guidance surface that can drift from `.github/instructions/`.

#### 3. Strong generic enforcement already exists

`.oxlintrc.json` already enables strict correctness, suspicious, pedantic, perf, and TypeScript rules. The repo also has TDD hooks that gate implementation edits and run targeted tests. This is already a serious guardrail system.

### What Is Missing

#### 1. No repo-specific lint enforcement for known drift patterns

The current oxlint config has no `no-restricted-imports`, no `no-restricted-syntax`, and no JS plugin rules for papai-specific conventions. The research's "hard guardrail" half is still mostly unimplemented.

#### 2. Guidance drift already exists

There is at least one concrete contradiction today:

- `tests/CLAUDE.md` still instructs authors to add `afterAll(() => { mock.restore() })` and run `bun run mock-pollution`
- `tests/mock-reset.ts` already restores commonly mocked modules in global hooks
- `package.json` has no `mock-pollution` script

This is exactly the kind of drift the research warned about: correct local patterns exist, but the instruction surfaces no longer describe them consistently.

#### 3. Preferred helpers are not enforced

The repo has explicit fetch helpers:

- `setMockFetch()` in `tests/utils/test-helpers.ts`
- `restoreFetch()` in `tests/utils/test-helpers.ts`

But there is no lint rule preventing inline `globalThis.fetch = ...` assignments outside the helper module.

#### 4. Known risky patterns are not promoted to hard rules

The repo already has a known risky module-mocking pattern in `tests/bot.test.ts`:

```typescript
void mock.module('../src/message-queue/index.js', () => ({ ... }))
```

This class of test pollution is documented as risky, but there is no enforcement layer that discourages or constrains it.

## Goals

1. Preserve the benefits of scoped AI guidance without adding another monolithic instruction file.
2. Define clear ownership for each guidance surface so rules stop drifting.
3. Add a rule-promotion path from "documented convention" to "lint-enforced policy".
4. Enforce the highest-value papai-specific drift patterns in oxlint.
5. Keep the system lightweight enough to maintain without a full code generation pipeline.

## Non-Goals

- Replacing the existing TDD hook system.
- Eliminating all duplication between Copilot and Claude guidance files.
- Building a full instruction-file generator in this phase.
- Encoding every convention as a lint rule.
- Solving prompt quality globally for all future AI tools in one pass.

## Recommended Approach

Adopt a **consolidate-and-enforce** architecture:

1. Keep the existing scoped guidance structure.
2. Make guidance ownership explicit.
3. Add a lightweight guidance inventory so rules have one canonical home.
4. Promote the most expensive recurring mistakes into lint rules.

This avoids both extremes:

- not enough structure (current drift risk)
- too much machinery (full generated guidance system)

## Design

### 1. Guidance Layers and Ownership

Define four distinct guidance layers:

| Layer                     | Purpose                       | Canonical content                 | Examples                                 |
| ------------------------- | ----------------------------- | --------------------------------- | ---------------------------------------- |
| Root project context      | Repo-wide facts and workflows | Global project facts only         | `CLAUDE.md`                              |
| Shared scoped guidance    | Cross-tool rules by path      | Path-scoped conventions           | `.github/instructions/*.instructions.md` |
| Tool-specific supplements | Tool/runtime-specific caveats | Only deltas and operational notes | `src/**/CLAUDE.md`, `tests/CLAUDE.md`    |
| Hard enforcement          | Non-negotiable conventions    | Executable rules                  | `.oxlintrc.json`, `lint-plugins/`        |

#### Ownership Rules

##### Root `CLAUDE.md`

Keep only content that is genuinely repo-wide:

- project overview
- commands
- architecture summary
- global testing commands
- cross-cutting workflow rules

Do **not** let root `CLAUDE.md` become the canonical home for path-specific testing, provider, tool, or chat rules.

##### `.github/instructions/*.instructions.md`

These become the canonical home for **shared path-specific conventions**. They are the main place to describe:

- allowed patterns
- disallowed patterns
- preferred helpers
- naming and structure rules
- scope-specific examples

These files are already present, so the design is evolutionary rather than additive.

##### Path-local `CLAUDE.md`

These become **supplement files**, not parallel rulebooks. They may contain:

- Claude-specific workflow caveats
- tool-behavior notes
- local examples that help Claude use the shared rules correctly

They should avoid re-documenting general conventions unless the duplication is intentional and justified by Claude-specific behavior.

### 2. Guidance Inventory

Add a small neutral inventory document to track guidance rules and their enforcement status.

**Proposed file:** `docs/guides/ai-guidance-inventory.md`

Each rule entry should include:

- rule ID
- scope
- short statement
- preferred alternative
- source of truth
- enforcement level
- promotion notes

Example shape:

```markdown
## TEST-001 — Use fetch helpers

- Scope: `tests/**`
- Rule: Do not assign to `globalThis.fetch` outside `tests/utils/test-helpers.ts`
- Preferred alternative: `setMockFetch()` / `restoreFetch()`
- Source of truth: `.github/instructions/testing.instructions.md`
- Enforcement: lint
- Notes: promoted after repeated inline fetch mocks
```

This inventory is intentionally lightweight. It is not a generator input. Its job is to stop semantic drift and make rule promotion explicit.

### 3. Rule Promotion Lifecycle

Adopt an explicit lifecycle for conventions:

1. **Observation** — a drift pattern appears in reviews or AI-generated code.
2. **Soft guidance** — add the rule to the relevant scoped instruction file.
3. **Stabilization** — if the rule persists and the preferred alternative is clear, record it in the inventory.
4. **Hard enforcement** — add a native oxlint rule or custom plugin rule.
5. **Maintenance** — keep docs and enforcement aligned whenever the preferred pattern changes.

This creates a repeatable path from "we keep telling the model this" to "the build enforces it".

### 4. Static Enforcement Strategy

#### Native oxlint first

Use native oxlint rules where they are expressive enough:

- `no-restricted-imports`
- `no-restricted-syntax`
- path-specific `overrides`

This should be the default because it minimizes maintenance burden.

#### Custom JS plugin second

Use a small repo-local plugin only for rules that need AST logic beyond native config.

**Proposed directory:** `lint-plugins/`  
**Proposed plugin:** `lint-plugins/papai-conventions.js`

Initial candidate rules:

1. **`papai-conventions/no-inline-fetch-mock`**  
   Ban `globalThis.fetch = ...` and `global.fetch = ...` outside helper modules.

2. **`papai-conventions/no-top-level-mock-module`**  
   Ban top-level `mock.module()` calls in test files so mocks must be installed in `beforeEach`.

3. **`papai-conventions/no-redundant-mock-restore`**  
   Ban `afterAll(() => { mock.restore() })` in normal test files because global reset already handles it.

These rules directly target the repo's current pain points rather than generic style opinions.

### 5. Initial Enforcement Backlog

#### Phase 1: Highest-value rules

| Rule                                               | Type                           | Why first                                          |
| -------------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| Ban inline fetch reassignment outside helpers      | JS plugin or restricted syntax | Helper already exists and misuse is easy to detect |
| Ban top-level `mock.module()` in tests             | JS plugin                      | Prevents a known source of mock pollution          |
| Ban stale `afterAll(mock.restore)` cleanup pattern | JS plugin or restricted syntax | Current docs already drift on this point           |

#### Phase 2: Structural restrictions

| Rule                                                        | Type                           | Why later                                           |
| ----------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| Restrict broad module-mock targets                          | restricted syntax or JS plugin | Valuable but needs careful allowlisting             |
| Prefer DI over module mocks where a `Deps` interface exists | documentation first            | Harder to enforce correctly without false positives |

### 6. Documentation Realignment

As part of the architecture rollout, update the current guidance surfaces to remove contradictions.

Priority realignment targets:

1. `tests/CLAUDE.md`
2. `.github/instructions/testing.instructions.md`
3. root `CLAUDE.md`
4. other path-local `CLAUDE.md` files that duplicate shared scoped rules

The goal is not zero duplication. The goal is **intentional duplication with one canonical owner per rule**.

### 7. Validation and CI

Use the repo's existing verification flow:

- `bun lint`
- `bun test`
- `bun run check:full`

This design does not introduce a new CI lane. It extends the lint layer already used by local development and CI.

### 8. Relationship to Existing TDD Hooks

This architecture complements the existing TDD hook pipeline:

- TDD hooks protect behavioral changes during implementation edits
- scoped instructions steer the model toward local conventions
- oxlint catches conventions that are cheap to express statically

Together they form a layered defense:

1. **Prompt-time guidance**
2. **Edit-time TDD gates**
3. **Lint-time repo-specific enforcement**

## Implementation Outline

### Phase 1: Ownership and drift cleanup

1. Add `docs/guides/ai-guidance-inventory.md`
2. Trim root `CLAUDE.md` to repo-wide content
3. Update `tests/CLAUDE.md` to match actual mock-reset and helper behavior
4. Review each scoped `CLAUDE.md` against its matching `.instructions.md`

### Phase 2: Hard guardrails

1. Add test-specific oxlint overrides
2. Add `lint-plugins/papai-conventions.js`
3. Implement the three highest-value rules
4. Document each enforced rule in the inventory

### Phase 3: Promotion workflow

1. Add a lightweight checklist for promoting new rules
2. Review repeated review comments quarterly or after major AI-assisted work
3. Promote only conventions with a stable preferred alternative

## Files Expected to Change in Implementation

| File                                           | Purpose                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `CLAUDE.md`                                    | reduce overlap and keep only repo-wide guidance                 |
| `tests/CLAUDE.md`                              | remove stale mock-restoration guidance                          |
| `.github/instructions/testing.instructions.md` | align with canonical testing conventions                        |
| `.github/instructions/*.instructions.md`       | apply ownership cleanup where needed                            |
| `.oxlintrc.json`                               | add test-specific restricted syntax/import/plugin configuration |
| `lint-plugins/papai-conventions.js`            | add repo-specific lint rules                                    |
| `docs/guides/ai-guidance-inventory.md`         | track rule ownership and enforcement status                     |

## Success Criteria

This design succeeds when:

1. The repo has one clear canonical owner for each major AI guidance rule.
2. The current contradictions in testing guidance are removed.
3. At least the highest-value recurring drift patterns fail lint.
4. New conventions can move from "advice" to "enforced policy" through a documented workflow.
5. Guidance remains scoped and lightweight rather than collapsing back into one giant rule file.

## Risks and Mitigations

| Risk                                               | Impact                           | Mitigation                                                |
| -------------------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| Too much duplication remains                       | Guidance drifts again            | Use the inventory and explicit ownership rules            |
| Too many lint rules create friction                | Contributors fight the tooling   | Promote only rules with clear preferred alternatives      |
| Custom plugin maintenance cost grows               | Enforcement becomes brittle      | Prefer native oxlint rules first                          |
| Claude and Copilot need slightly different wording | Perfect sync becomes unrealistic | Keep semantics aligned, not necessarily identical wording |

## Recommendation

Proceed with the **consolidate-and-enforce** approach.

The repo already proved that scoped guidance is valuable. The next high-leverage step is to:

1. clean up ownership
2. fix current documentation drift
3. add a small set of papai-specific lint rules

That delivers the research's main insight in a form that matches papai's current maturity: **instructions guide the model, enforcement catches what guidance misses**.
