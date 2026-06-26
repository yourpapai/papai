<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0207: Remove the Cross-Thread Memory Feature Flag

## Status

Implemented

## Date

2026-06-18

## Context

The cross-thread memory bridge — provisional memory capture, the `recall` tool, and provisional→active promotion — shipped behind an experimental `crossThreadMemory` flag in `ReductionFlags` (key `cross_thread_memory` inside the per-context `tool_context_flags` JSON, default `false`), resolved via `resolveCrossThreadMemoryFlag(storageContextId)`. The flag gated exactly two things: provisional capture (`armMemoryCapture` in `capture-debounce.ts` and `runMemoryCapture` in `capture.ts` both bailed at a `flagEnabled` check, so `markActivity` never ran and the `memory_extraction_state` watermark stayed empty) and `recall` tool registration in `provider-independent-tools-builder.ts` (registered only when the flag was on plus `mode === 'normal'`). Everything downstream — the `memory-capture-sweep` / `memory-promotion-sweep` jobs (registered unconditionally in `scheduler-instance.ts`), `promotion.ts`, `recall-cascade.ts`, and the `MEMORY_RECALL` system-prompt fragment (gated by `requiredTools: ['recall']`) — was not directly flag-gated; it was merely inert because no provisional rows ever existed.

The default-off posture meant group threads never accumulated provisional memory and `recall` was absent, so the bridge's core value — not rediscovering recurring facts in every new thread of a group — never materialized without per-context operator opt-in. Worse, the `TOOL_CONTEXT_REDUCTION_DISABLED` env kill switch forced the flag OFF alongside the three reduction flags, coupling memory capture to an unrelated global switch.

The 2026-06-18 design (`docs/superpowers/specs/2026-06-18-remove-cross-thread-memory-flag-design.md`) retired the flag and made provisional capture, `recall`, and promotion the always-on default, with the existing per-context "Disable capture" memory-profile toggle (`profile?.enabled === false` in `capture.ts`) becoming the only off switch. That spec is the source of truth for the architecture described here.

## Decision Drivers

- **Default value delivery.** The bridge's benefit (recurring facts captured and recalled across a group's threads) only materializes when capture runs by default; gating it behind per-context opt-in defeated the feature.
- **A single, well-scoped off switch.** Operators needed a clear per-context way to disable capture (cost/privacy) without a global flag tangled with the unrelated reduction flags.
- **Decoupling from the reduction kill switch.** `TOOL_CONTEXT_REDUCTION_DISABLED` should govern only the three reduction flags, not memory capture.
- **Atomic UI removal.** `FlagsSchema` is `.strict()`, so the server- and client-side flag removal had to ship together to avoid PATCH 422 drift.
- **Minimal blast radius downstream.** The scheduler sweeps, promotion, recall-cascade, and system-prompt fragment needed no logic change — only capture writing rows unlocks them.
- **TDD-friendly ordering.** The write-hook-enforced Red→Green→Refactor loop required a 3-move sequence (transitional test edit → impl edit → cleanup) per affected file to keep mapped tests green across the field removal, since Bun's test runner transpiles without typechecking.

## Considered Options

### Option A — Remove the flag entirely (chosen)

- **Pros:** Single source of truth; capture/recall/promotion always-on; fewer config surfaces; the per-context "Disable capture" toggle is the only off switch; downstream code unchanged.
- **Cons:** Every group thread now incurs ongoing SMALL_MODEL capture cost; contexts that opted out via the flag begin capturing (intended, but surfaced in release notes).

### Option B — Flip the default to ON but keep the flag

- **Pros:** Preserves a global opt-out without per-context toggling; no behavior change for already-configured-off contexts.
- **Cons:** Retains the dead resolver, the `flagEnabled` dep threading, and the four-key `ReductionFlags`/`FlagsSchema`/UI surface; does not decouple from the reduction kill switch; leaves the bridge half-experimental.

### Option C — Add a dedicated `MEMORY_CAPTURE_DISABLED` global env

- **Pros:** A single global emergency switch distinct from the reduction kill switch.
- **Cons:** Redundant with the per-context "Disable capture" toggle; adds a new global knob to document and reason about; rejected in the spec in favor of the existing per-context toggle.

## Decision

Six coordinated changes implement the architecture:

### 1. Flag deletion — `src/tools/feature-flags.ts`

Removed `crossThreadMemory` from the `ReductionFlags` interface, the `ALL_OFF` sentinel, and the `parseReductionFlagsJson` key read. Deleted `resolveCrossThreadMemoryFlag` entirely. `ReductionFlags` now declares exactly three booleans (`progressiveDisclosure`, `resultCompaction`, `semanticToolRetrieval`); `TOOL_CONTEXT_REDUCTION_DISABLED` governs only those three.

### 2. Always-on capture — `src/long-term-memory/capture.ts` + `capture-debounce.ts`

Removed `flagEnabled` from `RunMemoryCaptureDeps` / `ArmCaptureDeps` and their `defaultDeps`, and deleted the guards in `runMemoryCapture` and `armMemoryCapture`. The `contextType === 'group'` + `hasThreadContextId` guard (in `capture.ts`) and the `contextType !== 'group'` guard (in `capture-debounce.ts`) remain. The `profile?.enabled === false` skip in `capture.ts` — the per-context "Disable capture" toggle — is now the only off switch for capture.

### 3. Unconditional `recall` registration — `src/tools/provider-independent-tools-builder.ts`

Dropped `resolveCrossThreadMemoryFlag` from the import. `recall` now registers whenever `contextId !== undefined && contextType !== undefined && mode === 'normal'` (group and dm), no flag. Proactive mode still omits it. The `MEMORY_RECALL` system-prompt fragment auto-appears via `requiredTools: ['recall']`; no system-prompt change.

### 4. No change downstream — promotion / sweeps / cascade / trigger

`promotion.ts`, `promotion-sweep.ts`, `recall-cascade.ts`, `capture-sweep.ts`, `llm-history.ts`, `scheduler-instance.ts`, `system-prompt.ts`, and `recall.ts` are unchanged. They activate on their own once capture writes provisional rows. "Disable capture" gates only new capture: when off, no new provisional rows form, but existing provisional/active records remain, `recall` still works, and promotion can still promote already-captured clusters.

### 5. Admin/settings UI removal (atomic — `FlagsSchema` is `.strict()`)

Removed `cross_thread_memory` from `src/debug/admin-feature-flags.ts` (`AdminFlagState` + `toWire`), `src/debug/settings/admin/feature-flags-routes.ts` (`FlagsSchema`), `client/admin/feature-flags-fetcher-schemas.ts`, and `client/settings/sections/admin/AdminFeatureFlagsSection.svelte` (`FLAG_KEYS` + `FLAG_LABELS`). Three toggles remain: Compaction, Disclosure, Semantic retrieval. The kill-switch banner and `killSwitchEngaged` snapshot field stay (they govern the remaining three flags).

### 6. Tests + documentation

Deleted `tests/tools/feature-flags-cross-thread.test.ts` and `tests/long-term-memory/flag-off-parity.test.ts`. Edited the field-drop and registration-parity tests across `feature-flags.test.ts`, `provider-independent-tools-builder.test.ts`, the orchestrator stubs, the debug/admin and client suites, and `stop-rediscovering.acceptance.test.ts`. Rewrote the `CLAUDE.md` "Cross-thread memory bridge" section to non-experimental, always-on; trimmed the four-flags enumeration to three.

## Consequences

### Positive

- The cross-thread memory bridge's value — recurring facts captured and recalled across a group's threads — now materializes in every deployment without per-context opt-in.
- One off switch remains (per-context "Disable capture"), removing a global flag tangled with the unrelated reduction flags.
- `ReductionFlags`, `FlagsSchema`, and the admin UI shrink from four to three flags, reducing surface area.
- Downstream code (sweeps, promotion, cascade, prompt) needed no logic change — only capture writing rows unlocks them.
- `recall` is available in `normal` mode for both dm and group contexts unconditionally.

### Negative

- Every group thread now incurs ongoing SMALL_MODEL capture (10-min debounce + 5-min idle sweep) and promotion confirms (30-min sweep), increasing LLM cost for all deployments with group chats. Intended; mitigated by the per-context toggle and the idle/debounce design that avoids per-turn extraction.
- Contexts that previously opted out via `cross_thread_memory: false` begin capturing; reversible per-context via the "Disable capture" toggle, but surfaced in release notes.
- The `recall`/`search_memory` overlap in DMs is pre-existing and behavior-preserving here; consolidating them is explicitly out of scope.

### Risks

- **`.strict()` schema drift** between server and client during the UI removal would cause PATCH 422s; mitigated by changing all four UI surfaces in one commit.
- **No config migration.** Stale `cross_thread_memory` keys in stored `tool_context_flags` JSON are silently ignored by the parser (intended). Contexts that had explicitly set it `false` begin capturing — the intended new default — and can opt out via the toggle.
- **Cost increase for all group-chat deployments.** Intended consequence of "make ON the default"; opt-out is per-context.

## Related Decisions

- ADR-0193: Long-Term Memory — the long-term store this bridge extends.
- ADR-0199: Memory Foundation — Provisional Store, Capture, and Semantic Search — the provisional capture + semantic search this makes default-on.
- ADR-0200: Recall Cascade and Promotion — the recall cascade and promotion this unlocks.
- ADR-0195: Admin Feature Flags Section — the admin UI surface this trims from four to three flags.
- ADR-0201: Scope Corrections and Declarative Registry — the declarative scope model the memory entities comply with.

## Implementation Notes

Confirmed against the source tree after execution:

- `src/tools/feature-flags.ts`: `ReductionFlags` declares exactly three boolean fields; `ALL_OFF` and `parseReductionFlagsJson` match; `resolveCrossThreadMemoryFlag` is absent.
- `src/long-term-memory/capture.ts` + `capture-debounce.ts`: no `flagEnabled` member in `RunMemoryCaptureDeps` / `ArmCaptureDeps`; no `flagEnabled` references anywhere under `src/long-term-memory/`.
- `src/debug/admin-feature-flags.ts` + `src/debug/settings/admin/feature-flags-routes.ts`: `AdminFlagState` / `toWire` / `FlagsSchema` carry three flags.
- `client/settings/sections/admin/AdminFeatureFlagsSection.svelte`: `FLAG_KEYS` is `['result_compaction', 'progressive_disclosure', 'semantic_tool_retrieval']` (three).
- `tests/tools/feature-flags-cross-thread.test.ts` and `tests/long-term-memory/flag-off-parity.test.ts` are deleted (absent on disk).
- No dangling references: a repo-wide sweep for `crossThreadMemory` / `cross_thread_memory` / `resolveCrossThreadMemoryFlag` across `src`, `client`, and `tests` returns zero matches.
- Plan and spec archived under `docs/archive/2026-06-18-remove-cross-thread-memory-flag.md` and `docs/archive/2026-06-18-remove-cross-thread-memory-flag-design.md`.
