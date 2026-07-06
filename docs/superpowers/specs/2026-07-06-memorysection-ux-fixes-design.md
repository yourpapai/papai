<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — MemorySection UX Fixes

**Date:** 2026-07-06
**Author:** brainstorming session (Dmitriy Lazarev)
**Source review:** [`docs/ux-reviews/MemorySection.md`](../../ux-reviews/MemorySection.md)
**Target:** `client/settings/sections/MemorySection.svelte` (+ its stories/fixtures)

## Summary

Fix all 10 findings from the MemorySection UX review. The work is **client-side only**:
markup, copy, styling, and local component state in the settings section, plus new
Storybook fixtures/stories. No backend, route, or fetcher changes — memory promotion is
fully automatic, so there is no promote endpoint to add.

## Context (backend behavior grounding)

Confirmed from `src/long-term-memory/**` and `src/debug/settings/memory-routes.ts`:

- **Capture ON** auto-extracts durable facts/preferences from **chat messages only** (never
  tool data; the extractor is instructed to skip secrets/credentials). A separate explicit
  "remember" tool path ignores the toggle.
- **Capture OFF** stops _new_ capture only. Existing records are **kept and still used** in
  the assistant's system prompt and search (`buildMessagesWithMemory`, recall tools do not
  check the `enabled` flag). The only true removal is per-record archive or "Clear memory".
- **Provisional → active promotion is fully automatic** (group scope only; requires the fact
  observed across ≥3 threads plus an LLM durability check). There is **no manual promote
  API** by design. Provisional records exist only in group scope.
- **Scope:** `personal` = per-user (DM); `group` = whole-group-shared across threads.
  "Clear memory for this context" clears the resolved scope (all group memory when invoked
  from any group thread).

These facts drive the copy decisions below (honest about the disable-vs-clear distinction;
no accept affordance for provisional records).

## Decisions

- **Scope:** fix all 10 findings.
- **Clear memory placement:** move to the `PageHeader` action slot, beside the capture toggle.
- **Copy depth:** honest about the disable nuance (describe what memory is, and state that
  disabling stops new capture but keeps/uses existing memory — Clear memory is the off-switch).
- **Record markup:** keep inline (no component extraction). `max-lines` is off for this file
  and sibling sections run to ~427 lines, so there is no line-budget pressure; inline matches
  sibling house style.

## Changes

Each change lists the finding it resolves and the current source anchor.

### 1. Header + destructive action — _Med: mis-scoped Clear_

- Move `Clear memory` out of `.settings-memory__profile-actions` into `PageHeader`'s `action`
  snippet, ordered `[Clear memory] [Enable/Disable capture]`. The profile card keeps only
  `Save profile`.
- `Clear memory` is `disabled` when `currentMemory === null` (nothing to clear).
- Anchors: header `MemorySection.svelte:172-182`; profile actions `:200-220`.

### 2. Explanatory copy — _High: no explanatory copy_ (honest-about-disable)

- `PageHeader` gains a scope-aware `sub`:
  - personal: "Durable facts the assistant learns from your chats to personalize replies."
  - group: "Durable facts learned from this group's chats, shared across all threads."
- Add one muted helper line in the section body (below the header): "Disabling stops new
  capture. Existing memory is kept and still used — use Clear memory to remove it."
- Anchors: add `sub` at `:171`; new caption near `:184`. `PageHeader` already supports `sub`
  (`client/shared/ui/PageHeader.svelte:14,26`), as used by `ProfileSection`.

### 3. State-aware empty state + CTA — _High: dead-end empty state_

- Capture **off** + no active records → `EmptyState` title "Capture is off", hint "Enable
  capture to start recording facts from your conversations.", with an `Enable capture`
  button wired into the `EmptyState` `action` snippet.
- Capture **on** + no active records → title "No memory records yet", hint "Facts the
  assistant learns from your chats will appear here."
- Anchors: `:252-255`. `EmptyState` `action` slot exists (`client/shared/ui/EmptyState.svelte:13,23`).

### 4. Error state — _Med: raw "boom" with no retry_

- **Load failure** (`currentMemory === null && error !== null && !loading`) → render the
  shared `ErrorState message={error} onRetry={() => void load(contextId)}` in place of the
  body, matching `AiOutputSection.svelte:65-66`.
- **Mutation errors** (save/archive/toggle, where the body is still present) → keep the
  existing inline `status-error` line. This splits fatal (load) from transient (action).
- Anchors: `:184-189`. `ErrorState` API: `client/shared/ui/ErrorState.svelte` (`message`,
  `onRetry`).

### 5. Contrast — _High (`--fg4`) + Low (`--fg3` source)_

- Record date (`.settings-memory__seen`), tag-chip text (`.settings-memory__tag`), and the
  source label (`.settings-memory__source`) all move to `--fg2` (`--text-muted` `#9aa79d`,
  ~7:1), dropping the `--fg4` overrides. Clears the 4.5:1 small-text threshold.
- Anchors: `:368-378`, `:392-396`.

### 6. Archive affordance — _Med: low-affordance ghost_

- Archive `Btn` `variant="ghost"` → `"outline"` so the per-record action has a resting
  border. Size stays `sm`.
- Anchor: `:241-248`. Ghost vs outline styling: `client/shared/ui/Btn.svelte:89-97`.

### 7. Active-list heading — _Low: asymmetric hierarchy_

- Add an "Active records" heading above the active `<ul>`, mirroring the pending group's
  title/hint styling. Rendered only when `activeRecords.length > 0` (else the empty state
  takes its place).
- Anchor: `:256-262` (vs pending `<h3>` at `:266`).

### 8. Per-row busy — _Low: shared `mutating` disables unrelated controls_

- Replace the shared `mutating` flag with:
  - `archivingId: string | null` — set during `archiveRecord`.
  - `togglingCapture: boolean` — set during `toggleCapture`.
- Archive button: `busy={archivingId === record.id}`, `disabled={archivingId !== null}`.
- Capture toggle: `disabled={currentMemory === null || loading || togglingCapture}`.
- Archiving one row no longer disables the capture toggle or the other rows.
- Anchors: `:39` (`mutating` decl), `:98-111` (`toggleCapture`), `:147-159` (`archiveRecord`),
  `:176` (toggle disabled), `:244` (archive disabled). `Btn` supports `busy`
  (`client/shared/ui/Btn.svelte:20,44,47`).

### 9. Spacing tokens — _Low: one-off px drift_

- `.settings-memory` `gap: 14px` → `var(--gap-inline)` (12px).
- Record `padding: 10px 12px` → `12px` (matches `CodingCredentialsSection.svelte:390`,
  `McpSection.svelte:255`).
- Map remaining hardcoded `8px` gaps to `--gap-tight` where they correspond.
- Anchors: `:296-351`. Tokens: `client/shared/tokens.css:44-48`.

### 10. Provisional hint + story coverage — _Low: uncovered + unclear promotion_

- Rewrite the pending hint to reflect automatic promotion: "Captured from individual
  threads. Facts seen across several threads are promoted to shared group memory
  automatically — no action needed. Archive to discard." No accept affordance is added
  (none exists by design; Archive = discard).
- Add a `Provisional` Storybook story backed by a **group-scope** fixture with one active +
  one provisional record so the pending block renders in Storybook.
- Anchors: `:264-269` (hint); stories `MemorySection.stories.svelte`; fixtures
  `client/stories/msw/settings-handlers-personal.ts:62-102`.

## Component state model (after change)

```
memory, profileDraft, error, status, loading, savingProfile, initialLoad,
loadedContextId, pendingClear, clearing, clearError            (unchanged)
- mutating: boolean                                            (removed)
+ archivingId: string | null                                   (new — per-row archive)
+ togglingCapture: boolean                                     (new — capture toggle)
```

Derived (`currentMemory`, `activeRecords`, `pendingRecords`) unchanged.

## Data flow

Unchanged: the section reads `fetchMemory` and mutates via the existing fetchers
(`setMemoryCapture`, `updateMemoryProfile`, `archiveMemoryRecord`, `clearMemory`). No new
endpoints. Promotion remains automatic and server-side.

## Testing / verification

- **Stories:**
  - Add `Provisional` (group scope, one active + one provisional record).
  - Existing `Empty` story (`enabled: false`) now exercises the capture-off CTA empty state.
  - Existing `Error` story now exercises `ErrorState` + retry.
- **Visual (implementation phase):** re-shoot the depth-B set (`bun shoot -g MemorySection`,
  including the manual states already present in `tests/visual/.../MemorySection.spec.ts`)
  and confirm contrast, Archive affordance, header layout, and both empty-state variants in
  the PNGs.
- **Unit (optional):** the `archivingId` / error-routing split is a candidate for a light
  component test if regression cover is wanted; not strictly required for presentational code.

## Out of scope (flagged, not fixed here)

- The backend behavior that disabling capture still **uses** existing memory. This design
  makes the UI copy honest about it but does not change the behavior; changing it is a
  separate product decision.
- No manual promote/approve affordance for provisional records (promotion is automatic by
  design).
