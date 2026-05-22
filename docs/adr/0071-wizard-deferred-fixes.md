<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0071: Wizard Deferred Fixes

## Status

Accepted

## Date

2026-04-16

## Context

The wizard configuration system (ADR-0042) shipped with three known deficiencies that were deferred to avoid blocking the initial release:

1. **Masking inconsistency**: `steps.ts` had a local `maskValue` that showed short keys in full (first 4 + last 4 chars for keys > 8 chars), while `config.ts` correctly masks all sensitive keys with `****last4`. This meant short API keys could leak in chat.

2. **No step progress indicator**: Users had no way to know how many steps remained or their current position during the wizard flow.

3. **No session TTL eviction**: Abandoned wizard sessions lived in memory forever. A `cleanupExpiredWizardSessions` function existed for batch sweeps but `getWizardSession` and `hasActiveWizard` did not check TTL on access, so sessions could persist indefinitely between cleanup cycles.

## Decision Drivers

- **Consistency**: Masking logic must match the rest of the codebase
- **User experience**: Step progress reduces abandonment
- **Resource hygiene**: In-memory sessions must not accumulate without bound

## Considered Options

### Item 1 — Masking

#### Option A: Reuse `maskValue` from `config.ts` (chosen)

- **Pros**: Single source of truth for masking behavior, consistent with all other masked displays
- **Cons**: None significant

#### Option B: Fix the local `maskValue` in-place

- **Pros**: No cross-module import
- **Cons**: Duplicates logic, drift risk between `steps.ts` and `config.ts`

### Item 2 — Step Progress

#### Option A: Prepend `(n/total)` to each prompt (chosen)

- **Pros**: Minimal change, works on all platforms, session already tracks `currentStep` and `totalSteps`
- **Cons**: None significant

#### Option B: Progress bar or emoji indicator

- **Pros**: More visual
- **Cons**: Platform rendering differences, over-engineering for a short wizard

### Item 3 — Session TTL

#### Option A: TTL check on access in `getWizardSession` and `hasActiveWizard` (plan)

- **Pros**: Immediate eviction of expired sessions, no reliance on periodic cleanup
- **Cons**: Slightly more complex accessors

#### Option B: Batch-only cleanup via `cleanupExpiredWizardSessions` (current)

- **Pros**: Simpler accessors
- **Cons**: Sessions can survive indefinitely between cleanup invocations

## Decision

### Item 1: Reuse `maskValue` from `config.ts`

Remove local `maskValue` and `getMaskedValue`. Import `maskValue` from `config.js`. Introduce `getDisplayValue(key, value)` that delegates to `maskValue` for sensitive keys and returns raw values otherwise. Update `formatSummary` accordingly.

### Item 2: Prepend `(n/total)` to each prompt

In `getNextPrompt`, return `(${session.currentStep + 1}/${session.totalSteps}) ${step.prompt}`.

### Item 3: Inline TTL eviction in accessors

Add a 30-minute TTL constant and check in `getWizardSession` and `hasActiveWizard`. Expired sessions are deleted on access and treated as non-existent.

## Rationale

All three fixes address correctness or resource hygiene without changing the wizard's external contract. Masking unification eliminates a security-adjacent inconsistency. Step progress is a low-cost UX improvement. Inline TTL eviction is more robust than relying solely on periodic sweeps.

## Consequences

### Positive

- Sensitive values masked consistently across the entire codebase
- Users see wizard progress and remaining steps
- Abandoned sessions are evicted immediately on access, not just during periodic cleanup

### Negative

- Inline TTL checks add a small constant-time overhead to `getWizardSession` and `hasActiveWizard` calls

## Implementation Status

| Item                  | Status             | Evidence                                                                                                                                                                                                       |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Masking reuse         | **Done**           | `steps.ts:1` imports `maskValue` from `config.js`; `formatSummary` uses `getDisplayValue(key, ...)` at lines 119-141; no local masking functions remain                                                        |
| Step progress         | **Not done**       | `engine.ts:59-74` (`getNextPrompt`) returns plain `step.prompt` without `(n/total)` prefix                                                                                                                     |
| Session TTL on access | **Partially done** | TTL constant exists at `state.ts:180`; `cleanupExpiredWizardSessions` sweeps at `state.ts:215-233`; but `getWizardSession` (`state.ts:80-87`) and `hasActiveWizard` (`state.ts:92-99`) do not check TTL inline |

## Related Decisions

- **ADR-0042**: Bot Configuration Wizard UX — original wizard implementation
- **ADR-0045**: End-of-Wizard Validation — validation strategy for the wizard

## References

- Plan: `docs/superpowers/plans/wizard-deferred-fixes.md`
- `src/wizard/steps.ts` — step definitions and masking
- `src/wizard/engine.ts` — wizard engine and `getNextPrompt`
- `src/wizard/state.ts` — session state management and TTL cleanup
