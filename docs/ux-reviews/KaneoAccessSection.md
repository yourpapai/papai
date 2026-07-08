<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — KaneoAccessSection

**Date:** 2026-07-08
**Reviewed:** `client/settings/sections/KaneoAccessSection.svelte`
**States captured:** Populated, Not provisioned, Error, Loading, password-revealed, reveal-button hover · desktop + ~640px narrow
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Summary

This section is a clear outlier: it renders raw `<h2>`, `<button>`, `<dl>`, `<a>`, and a
one-off `.error` class with **zero shared design-system primitives**, while every sibling
settings section composes `PageHeader` / `Btn` / `Field` / `EmptyState` / `.status-error`.
The result is UA-default styling (grey native button, default-blue links, browser `dl`
margins) on a core, security-sensitive surface — the one-time Kaneo password reveal. Most
findings below trace back to that single root cause.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | fail  | Label and value tiers collapse to one flat mono size; no eyebrow/title rhythm that `PageHeader` gives siblings. |
| 2. Affordance & signifiers      | warn  | Native button reads as clickable, but no active/selected treatment and inconsistent with app buttons.           |
| 3. Consistency w/ design system | fail  | Uses no shared primitives at all — raw `h2`/`button`/`dl`/`a` + undefined `.error` class vs. every sibling.     |
| 4. Feedback & state             | fail  | Error uses an unstyled `.error` class → renders as tiny default-grey text, not alarming; loading is bare.       |
| 5. Content & language           | warn  | "Not provisioned" is an actionable-less dead-end; labels themselves are clear.                                  |
| 6. Accessibility                | fail  | Workspace URL uses browser-default link blue (`#0000EE`), very low contrast on the near-black theme.            |
| 7. Responsive / layout          | warn  | Stacks fine, but long monospace URLs have no wrap/overflow treatment at ~640px.                                 |
| 8. Spacing, alignment & sizing  | fail  | Browser-default `dl`/`dt`/`dd` margins; no `--gap-*` tokens; cramped, uneven vertical rhythm.                   |
| 9. Interaction & micro-states   | warn  | Busy "Revealing…" + disabled-in-flight is good; but no hover/active on native button, no re-hide, no copy.      |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Section bypasses the design system entirely

- **Dimension:** 3. Consistency with the design system
- **Where visible:** all states (Populated, Error, Loading, Not provisioned)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:71` (raw `<section>`), `:72` (`<h2>`), `:80` (`<dl>`), `:95` (`<button>`)
- **Suggested fix:** Recompose with `PageHeader` (title "My Kaneo access"), `Field`/`Btn` primitives, and `.settings-section`, matching sibling sections instead of raw elements — this is the root cause of most findings below.

### [High] Error state does not read as an error

- **Dimension:** 4. Feedback & state · 6. Accessibility
- **Where visible:** Error state (the word "boom" renders as tiny default-grey text, indistinguishable from normal body copy)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:78` — `<p class="error">`; `.error` is undefined in the settings scope (only `.status-error` exists, `settings.css:91`)
- **Suggested fix:** Use the shared `.status-error` (danger-colored) class so failures are visibly alarming, as siblings do.

### [High] One-time revealed password has no copy affordance and cannot be re-hidden

- **Dimension:** 9. Interaction & micro-states · 5. Content & language
- **Where visible:** Populated — password revealed (password shown as small inline `<code>`, no button, no container)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:92`
- **Suggested fix:** Present the once-only secret with a copy-to-clipboard control (and optional show/hide toggle) in a clearly delimited container, since manual selection of tiny monospace text invites transcription errors for a value shown exactly once.

### [Med] Workspace URL link is low-contrast on the dark theme

- **Dimension:** 6. Accessibility
- **Where visible:** Populated / password-revealed (URL renders in browser-default `#0000EE` blue)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:85` — bare `<a>` with no design-system link styling
- **Suggested fix:** Style the link with a theme token (e.g. accent/link color used elsewhere) so it meets contrast against `--bg`.

### [Med] Flat visual hierarchy — label and value tiers collapse

- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Populated (Login email / Workspace URL / Status labels sit at nearly the same size/weight as their values)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:80`–`89`
- **Suggested fix:** Adopt the `Field` label/value rhythm (uppercase caption label + `.t-mono-data` value) so labels and values are visually distinct tiers.

### [Med] Spacing not drawn from the shared scale

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated (cramped, zero-gap rows using browser-default `dl` margins)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:80`–`89` (no styles defined; UA defaults apply)
- **Suggested fix:** Lay out rows with the `--gap-field` / `--gap-inline` tokens (via `Field`/flex layout) instead of relying on default `dl`/`dt`/`dd` margins.

### [Low] "Not provisioned" empty state is an actionless dead-end

- **Dimension:** 5. Content & language
- **Where visible:** Not provisioned (single sentence, no component, no next step)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:76`
- **Suggested fix:** Use `EmptyState` with an actionable hint (e.g. a link/route to request access) rather than a bare "contact your group admin" line.

### [Low] Loading state is unstyled bare text

- **Dimension:** 4. Feedback & state
- **Where visible:** Loading ("Loading…" in default text color)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:74`
- **Suggested fix:** Apply the shared `.placeholder` class (muted color) used by sibling loading states.

### [Low] Long workspace URL has no wrap/overflow handling

- **Dimension:** 7. Responsive / layout
- **Where visible:** Populated — narrow (~640px); a long monospace URL can overrun its line
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:85`
- **Suggested fix:** Allow the URL to wrap/break (word-break/overflow-wrap) so long workspace hosts don't overflow at narrow widths.
