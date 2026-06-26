<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remove the `cross_thread_memory` feature flag (make the behavior default-on)

Date: 2026-06-18
Status: Approved (design)

## Goal

Retire the experimental `cross_thread_memory` feature flag and make its behavior — provisional
memory capture, the `recall` tool, and provisional→active promotion — the **always-on default**.
Remove the old flag-gated/off behavior entirely.

## Background: what the flag gates today

The flag is `crossThreadMemory` in `src/tools/feature-flags.ts` (key `cross_thread_memory` inside
the per-context `tool_context_flags` JSON, default `false`), resolved via
`resolveCrossThreadMemoryFlag(storageContextId)`. The `TOOL_CONTEXT_REDUCTION_DISABLED=true` env
kill switch currently forces it OFF along with the three reduction flags.

The flag gates exactly two things:

1. **Provisional capture** — `armMemoryCapture` (`capture-debounce.ts:51`) and `runMemoryCapture`
   (`capture.ts:105`) both bail at a `flagEnabled` check. When off, `markActivity` never runs, so
   the `memory_extraction_state` watermark stays empty and the unconditionally-registered
   `memory-capture-sweep` is a silent no-op. No provisional rows are ever written.
2. **`recall` tool registration** — `provider-independent-tools-builder.ts:120-127` registers
   `recall` only when the flag is on (plus `mode === 'normal'`).

Everything downstream is **not** directly flag-gated and needs no logic change:

- `memory-capture-sweep` / `memory-promotion-sweep` are registered unconditionally in
  `scheduler-instance.ts`; they are inert today only because no provisional rows exist.
- `promotion.ts` / `promotion-sweep.ts` / `recall-cascade.ts` operate on whatever provisional
  records exist; they never read the flag.
- The `MEMORY_RECALL` system-prompt fragment is gated by `requiredTools: ['recall']`
  (`system-prompt.ts:161`), so it appears automatically once `recall` is registered.

### ON vs OFF behavior summary

| Path                              | OFF (current default)                  | ON                                                                                                  |
| --------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Provisional capture               | bails at flag check; zero rows written | group+threaded contexts: debounced SMALL_MODEL extraction writes provisional, thread-tagged records |
| Capture-sweep (5 min)             | registered but inert (empty watermark) | re-runs capture on idle dirty group contexts                                                        |
| `recall` tool                     | not registered                         | registered in `normal` mode (dm + group)                                                            |
| System prompt                     | `MEMORY_RECALL` absent (requiredTools) | present                                                                                             |
| Promotion (30 min sweep + inline) | inert (no provisional rows)            | clusters ≥3 threads, SMALL_MODEL-confirms, promotes to active                                       |
| `search_memory`                   | unchanged                              | unchanged                                                                                           |

## Decisions

- **Kill switch:** decouple memory capture from `TOOL_CONTEXT_REDUCTION_DISABLED`. After removal,
  that env governs only the remaining three reduction flags. The **only** off switch for memory
  capture is the existing per-context "Disable capture" memory-profile toggle
  (`setMemoryCaptureEnabled` / `capture.ts:110` `profile?.enabled === false`).
- **Cost acceptance:** default-on means every group thread incurs ongoing SMALL_MODEL capture (10-min
  debounce + 5-min sweep) and promotion confirms (30-min sweep), and the model gains the `recall`
  tool. This is the intended consequence of "make ON the default"; opt-out is per-context.
- **`recall` in DMs:** keep current ON behavior (registered for dm + group in `normal` mode). The
  minor, pre-existing overlap with `search_memory` in DMs is **not** reworked here (separate concern;
  see Out of Scope).
- **Config migration:** none. Stale `cross_thread_memory` keys in existing stored
  `tool_context_flags` JSON are simply ignored by the parser. Contexts that had explicitly set it
  `false` will begin capturing (the intended new default); they can opt out via the toggle.

## Detailed changes

### 1. Flag deletion — `src/tools/feature-flags.ts`

Remove `crossThreadMemory` from the `ReductionFlags` interface, the `ALL_OFF` sentinel, and the
`parseReductionFlagsJson` key read. Delete `resolveCrossThreadMemoryFlag`. Leave `resolveReductionFlags`,
the kill switch, and the other three flags (`progressiveDisclosure`, `resultCompaction`,
`semanticToolRetrieval`) untouched.

### 2. Always-on capture

- `src/long-term-memory/capture.ts` — remove `flagEnabled` from `RunMemoryCaptureDeps` and
  `defaultDeps`; delete the guard at line 105. **Keep** the group + `hasThreadContextId` guard
  (line 106) and the `profile?.enabled === false` skip (line 110).
- `src/long-term-memory/capture-debounce.ts` — remove `flagEnabled` from `ArmCaptureDeps` and
  `defaultDeps`; delete the guard at line 51. **Keep** the `contextType !== 'group'` guard.

### 3. Recall tool + system prompt

- `src/tools/provider-independent-tools-builder.ts` — drop `resolveCrossThreadMemoryFlag` from the
  import (keep `resolveReductionFlags`, still used for `resultCompaction`). Replace the four-condition
  guard with three:

  ```ts
  if (contextId !== undefined && contextType !== undefined && mode === 'normal') {
    tools['recall'] = makeRecallMemoryTool({ storageContextId: contextId, contextType })
  }
  ```

- `src/system-prompt.ts` — no change (fragment auto-appears via `requiredTools: ['recall']`).

### 4. Promotion / sweeps / scheduler / trigger

No code change in `promotion.ts`, `promotion-sweep.ts`, `recall-cascade.ts`, `capture-sweep.ts`,
`llm-history.ts`, or `scheduler-instance.ts`. They activate on their own once capture writes rows.

**"Disable capture" semantics** (documented, not changed): the per-context toggle gates only _new_
capture. When disabled, no new provisional rows form; existing provisional/active records remain,
`recall` still works, and promotion can still promote already-captured clusters. Erasure stays the
separate "Clear memory" action.

### 5. Admin / settings UI removal (atomic — `FlagsSchema` is `.strict()`)

- `src/debug/admin-feature-flags.ts` — remove `cross_thread_memory` from `AdminFlagState` + `toWire`.
- `src/debug/settings/admin/feature-flags-routes.ts` — remove from `FlagsSchema`.
- `client/admin/feature-flags-fetcher-schemas.ts` — remove from `AdminFeatureFlagStateSchema`.
- `client/settings/sections/admin/AdminFeatureFlagsSection.svelte` — remove `'cross_thread_memory'`
  from `FLAG_KEYS` and `FLAG_LABELS`.

Result: three toggles remain (Compaction, Disclosure, Semantic retrieval). The kill-switch banner and
`killSwitchEngaged` snapshot field stay (they govern the remaining three flags).

### 6. Tests

- **Delete:** `tests/tools/feature-flags-cross-thread.test.ts`,
  `tests/long-term-memory/flag-off-parity.test.ts`.
- **`tests/tools/provider-independent-tools-builder.test.ts`** — collapse the recall ON/OFF pair into
  one "always registered for normal + group/dm" test; keep the proactive-mode exclusion test.
- **`tests/long-term-memory/stop-rediscovering.acceptance.test.ts`** — keep; drop the removed
  `flagEnabled: () => true` dep.
- **`tests/long-term-memory/capture.test.ts` / `capture-debounce.test.ts`** — remove `flagEnabled`
  from deps stubs; ensure `capture.test.ts` has a case proving `profile.enabled === false` skips
  capture (the guarantee that replaces flag-off parity) — add if absent.
- **Field-drop only** (remove the `crossThreadMemory`/`cross_thread_memory` field from fixtures/stubs,
  no logic change): `feature-flags.test.ts`, `llm-orchestrator-tools-compaction.test.ts`,
  `llm-orchestrator-disclosure-wiring.test.ts`,
  `client/admin/feature-flags-fetcher-schemas.test.ts`,
  `client/settings/admin-fetchers.test.ts`,
  `client/settings/sections/admin/AdminFeatureFlagsSection.test.ts` (also drop its dedicated
  cross_thread toggle test and change the 4→3 checkbox count assertion),
  `debug/admin-feature-flags.test.ts`, `debug/settings/admin/feature-flags-routes.test.ts`.

### 7. Documentation

- `CLAUDE.md` — rewrite the "Cross-thread memory bridge (experimental, default OFF)" paragraph as a
  non-experimental, always-on description; the per-context "Disable capture" toggle is the only off
  switch; `TOOL_CONTEXT_REDUCTION_DISABLED` no longer affects it. Update any line implying four
  reduction flags; remove the `resolveCrossThreadMemoryFlag` reference.
- `src/tools/CLAUDE.md` — trim any enumeration of reduction flags / `cross_thread_memory` to the
  remaining three (grep to confirm during implementation).
- `README.md` — no change expected; confirm during implementation.

## Out of scope

- Consolidating `recall` and `search_memory` (their DM overlap is pre-existing and behavior-preserving
  here). If desired later, it gets its own spec.
- Changing the group + thread-only capture guard, the debounce/sweep intervals, promotion thresholds,
  or the recall cascade.
- Adding a dedicated `MEMORY_CAPTURE_DISABLED` global env (considered and rejected in favor of the
  per-context toggle).

## Risks & mitigations

- **LLM cost increase for all deployments with group chats.** Intended; mitigated by the per-context
  "Disable capture" toggle and the existing 10-min debounce / idle-sweep design that avoids
  per-turn extraction.
- **`.strict()` schema drift** between server route and client during the UI removal → PATCH 422s.
  Mitigation: change all four UI surfaces in one commit.
- **Contexts that opted out via the flag** now start capturing. Intended; surfaced in release notes;
  reversible per-context via the toggle.

## Verification

`bun typecheck`, `bunx oxlint`, `bun knip`, `bun run format:check`, and the long-term-memory + tools +
settings/admin (server and client) suites green. Manual: admin Feature flags section shows three
toggles; a group thread produces provisional records visible in the settings Memory "Pending
(provisional)" subsection without any flag set.
