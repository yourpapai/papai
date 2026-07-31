<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0259: MemorySection UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-06

## Context

`MemorySection` (`client/settings/sections/MemorySection.svelte`) — the Personal/Group settings section shipped by ADR-0193 — had ten UX-review findings (`docs/ux-reviews/MemorySection.md`): record meta text rendered in near-invisible `--fg4`/borderline `--fg3`; no explanatory copy for the capture feature; a dead-end empty state; a raw backend error string with no retry; the destructive "Clear memory" mis-scoped inside the profile card; a low-affordance `ghost` Archive button; an active-records list with no heading (asymmetric against the pending block); a single shared `mutating` flag that disabled every Archive button and the capture toggle at once; one-off spacing drift off the shared tokens; and a provisional block that was both uncovered in Storybook and unclear about promotion being automatic.

The design (`docs/superpowers/specs/2026-07-06-memorysection-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-06-memorysection-ux-fixes.md`) resolved all ten as a **client-only** change grounded in confirmed backend behavior (`src/long-term-memory/**`, `src/debug/settings/memory-routes.ts`): capture is chat-message-only and stops only _new_ capture (existing memory is kept and still used); provisional → active promotion is fully automatic (group scope, ≥3 threads + LLM durability check) with no manual promote API; so the copy must be honest about disable-vs-clear and no accept affordance is added. The fixes reuse conventions already established in sibling sections — the `AiOutputSection` render-state pattern (`ErrorState` + retry on load failure, inline status on transient mutation errors), the `EmptyState` `action` snippet for a dead-end CTA, the `PageHeader` `sub` for scope-aware description, and the `Btn` `busy` affordance shipped by ADR-0253 for per-row archive feedback. No fetcher, route, or backend changes.

## Decision Drivers

- **Legible record meta.** Date, tag-chip text, and source label must clear the 4.5:1 small-text threshold — move off `--fg4`/`--fg3` onto `--fg2` (`--text-muted`, ~7:1) (findings High + Low).
- **Explain the feature honestly.** A scope-aware description plus a disable-vs-clear helper line, truthful that disabling stops new capture but keeps/uses existing memory (finding High).
- **No dead-end empty state.** Capture-off + no records shows a "Capture is off" `EmptyState` with an `Enable capture` CTA; capture-on + no records shows a benign "No memory records yet" (finding High).
- **Recoverable load errors.** A failed load renders the framed `ErrorState` + retry instead of a raw string; transient mutation errors stay inline where the body is still present (finding Med).
- **Destructive action placement.** "Clear memory" is a section-wide concern, so it belongs in the `PageHeader` action slot beside the capture toggle — not buried in the profile card (finding Med).
- **Resting Archive affordance.** `ghost` → `outline` so the per-record Archive reads as a button, not plain text (finding Med).
- **Symmetric hierarchy.** The active list gets an "Active records" heading mirroring the pending block (finding Low).
- **Scoped busy state.** Split the shared `mutating` flag into `archivingId` (per-row) and `togglingCapture` (toggle only), with a `busy` affordance on the archived row — archiving one row no longer disables unrelated controls (finding Low).
- **Tokenized spacing.** Map one-off `px` gaps/padding to `--gap-inline`/`--gap-tight` and normalize record padding to match siblings (finding Low).
- **Observable provisional state + honest promotion copy.** A group-scope `Provisional` fixture/story covers the pending block, and the hint describes automatic promotion (finding Low).
- **Client-only, additive reuse.** No backend/fetcher changes; reuse the shared `EmptyState`/`ErrorState`/`PageHeader`/`Btn` primitives already in the tree.

## Considered Options

### Option 1 — Inline markup/copy/style refactor; reuse shared primitives; split busy state (chosen)

Resolve all ten findings inside `MemorySection.svelte` by editing markup, copy, and styles in place (no component extraction), add two Storybook fixtures/stories, and split `mutating` into `archivingId` + `togglingCapture` reusing ADR-0253's `Btn` `busy`.

- **Pros:** directly resolves all ten findings; reuses the `AiOutputSection`/`ErrorState`/`EmptyState` conventions already used by sibling sections; `max-lines` is off for this file and siblings run ~427 lines, so inline matches house style with no line-budget pressure; the busy split is a strict improvement (archiving one row no longer disables others).
- **Cons:** the section gains conditional branches (capture-aware empty, load-error `ErrorState`) and two new state variables; the story/fixture surface grows.

### Option 2 — Extract a `MemoryRecord` child component for the per-row markup/styling

Pull each record (head, text, tags, Archive button) into a dedicated child component that owns its contrast/affordance/busy wiring.

- **Pros:** isolates the record-level fixes; could ease per-record testing.
- **Cons:** rejected by the design — sibling sections keep records inline, `max-lines` is off so there is no extraction pressure, and the per-row `busy`/`archivingId` state would have to thread through props/callbacks for no net benefit.

### Option 3 — Keep the shared `mutating` flag; only add a `disabled` guard during load

Leave the single `mutating` flag, only ensure the toggle can't fire during load.

- **Pros:** smaller diff; no state split.
- **Cons:** rejects the Low finding — archiving one row would still disable every other Archive button and the capture toggle, and the row would have no in-flight affordance distinct from `disabled`.

## Decision

The chosen Option 1 shipped in full across the rewritten section, its stories, the MSW fixtures/scenarios, and the visual screenshot spec. All ten findings have a corresponding task in the plan and verifiable code. What shipped:

1. **Record meta contrast.** `.settings-memory__source`, `.settings-memory__seen`, and `.settings-memory__tag` share `color: var(--fg2)`; the `.settings-memory__seen` `--fg4` override and the `.settings-memory__tag` `--fg4` override were both dropped.
2. **Scope-aware description + disable/clear helper.** A `scopeSub` derived value feeds `PageHeader` `sub` (group vs personal copy); a muted `.settings-memory__note` line atop the body states "Disabling stops new capture. Existing memory is kept and still used — use Clear memory to remove it."
3. **State-aware empty state with CTA.** `activeRecords.length === 0` branches on `currentMemory.enabled`: on → "No memory records yet", off → "Capture is off" with an `Enable capture` button in the `EmptyState` `action` snippet wired to `toggleCapture()`.
4. **Load failure via `ErrorState` + retry.** `ErrorState` imported; the always-on top status lines moved inside the loaded branch (inline transient errors only); a `{:else if error !== null}` branch renders `ErrorState message={error} onRetry={() => void load(contextId)}` when there is no loaded data.
5. **"Clear memory" relocated to the header.** Moved out of `.settings-memory__profile-actions` into the `PageHeader` action slot, ordered `[Clear memory] [Enable/Disable capture]` inside a `.settings-memory__header-actions` flex row; the profile card keeps only `Save profile`.
6. **Archive affordance.** The per-record Archive `Btn` switched `variant` from `ghost` to `outline`.
7. **Active-list heading.** The active `<ul>` is wrapped in a `.settings-memory__active` grid with an "Active records" `<h3>` mirroring the pending title styling.
8. **Per-row + per-toggle busy state.** The shared `mutating` flag was removed; `togglingCapture` gates the capture toggle and `archivingId` drives `busy={archivingId === record.id}` / `disabled={archivingId !== null}` on the Archive button (plus disabling on Clear/toggle).
9. **Tokenized spacing.** `.settings-memory` gap → `var(--gap-inline)`; `.settings-memory__profile-actions` and `.settings-memory__records` gaps → `var(--gap-tight)`; record `gap` → `var(--gap-inline)` and `padding` normalized to `12px`.
10. **Provisional copy + coverage.** The pending hint rewritten to describe automatic promotion; a group-scope `Provisional` fixture (one active + one provisional record) and an `Empty (capture on)` fixture back two new stories registered as `settings-memory-provisional` / `settings-memory-empty-capture-on` scenarios.
11. **Visual regression surface.** Auto-screenshot tests cover the two new stories; the manual interaction states (narrow-640, clear-confirm, clear-hover, profile-focus) remain.

## Consequences

### Positive

- Record date/source/tag text is legible (~7:1) instead of dissolving into the card.
- The capture feature is now self-explanatory: a scope-aware description under the title and an honest disable/clear helper line, with no misleading impression that disabling removes existing memory.
- The empty state is no longer a dead end: capture-off surfaces an inline `Enable capture` CTA.
- Load failures are recoverable in place via the framed `ErrorState` + retry, replacing a raw "boom" string.
- The destructive "Clear memory" sits where users expect a section-wide action — beside the capture toggle in the header — and the profile card is reserved for profile concerns.
- Archive has a visible resting border, and archiving one record no longer disables unrelated controls; the archived row shows an in-flight `busy` affordance.
- The active and pending lists now read as a symmetric pair of headed groups.
- Provisional promotion is documented honestly (automatic, no action needed) and is observable in Storybook.

### Negative

- The section gained conditional branches (capture-aware empty, load-error `ErrorState`) and two new state variables, adding a small amount of conditional complexity.
- Spacing tokenization was applied to the explicitly-called-out rules but several internal `px` gaps remain hardcoded (see Divergences).
- The story/fixture surface grew by two scenarios and the shared MSW handlers file grew accordingly.

### Risks

- **Inline pass-through of backend load/mutation errors.** `ErrorState`/inline `status-error` surface the raw backend message; a poor backend string would show unedited.
- **`currentMemory === null` gating is load-state dependent.** The `ErrorState` takeover only fires on a first-load failure (no data loaded); a reload failure after data is loaded keeps the body and surfaces the error inline — the displayed data is then stale until the next successful load/retry.
- **`Btn` `busy` reuse depends on ADR-0253.** The per-row Archive `busy` affordance relies on the shared primitive; a future regression in `Btn` `busy` would affect this section.

## Related Decisions

- **ADR-0193: Long-Term Memory** — the feature this fixes. ADR-0193 shipped the original `MemorySection` (single shared `mutating` flag, raw error string, ghost Archive, mis-scoped Clear) whose UX-review findings this layer resolves.
- **ADR-0253: ReleaseSubscriptionSection UX Fixes** — shipped the `Btn` `busy` affordance (`busy` prop + `aria-busy` + `onClick` guard) and the intrinsic `:focus-visible` ring that this work reuses for the per-row Archive button.
- The `AiOutputSection` render-state convention (`ErrorState` + retry on load failure, inline status on transient errors) this rewrite mirrors, and the `EmptyState` `action` snippet used for the capture-off CTA.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/MemorySection.svelte:12` | `ErrorState` imported. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:40-41` | `togglingCapture`/`archivingId` state replace the shared `mutating` flag. | `read` confirms; `grep mutating` returns zero matches in this file (residual matches are in `GuestModeSection`/`ReleaseSubscriptionSection`). |
| `client/settings/sections/MemorySection.svelte:48-52` | `scopeSub` scope-aware description (`$derived`). | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:81-100` | `load()` keeps already-loaded data on a reload failure and surfaces the error inline. | `read` confirms (divergence — see below). |
| `client/settings/sections/MemorySection.svelte:102-115` | `toggleCapture()` uses `togglingCapture`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:151-163` | `archiveRecord()` uses `archivingId`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:174-201` | `PageHeader` with `sub={scopeSub}`; `Clear memory` + capture toggle in `.settings-memory__header-actions`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:203-207` | Loading placeholder gated on `loading && currentMemory === null`; inline status lines moved inside loaded branch. | `read` confirms (divergence — see below). |
| `client/settings/sections/MemorySection.svelte:209-212` | `.settings-memory__note` disable/clear helper. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:222-231` | Profile card retains only `Save profile` (Clear removed). | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:252-260` | Archive `Btn` `variant="outline"`, `busy={archivingId === record.id}`, `disabled={archivingId !== null}`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:264-286` | Capture-aware empty state: on → "No memory records yet"; off → "Capture is off" + `Enable capture` CTA (`testid="memory-empty-enable"`). | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:287-295` | "Active records" heading + `.settings-memory__active` wrapper. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:300-304` | Provisional hint rewritten to describe automatic promotion. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:313-314` | `{:else if error !== null}` → `ErrorState message onRetry`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:427-433` | `.settings-memory__source/.__seen/.__tag` share `color: var(--fg2)`; no `--fg4`/`--fg3` override. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:447-450` | `.settings-memory__tag` border/padding only (color inherited from shared rule). | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:333-336` | `.settings-memory` `gap: var(--gap-inline)`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:357-361` | `.settings-memory__profile-actions` `gap: var(--gap-tight)`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:363-369` | `.settings-memory__records` `gap: var(--gap-tight)`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:390-393` | `.settings-memory__active` `gap: var(--gap-tight)`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:401-410` | `.settings-memory__record` `gap: var(--gap-inline)`, `padding: 12px`. | `read` confirms. |
| `client/shared/tokens.css:51-52` | `--gap-inline: 12px; --gap-tight: 8px;` token definitions. | `read` confirms. |
| `client/shared/ui/EmptyState.svelte:13,23` | `action?: Snippet` prop rendered into `.ui-empty__action` (backs the CTA). | `read` confirms. |
| `client/shared/ui/PageHeader.svelte:15,19,28` | `sub` + `action` snippet support (backs description + header actions). | `read` confirms. |
| `client/settings/sections/MemorySection.stories.svelte:28-30` | `Empty (capture on)` + `Provisional` stories. | `read` confirms. |
| `client/stories/msw/settings-handlers-personal.ts:152-201` | `memoryEmptyCaptureOn`/`memoryProvisional` fixtures + `memoryEmptyCaptureOnHandlers`/`memoryProvisionalHandlers` exports (group scope for provisional). | `read` confirms. |
| `client/stories/msw/scenarios.ts:53,55` | Both handler families imported. | `grep` confirms. |
| `client/stories/msw/scenarios.ts:212-213` | `settings-memory-empty-capture-on` / `settings-memory-provisional` scenario keys registered. | `grep` confirms. |
| `tests/visual/settings/sections/MemorySection.spec.ts:30-38` | Auto-screenshot tests for `Empty (capture on)` + `Provisional`. | `read` confirms. |

Plan-vs-implementation notes:

- **Loading placeholder uses `loading && currentMemory === null`, not `initialLoad && loading`.** The plan/spec assumed an `initialLoad` state variable existed (Task 7 quoted `{#if initialLoad && loading}` as the existing condition to preserve). Shipped has no `initialLoad` variable (`grep` confirms it exists only in `McpSection.svelte`); the placeholder now gates on having no loaded data. Combined with the `load()` change below, this cleanly distinguishes first-load (no data → `ErrorState` takeover on failure) from reload (data present → body stays, error surfaces inline). Intent matches the plan (load failure → `ErrorState`; transient/reload error → inline) but the mechanism is `currentMemory === null`, not `initialLoad`.
- **`load()` preserves already-loaded data on a reload failure.** The plan's `load()` reset `error` and let a failure set it; shipped adds an explicit comment and behavior: on a reload failure it keeps the existing `memory`/`profileDraft` so the form and records survive, surfacing the error inline. This is why the `ErrorState` branch (`currentMemory === null && error !== null`) only fires on a true first-load failure. A net UX improvement over the plan, consistent with the "keep data on reload" pattern in sibling sections.
- **Tokenization is partial.** The plan's explicit Task 10 steps (`.settings-memory`, `.settings-memory__profile-actions`, `.settings-memory__records`, record `gap`/`padding`) shipped verbatim. The spec's broader note ("map remaining hardcoded `8px` gaps to `--gap-tight` where they correspond") was not exhaustively applied: `.settings-memory__pending` keeps `gap: 8px` (`MemorySection.svelte:373`), `.settings-memory__profile` keeps `gap: 10px` (`:351`), `.settings-memory__record-main` keeps `gap: 7px` (`:416`), and `.settings-memory__record-head`/`.__tags` keep `gap: 6px` (`:423`). These were not individual plan steps, so the literal task list is complete; finding #9 is resolved for the called-out rules only.
- **`Provisional` story uses a distinct group `contextId`.** The story passes `contextId: 'ctx-group-1'` (vs the personal `CONTEXT_ID` used elsewhere) so the group-scope fixture drives the group eyebrow/description; the plan's snippet showed `contextId: CONTEXT_ID` but the fixture itself is group-scoped, so the shipped form is the correct one to exercise the pending block and group copy.

The source plan `docs/superpowers/plans/2026-07-06-memorysection-ux-fixes.md` and design `docs/superpowers/specs/2026-07-06-memorysection-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
