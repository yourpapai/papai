<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0044: Rename Mock-Pollution to Test-Health

## Status

Accepted

## Context

The `check-mock-pollution.ts` script was originally designed to detect `mock.module()` pollution patterns that cause test flakiness. The script name and documentation implied a narrow scope focused only on mock pollution.

As the project evolved, we identified a related class of test pollution issues: **module-level mutable state** that persists between tests. Examples in the codebase include:

- `const stats = { totalMessages: 0, ... }` in `state-collector.ts`
- `const clients = new Set<ReadableStreamDefaultController>()` in `state-collector.ts`
- `const recentLlm: LlmTrace[] = []` in `state-collector.ts`
- `const pendingTraces = new Map<string, PendingLlmTrace>()` in `state-collector.ts`

These stateful constructs, if not properly reset between tests, can cause:

1. Test interdependence (test order matters)
2. State leakage between tests
3. Flaky tests that pass in isolation but fail in the full suite

The original plan included implementing "Pattern 4" detection for module-level mutable state. However, initial implementation attempts revealed challenges with false positives — legitimate state cleanup via test helpers (like `resetStats()` in `tests/utils/test-helpers.ts`) was difficult to reliably detect via AST analysis.

### Decision Drivers

- **Rename reflects actual scope** — The script detects test health issues, not just mock pollution
- **Naming clarity** — `test-health` is more intuitive for developers than `mock-pollution`
- **Package.json consistency** — Script name should match its purpose in the verbose check pipeline
- **Avoid false positives** — Module-level state detection proved unreliable; better to remove than mislead

## Considered Options

### Option 1: Keep Name, Add State Detection

**Approach**: Retain `check-mock-pollution.ts` name and implement Pattern 4 detection.

- **Pros**: No renaming effort, backward compatible
- **Cons**: Name doesn't reflect broader scope, state detection has false positive issues
- **Verdict**: Rejected — false positives in state detection would reduce trust in the tool

### Option 2: Rename and Implement State Detection with Fixes

**Approach**: Rename to `check-test-health.ts` and invest in fixing state detection false positives.

- **Pros**: Accurate name, comprehensive detection
- **Cons**: High complexity—requires detecting indirect cleanup via test helpers, transitive state references, and WeakMap/WeakSet exclusions
- **Verdict**: Rejected — effort outweighs benefit; simpler to document state cleanup patterns elsewhere

### Option 3: Rename, Remove State Detection (Chosen)

**Approach**: Rename to `check-test-health.ts`, remove Pattern 4 from documentation, keep scope limited to mock pollution.

- **Pros**: Clear naming, focused scope, no false positives, maintainable codebase
- **Cons**: Module-level state pollution not mechanically detected
- **Verdict**: Accepted — best balance of clarity and reliability

### Option 4: Split into Separate Tools

**Approach**: Keep `check-mock-pollution.ts` and create separate `check-test-state.ts`.

- **Pros**: Single responsibility per tool
- **Cons**: Two tools to maintain, run, and document; state detection complexity remains
- **Verdict**: Rejected — unnecessary fragmentation for the current codebase size

## Decision

We will rename the script and its supporting directory from `check-mock-pollution` to `check-test-health`, update all imports and package.json scripts, and remove Pattern 4 (module-level mutable state detection) from the scope. The script will focus exclusively on mock pollution patterns (Patterns 1-3).

## Implementation

### Files Changed

1. **Renamed**: `scripts/check-mock-pollution.ts` → `scripts/check-test-health.ts`
2. **Renamed**: `scripts/check-mock-pollution/` → `scripts/check-test-health/`
3. **Updated**: Import paths in the main script
4. **Updated**: `package.json` scripts section:
   - `"test-health": "bun run scripts/check-test-health.ts --strict"`
   - `"check:verbose": "bun run --parallel lint typecheck format:check knip test duplicates test-health"`
5. **Updated**: Header comment to remove Pattern 4 documentation

### Detected Patterns (Final Scope)

| Pattern   | Severity | Description                                                          |
| --------- | -------- | -------------------------------------------------------------------- |
| PATTERN 1 | HIGH     | Barrel mock: mocking a barrel file corrupts sub-module live bindings |
| PATTERN 2 | MEDIUM   | Shared module mocked without cleanup                                 |
| PATTERN 3 | HIGH     | Transitive mock pollution via indirect imports                       |

## Consequences

### Positive

- **Clear naming** — `test-health` accurately describes the script's purpose
- **Focused scope** — No false positives from incomplete state detection
- **Maintainable** — Simpler codebase without complex AST analysis for state tracking
- **Consistent** — Script name matches package.json script name

### Negative

- **No mechanical detection** — Module-level mutable state must be caught via code review
- **Documentation burden** — State cleanup patterns must be documented elsewhere

### Risks and Mitigations

| Risk                              | Mitigation                                                      |
| --------------------------------- | --------------------------------------------------------------- |
| Developers expect state detection | Clear documentation in header comment lists only 3 patterns     |
| State pollution not caught        | Document state cleanup patterns in testing guidelines           |
| Breaking change for muscle memory | Update all references; `mock-pollution` script removed entirely |

## Related Decisions

- [ADR-0017](0017-mutation-testing-strykerjs.md) — Test quality enforcement (complementary)
- [ADR-0021](0021-fix-false-confidence-tests.md) — Test reliability improvements (context)

## References

- Implementation: `scripts/check-test-health.ts`, `scripts/check-test-health/`
- Plan: `docs/plans/done/2026-03-30-rename-mock-pollution-to-test-health.md`
- Testing guidelines: `tests/CLAUDE.md` (section on mock pollution prevention)
