<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — MemorySection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/MemorySection.svelte`
**States captured:** Populated, Empty, Empty (capture on), Error, Loading, Provisional, clear-confirm-open, clear-button-hover, profile-textarea-focused, narrow-640 · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                     |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | "Clear memory" now lives in the `PageHeader` action row (its true section-wide scope), and "Active records" carries a heading matching "Pending (provisional)".                        |
| 2. Affordance & signifiers      | pass  | Archive is now an `outline` button with a visible border/background-on-hover, no longer flat ghost text.                                                                               |
| 3. Consistency w/ design system | pass  | Reuses `Btn`/`Field`/`Input`/`Pill`/`EmptyState`/`Confirm`/`ErrorState`; the error path now matches the shared `ErrorState` + retry pattern used by `AiOutputSection`.                  |
| 4. Feedback & state             | pass  | Loading/empty/success/error all render through shared primitives; error retains a retry path via `ErrorState`.                                                                          |
| 5. Content & language           | pass  | A section-level intro (`scopeSub`) explains what memory captures per scope, a note explains what disabling does, and the empty state is capture-aware with a wired-in enable CTA.      |
| 6. Accessibility                | pass  | Record meta (date/tag) and the source label now use `--text-muted` (~7.4:1 on `--surface-1`), well clear of the WCAG minimum.                                                           |
| 7. Responsive / layout          | pass  | Reflows cleanly to a single column at 640px; the Archive button becomes a full-width row rather than an orphaned link.                                                                  |
| 8. Spacing, alignment & sizing  | pass  | `.settings-memory` now uses `--gap-inline`, and record padding is the shared `12px`, matching sibling settings cards.                                                                   |
| 9. Interaction & micro-states   | pass  | Busy state is now scoped per-record (`archivingId`) and the capture toggle is no longer disabled by an in-flight archive; `:focus-visible` and a "Saving…" busy label exist.            |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Record meta text (`--fg4`) is effectively invisible

- **Id:** memory-meta-text-invisible
- **Status:** fixed
- **Resolved:** `8ff5d3e51` ("fix(settings): raise MemorySection record meta contrast off --fg4/--fg3") — the date/tag/source spans now use `--text-muted` (`client/settings/sections/MemorySection.svelte:427-433`); `--text-muted` = `#9aa79d` on `--surface-1` `#111512` ≈ 7.4:1, well above the WCAG 4.5:1 floor for small text. Confirmed visually in `.storybook-shots/settings/sections/MemorySection.spec.ts/settings-sections-MemorySection-Populated-1.png` — the "chat · last 2026-06-01" and "lang" chip are clearly legible.
- **Dimension:** 6. Accessibility
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [High] No explanatory copy for a privacy-sensitive capture feature

- **Id:** memory-no-privacy-explanation
- **Status:** fixed
- **Resolved:** `d1ab74da4` ("fix(settings): move MemorySection Clear to header, add capture copy") + `8d168aba6` ("fix(settings): make MemorySection empty state capture-aware with CTA"). `PageHeader`'s `sub={scopeSub}` (`client/settings/sections/MemorySection.svelte:177`, derived at `:48-52`) now states what memory records per scope; `.settings-memory__note` (`:209-212`) explains that disabling keeps existing records; the empty state is capture-aware — "Capture is off" with a wired `action` snippet CTA when disabled (`:271-284`) vs. the generic hint only when capture is on (`:267-269`). Confirmed in `settings-sections-MemorySection-Empty-capture-on-1.png` (shows the disabled-state copy + "Enable capture" CTA) vs. `settings-sections-MemorySection-Empty-1.png` (capture-on generic hint).
- **Dimension:** 5. Content & language
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Med] Error state hides the whole section behind a raw server string with no retry

- **Id:** memory-error-hides-section
- **Status:** fixed
- **Resolved:** `4ef67bd0e` ("fix(settings): render MemorySection load failure via ErrorState + retry") — a first-load failure now renders the shared `ErrorState` with `onRetry={() => void load(contextId)}` (`client/settings/sections/MemorySection.svelte:313-315`), matching the `AiOutputSection` pattern. A reload failure (data already loaded) now deliberately keeps the existing UI and surfaces the error inline instead (`:92-96`, `2d3b2c426` "fix(settings): MemorySection reload failure keeps loaded data, not full ErrorState") — an intentional, better-than-original behavior, not a regression. Confirmed in `settings-sections-MemorySection-Error-1.png`: title "Something went wrong", the `boom` message, and a "Try again" button.
- **Dimension:** 4. Feedback & state (also 3. Consistency, 5. Content)
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Med] Section-wide "Clear memory" is mis-scoped inside the profile card

- **Id:** memory-clear-mis-scoped
- **Status:** fixed
- **Resolved:** `d1ab74da4` ("fix(settings): move MemorySection Clear to header, add capture copy") — "Clear memory" now lives in the `PageHeader` `action` snippet alongside the capture toggle (`client/settings/sections/MemorySection.svelte:178-200`), outside and above the profile card (`:213-232`), so its section-wide scope reads correctly. Confirmed in `settings-sections-MemorySection-Populated-1.png`.
- **Dimension:** 1. Visual hierarchy & scanning (also 2. Affordance)
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Med] Record's only action "Archive" is a low-affordance ghost button

- **Id:** memory-archive-low-affordance
- **Status:** fixed
- **Resolved:** `976c59883` ("fix(settings): make MemorySection Archive an outline button") — Archive is now `variant="outline"` (`client/settings/sections/MemorySection.svelte:252`), which renders with `border-color: var(--border)` and `color: var(--text)` at rest (`client/shared/ui/Btn.svelte:94-97`), no longer flat muted text. Confirmed in `settings-sections-MemorySection-Populated-1.png` and the narrow-640 shot, where Archive renders as a bordered box (full-width row at 640px, not an orphaned link).
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Low] Source label (`--fg3`) contrast is borderline at 11px

- **Id:** memory-source-label-low-contrast
- **Status:** fixed
- **Resolved:** `8ff5d3e51` ("fix(settings): raise MemorySection record meta contrast off --fg4/--fg3") — the source span now shares `--text-muted` with the other meta text (`client/settings/sections/MemorySection.svelte:427-433`), ≈7.4:1 on `--surface-1`, clearing the 4.5:1 small-text threshold with margin.
- **Dimension:** 6. Accessibility
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Low] Active records list has no heading, unlike the pending group

- **Id:** memory-active-list-no-heading
- **Status:** fixed
- **Resolved:** `d1e7eeac2` ("fix(settings): label MemorySection active records list") — active records now render under an "Active records" `<h3>` (`client/settings/sections/MemorySection.svelte:288-289`), matching "Pending (provisional)" (`:300`). Confirmed in `settings-sections-MemorySection-Populated-1.png` and `settings-sections-MemorySection-Provisional-1.png`.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Low] Shared `mutating` flag disables unrelated controls with no per-row busy signal

- **Id:** memory-mutating-flag-disables-unrelated
- **Status:** fixed
- **Resolved:** `bc7aa9db5` ("refactor(settings): scope MemorySection busy state per-row and per-toggle") — the shared `mutating` flag is gone (`grep mutating` in the file returns nothing); archiving now tracks a per-record `archivingId` (`client/settings/sections/MemorySection.svelte:41`, set/cleared at `:154`/`:161`), and only the clicked row's Archive button shows `busy` (`:255`). The capture toggle's `disabled` no longer includes `archivingId` (`:194`), so an in-flight archive no longer blocks the unrelated capture toggle. Residual: all Archive buttons are still disabled while any one archives (`:256`, `disabled={archivingId !== null}`), which is a deliberate guard against concurrent list mutations rather than the original defect (no way to tell which row was busy, and an unrelated toggle frozen).
- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Low] One-off spacing drifts from sibling sections and the scale

- **Id:** memory-hardcoded-spacing
- **Status:** fixed
- **Resolved:** `4ee96e2c1` ("style(settings): align MemorySection spacing to shared tokens") — `.settings-memory` now uses `gap: var(--gap-inline)` (`client/settings/sections/MemorySection.svelte:335`) and record padding is the shared `12px` (`:407`), matching `CodingCredentialsSection.svelte` / `McpSection.svelte`.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A

### [Low] Pending (provisional) records are uncovered by stories and offer only "Archive"

- **Id:** memory-pending-records-uncovered
- **Status:** fixed
- **Resolved:** `cb13f4331` ("fix(settings-memory): surface provisional group records in settings UI") added the "Pending (provisional)" rendering and the accompanying hint copy that clarifies promotion is automatic ("Facts seen across several threads are promoted to shared group memory automatically — no action needed. Archive to discard.", `client/settings/sections/MemorySection.svelte:301-304`, added by `446b1820b`); a `Provisional` story/fixture was added (`client/settings/sections/MemorySection.stories.svelte:29`, fixture `memoryProvisionalHandlers` in `client/stories/msw/settings-handlers-personal.ts:71-112`) exercising both an `active` and a `provisional` record together. The coverage gap and the missing-explanation gap are both closed; the hint now explicitly states no accept affordance is needed since promotion is automatic. Confirmed in `settings-sections-MemorySection-Provisional-1.png`.
- **Dimension:** 5. Content & language (coverage note)
- **Where visible:** N/A — no longer reproduces
- **Source:** N/A
- **Suggested fix:** N/A
