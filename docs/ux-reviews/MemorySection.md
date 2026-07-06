<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — MemorySection

**Date:** 2026-07-06
**Reviewed:** `client/settings/sections/MemorySection.svelte`
**States captured:** Populated, Empty, Error, Loading, clear-confirm-open, clear-button-hover, profile-textarea-focused, narrow-640 · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                         |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Header rhythm is right, but the section-wide "Clear memory" sits inside the profile card next to "Save profile", and the active list has no heading while the pending group does.            |
| 2. Affordance & signifiers      | warn  | Primary/outline/danger buttons read well, but a record's only action — "Archive" — is a ghost button that renders as flat muted text with no border or fill at rest.                         |
| 3. Consistency w/ design system | warn  | Reuses `Btn`/`Field`/`Input`/`Pill`/`EmptyState`/`Confirm` well; only the error path skips the shared `ErrorState`+retry that `AiOutputSection` uses.                                        |
| 4. Feedback & state             | warn  | Loading/empty/success are clear and the destructive path is well-guarded by `Confirm`, but the error state hides the whole UI behind a raw server string with no retry.                      |
| 5. Content & language           | fail  | A privacy-sensitive capture feature ships with zero explanatory copy: no note on what is captured, what disabling does, and the empty state never says capture is off.                       |
| 6. Accessibility                | fail  | The `--fg4` meta text (record date + tag chips) is ~1.8:1 on the surface — effectively unreadable; the `--fg3` source label sits at a borderline ~3.9:1 at 11px.                             |
| 7. Responsive / layout          | pass  | Reflows cleanly to a single column at 640px; no overflow or clipping; the header action stays within bounds.                                                                                 |
| 8. Spacing, alignment & sizing  | warn  | Square cards + 12px padding match siblings, but `.settings-memory` uses a one-off `gap: 14px` and record padding `10px 12px` that drift from the sibling 12px / spacing tokens.              |
| 9. Interaction & micro-states   | warn  | `:focus-visible` rings and a "Saving…" busy label exist, but Archive/toggle share one `mutating` flag that disables every archive button and the capture toggle with no per-row busy signal. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Record meta text (`--fg4`) is effectively invisible

- **Dimension:** 6. Accessibility
- **Where visible:** Populated / narrow-640 — the "last 2026-06-01" date and the "lang" tag chip are barely perceptible against the card
- **Source:** `client/settings/sections/MemorySection.svelte:376-378` (`.settings-memory__seen { color: var(--fg4) }`) and `:392-396` (`.settings-memory__tag { color: var(--fg4) }`); `--fg4` = `#3a4248` (`client/shared/tokens.css:72`) on `--surface` `#111512` ≈ 1.8:1
- **Suggested fix:** Lift the "last seen" date and tag-chip text off `--fg4` to at least `--fg3`/`--text-muted` (or brighter) so the meta clears the WCAG minimum instead of dissolving into the card background.

### [High] No explanatory copy for a privacy-sensitive capture feature

- **Dimension:** 5. Content & language
- **Where visible:** Populated (no note on what "capture" records or retains); Empty (empty state gives a generic hint and never says capture is currently **off**, while the "Enable capture" CTA sits detached in the header)
- **Source:** `client/settings/sections/MemorySection.svelte:171-182` (`PageHeader` carries no description; toggle has no helper text) and `:252-255` (`EmptyState` hint is generic; `EmptyState` supports an `action` snippet that is unused)
- **Suggested fix:** Add a one-line intro explaining what memory capture records and that disabling it keeps existing records, and make the empty state state-aware ("Capture is off — enable it to start recording") with the enable CTA wired into the `EmptyState` `action` slot.

### [Med] Error state hides the whole section behind a raw server string with no retry

- **Dimension:** 4. Feedback & state (also 3. Consistency, 5. Content)
- **Where visible:** Error — a bare red `boom` line renders alone; the profile card, records, and any recovery path all disappear
- **Source:** `client/settings/sections/MemorySection.svelte:184` (`<p class="status-error">{error}</p>`) with the body gated on `:189` (`{:else if currentMemory !== null}`), so a load failure renders nothing else; contrast the sibling `client/settings/sections/AiOutputSection.svelte:65-66` (`ErrorState` + `onRetry`)
- **Suggested fix:** Render the shared `ErrorState` with an `onRetry={() => void load(contextId)}` on load failure (as `AiOutputSection` does) instead of a raw one-line message that surfaces internal text like "boom" and offers no way back.

### [Med] Section-wide "Clear memory" is mis-scoped inside the profile card

- **Dimension:** 1. Visual hierarchy & scanning (also 2. Affordance)
- **Where visible:** Populated — "Clear memory" sits in the profile card's action row directly beside "Save profile", implying it only affects the profile, though it wipes the profile **and** every record
- **Source:** `client/settings/sections/MemorySection.svelte:209-219` (`Clear memory` inside `.settings-memory__profile-actions`, `:191`) alongside the profile-only `Save profile` at `:201-208`
- **Suggested fix:** Move the destructive section-wide "Clear memory" out of the profile sub-card (e.g. to the section footer or header) so its scope isn't visually read as profile-only; the `Confirm` copy at `:288-289` already spells out the true scope, but placement should match it.

### [Med] Record's only action "Archive" is a low-affordance ghost button

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated / narrow-640 — "Archive" reads as static muted text with no border or background until hover; at 640px it drops to an orphaned text link under the record body
- **Source:** `client/settings/sections/MemorySection.svelte:241-248` (`variant="ghost"`) → ghost styling `client/shared/ui/Btn.svelte:94-97` (`background: transparent; color: var(--fg2); border-color: transparent`)
- **Suggested fix:** Give the per-record action a resting signifier (an `outline` variant or a persistent border/icon) so the only way to remove a record doesn't look like inert label text.

### [Low] Source label (`--fg3`) contrast is borderline at 11px

- **Dimension:** 6. Accessibility
- **Where visible:** Populated — the "chat" source token is dim and small
- **Source:** `client/settings/sections/MemorySection.svelte:368-371` (`.settings-memory__source { color: var(--fg3); font-size: 11px }`); `--fg3` = `#6b766e` on `--surface` ≈ 3.9:1, under the 4.5:1 small-text threshold
- **Suggested fix:** Nudge the source label to a brighter muted token or increase its size so 11px meta text clears 4.5:1.

### [Low] Active records list has no heading, unlike the pending group

- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Populated — the active records appear directly under the profile card with no label, while the provisional group below carries an "Pending (provisional)" heading and hint
- **Source:** `client/settings/sections/MemorySection.svelte:256-262` (bare `<ul>` for active records) vs. `:264-276` (pending block with `<h3>` + hint)
- **Suggested fix:** Give the active records list a parallel heading (e.g. "Active records") so the two groups read as a matched pair and the top list is self-labelling.

### [Low] Shared `mutating` flag disables unrelated controls with no per-row busy signal

- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** not a single frame — archiving one record disables every other record's Archive button and the header capture toggle at once, with no spinner on the row being archived
- **Source:** `client/settings/sections/MemorySection.svelte:147-159` (`archiveRecord` sets the shared `mutating`), consumed at `:244` (all Archive buttons) and `:176` (capture toggle)
- **Suggested fix:** Track the in-flight record id so only the clicked Archive shows a busy state, and avoid disabling the unrelated capture toggle during a per-record archive.

### [Low] One-off spacing drifts from sibling sections and the scale

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated — inter-block and record padding rhythm differs subtly from sibling settings cards
- **Source:** `client/settings/sections/MemorySection.svelte:296-299` (`.settings-memory { gap: 14px }`) and `:342-351` (record `padding: 10px 12px`) vs. the sibling uniform `padding: 12px` (`CodingCredentialsSection.svelte:390`, `McpSection.svelte:255`) and tokens `--gap-inline: 12px` / `--gap-tight: 8px`
- **Suggested fix:** Replace the one-off `14px` gap and `10px 12px` padding with the shared spacing tokens / the sibling 12px so the card rhythm matches the rest of the settings surface.

### [Low] Pending (provisional) records are uncovered by stories and offer only "Archive"

- **Dimension:** 5. Content & language (coverage note)
- **Where visible:** not capturable — no fixture includes a `provisional` record, so the "Pending (provisional)" block never renders in Storybook
- **Source:** `client/settings/sections/MemorySection.svelte:264-276` (pending block); fixtures at `client/stories/msw/settings-handlers-personal.ts:67-81` contain only one `active` record; provisional rows reuse the same `recordItem` whose only control is "Archive" (`:241-248`), i.e. reject, with no visible promote/accept path
- **Suggested fix:** Add a fixture/story exercising a `provisional` record so the pending block is reviewable, and confirm whether provisional items need an accept affordance or whether promotion is fully automatic (in which case the hint copy should say so).
