<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0270: Kaneo Access UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-08

## Context

`KaneoAccessSection` (`client/settings/sections/KaneoAccessSection.svelte`) — the per-user "My Kaneo access" surface that displays the login email, workspace URL, account status, and the one-time revealed Kaneo password (originally shipped by ADR-0215) — scored 4 `fail` / 4 `warn` / 1 `pass` in its UX review (`docs/ux-reviews/KaneoAccessSection.md`). The section was a clear outlier: it rendered raw `<h2>`, `<button>`, `<dl>`, `<a>`, and a one-off `.error` class with **zero shared design-system primitives**, while every sibling settings section composes `PageHeader` / `KV` / `StatusPill` / `Btn` / `ErrorState` / `EmptyState`. The result was UA-default styling (grey native button, browser-default `#0000EE` links, cramped `dl` margins) on a security-sensitive surface — the once-only password reveal. Nearly all nine findings traced to that single root cause: the section bypassed the design system entirely (High), the error state did not read as an error (High), and the revealed password had no copy affordance (High), plus med/low findings on link contrast, flat hierarchy, off-scale spacing, an actionless not-provisioned dead-end, an unstyled loading line, and long-URL overflow.

The design (`docs/superpowers/specs/2026-07-08-kaneo-access-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-08-kaneo-access-ux-fixes.md`) resolved all nine findings in one coherent pass with a **pure presentation refactor**: the `<script>` logic (load / `revealPassword` / state machine / stale-`contextId` guard) is left byte-for-byte unchanged, and only the template markup and a new `<style>` block are replaced — raw elements become `PageHeader` + `IconButton` + `KV` + `StatusPill` + `Btn` + `Code` + `CopyButton` + `ErrorState` + `EmptyState`. No backend, route, fetcher, or behavior change; no new primitives. Two existing unit tests that coupled to the old markup (`'No Kaneo access yet'` copy, `data-testid="kaneo-reveal"` selector) were updated to the new contract.

## Decision Drivers

- **Recompose onto the canonical sibling pattern, not patch symptoms.** Adopt the `PageHeader` / `KV` / `ErrorState` / `EmptyState` shell every sibling section uses, resolving the root cause (finding 1) and most downstream findings (5, 6) in one pass rather than adding ad-hoc styles per finding.
- **Errors must read as errors; loads must read as loads.** Replace the undefined `.error` class with the shared `ErrorState` (danger-colored, `role="alert"`, retry) and apply the `.placeholder` token to the loading line (findings 2, 8).
- **The one-time secret needs a real copy affordance.** Present the revealed password in a bordered mono `Code` box with a `CopyButton` and a "shown once" warning, eliminating transcription error on a value shown exactly once (finding 3).
- **Workspace URL must meet contrast and wrap.** Style the anchor with `var(--accent)` and `overflow-wrap: anywhere` so it passes contrast on the near-black theme and long hosts reflow at narrow widths instead of overflowing (findings 4, 9).
- **Not-provisioned is informative, not a dead-end.** Use `EmptyState` with an explanatory hint rather than a bare sentence; no provisioning action is duplicated here because it already lives, scope-gated, in the Task Provider section (finding 7).
- **Preserve all behavior.** The `<script>` state machine (initial load, `404 → notProvisioned`, error capture, `revealing`/`revealedPassword` reveal flow, stale-`contextId` guard) is untouched; only presentation changes.
- **Additive-only.** No new primitives, no new files — every component already exists under `client/shared/ui/`.

## Considered Options

### Option 1 — full recompose onto shared primitives; presentation-only refactor (chosen)

Rewrite the template of the single `.svelte` file to compose `PageHeader` + `IconButton` (refresh) + `KV` rows + `StatusPill` + accent-wrapped anchor + `Btn` reveal + `Code`/`CopyButton` secret + `ErrorState` + `EmptyState` + `.placeholder`; add a section `<style>` for the URL-wrap override and the password-block layout; leave the `<script>` logic unchanged; update the two markup-coupled unit-test selectors.

- **Pros:** resolves all nine findings at the root; converges on the sibling convention so the section stops being an outlier; zero backend/behavior risk (logic untouched); no new primitives or files; the two test edits are selector/copy only, not behavior.
- **Cons:** the section gains a `<style>` block and several local classes (`.kaneo-rows`, `.kaneo-url`, `.kaneo-pw*`) it previously lacked; `PageHeader`'s title is a styled `<div>`, not `<h2>`, so the section loses a heading semantic (accepted — every sibling already made this trade).

### Option 2 — per-finding patches on the existing raw markup

Keep the raw `<h2>`/`<dl>`/`<a>`/`<button>` and add scoped CSS rules to fix link color, `dl` spacing, error styling, and URL wrap in place.

- **Pros:** smallest diff; no primitive imports; no markup restructure.
- **Cons:** leaves the root cause (finding 1) unaddressed — the section stays a design-system outlier; duplicates styling the shared primitives already provide; the copy-affordance finding (3) still needs `Code`+`CopyButton` (or a hand-rolled copy button); future sibling changes drift further apart.

### Option 3 — extract an `IdentityForm`-style subcomponent + adopt the `Field`/`Input` primitives

Lift the credential rows into a child component and render them through the shared `Field`/`Input` pair (as `IdentitySection` did in ADR-0258).

- **Pros:** cleanest separation; rows become a reusable unit.
- **Cons:** over-engineered — the rows are read-only `KV` displays, not editable form fields, so `Field`/`Input` (which add labels, validation, `aria-describedby` wiring) are the wrong primitives; one extra file and indirection for a read-only surface with a single consumer.

## Decision

The chosen Option 1 shipped in full across the recomposed section, its two updated unit-test selectors, and the (pre-existing, refreshed) stories and visual screenshot spec. What shipped:

1. **New primitive imports (`KaneoAccessSection.svelte`).** The `<script>` import list gains `Btn`, `Code`, `CopyButton`, `EmptyState`, `ErrorState`, `IconButton`, `KV`, `PageHeader`, `StatusPill` alongside the four pre-existing imports — every other line of `<script>` (the `Props` interface, `$state`, `load`, `revealPassword`, `$effect`) is byte-for-byte unchanged.
2. **Section shell + header.** `<section id="kaneo-access" class="settings-section">` wraps a `PageHeader eyebrow="Personal" title="My Kaneo access"` whose `action` snippet is an `IconButton` Refresh (`glyph="⟳"`, `busy={loading}`, `testid="kaneo-refresh"`) — a refresh affordance the section previously lacked, matching siblings. The `id="kaneo-access"` nav scroll-target is preserved.
3. **State branches.** Template branch order is unchanged (`loading` → `notProvisioned` → `error` → `credentials`): loading renders `<p class="placeholder">Loading…</p>`; not-provisioned renders `EmptyState title="No Kaneo access yet"` with an explanatory hint; error renders `ErrorState message={error} onRetry={() => void load(contextId)}`.
4. **Credential rows (populated).** Login email is a plain `KV` row; Workspace URL is a `KV` whose value snippet wraps an accent-colored, wrapping anchor (`color: var(--accent)`, `overflow-wrap: anywhere`) rendered only when `kaneoUrl !== null`; Status is a `KV` whose value is a `StatusPill`.
5. **Password reveal.** Before reveal, a `Btn variant="secondary" size="sm" disabled={revealing} testid="kaneo-reveal"` swaps its label between **Reveal password** / **Revealing…**. After reveal, a bordered mono `Code truncate={false}` box plus a `CopyButton label="Copy password"` and a `.placeholder` "shown once" warning replace the bare inline `<code>`.
6. **Section `<style>`.** A new block carries `.kaneo-rows` (flex column, `--gap-inline`), the `.kaneo-url :global(.ui-kv__v)` wrap override (defeats `KV`'s default `nowrap`+ellipsis for this row only), `.kaneo-url__link` (accent + anywhere-wrap), `.kaneo-pw` / `.kaneo-pw__label` / `.kaneo-pw__row` / `.kaneo-pw__reveal` for the password block.
7. **Unit-test contract update.** `tests/client/settings/sections/KaneoAccessSection.test.ts` — the not-provisioned assertion now checks `'No Kaneo access yet'` and the reveal-button selector now uses `button[data-testid="kaneo-reveal"]`; the 4-test suite (login email, not-provisioned, reveal POST, workspace URL) stays green.
8. **Visual baseline refresh (untracked).** Task 2 re-shot the eight `KaneoAccessSection` states (Populated, Not provisioned, Error, Loading, password-revealed, hover, narrow, not-provisioned narrow) via `bun shoot -g KaneoAccessSection`; baselines are gitignored local artifacts.

## Consequences

### Positive

- The section is no longer a design-system outlier: header rhythm, label/value tiers, error treatment, empty state, and button affordances now match every sibling.
- Load failures are recoverable in place (`ErrorState` + retry replaces an indistinguishable grey string); loading is visibly muted via `.placeholder`.
- The once-only password is presented in a bordered, copyable mono box with a clear "shown once" warning, removing transcription-error risk on a value that cannot be re-shown.
- The workspace URL meets contrast on the dark theme (`var(--accent)`) and reflows at narrow widths instead of overflowing.
- Not-provisioned is an informative framed state with an explanatory hint rather than a bare actionless sentence.
- Behavior is fully preserved: the `<script>` state machine, the `404 → notProvisioned` path, the stale-`contextId` guard, and the reveal flow are untouched, so the refactor carries no backend/behavior risk.

### Negative

- The section gained a `<style>` block and several local classes (`.kaneo-rows`, `.kaneo-url`, `.kaneo-pw*`) it previously lacked, adding a small amount of section-local CSS to maintain.
- `PageHeader`'s title is a styled `<div>`, so the section lost its `<h2>` heading semantic — the same trade every sibling already made for consistency.
- `.storybook-shots/` baselines are gitignored, so the visual states are verified locally/in CI runs rather than reviewed as committed images.

### Risks

- **Spec drift in cited line numbers.** The plan referenced `SettingsApp.svelte:113` for the nav scroll-target invariant; the `{ id: 'kaneo-access' }` entry actually lives at `SettingsApp.svelte:117` in the current tree. The invariant holds; only the doc's line number drifted as `SettingsApp` grew — future plan edits should re-verify cited lines.
- **Inline surfacing of backend errors.** `ErrorState` surfaces the raw backend message (acceptable because the user can retry), which could expose an unhelpful string if the backend message is poor.
- **`.kaneo-url :global(.ui-kv__v)` is a scoped escape hatch.** It overrides `KV`'s default `nowrap`+ellipsis for the URL row only; if `KV`'s value styling contract changes, this row's wrap behavior must be re-checked.

## Related Decisions

- **ADR-0215: Kaneo Group-Member Provisioning** — shipped the original `KaneoAccessSection` (raw `<h2>`/`<dl>`/`<button>`/`.error` markup) and the `/settings/api/kaneo/credentials` + reveal endpoints this refactor re-presents unchanged.
- **UX review source** — `docs/ux-reviews/KaneoAccessSection.md` (the nine findings this resolves).
- **ADR-0253: ReleaseSubscriptionSection UX Fixes** and **ADR-0258: Identity Section UX Fixes** — established the `ErrorState`/`EmptyState`/`PageHeader`/`IconButton` busy conventions and the render-state pattern this section converges on; this ADR is the presentation-only (no state-machine change) case of the same batch.
- The shared-primitive conventions (`KV`, `StatusPill`, `Btn`, `Code`, `CopyButton`) under `client/shared/ui/` that this section adopts.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/KaneoAccessSection.svelte:7-10` | Original four imports retained (KaneoCredentials type/schema, `revealKaneoPassword`/`settingsFetch`, `readBody`). | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:11-19` | Nine new primitive imports added: `Btn`, `Code`, `CopyButton`, `EmptyState`, `ErrorState`, `IconButton`, `KV`, `PageHeader`, `StatusPill`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:27-32` | Unchanged `$state`: `credentials`/`notProvisioned`/`loading`/`error`/`revealedPassword`/`revealing`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:34-59` | Unchanged `load()`: `404 → notProvisioned`, error capture, stale-`contextId` guard. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:61-63` | Unchanged `$effect(() => void load(contextId))`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:65-77` | Unchanged `revealPassword()`: `revealing` flag, `revealKaneoPassword`, error capture. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:80` | `<section id="kaneo-access" class="settings-section">` — `id` preserved for the nav scroll-target. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:81-90` | `PageHeader eyebrow="Personal" title="My Kaneo access"` + `IconButton` Refresh action (`glyph="⟳"`, `busy={loading}`, `testid="kaneo-refresh"`). | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:92-93` | `loading` → `<p class="placeholder">Loading…</p>`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:94-97` | `notProvisioned` → `EmptyState title="No Kaneo access yet"` + hint. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:98-99` | `error` → `ErrorState message={error} onRetry={() => void load(contextId)}`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:100-119` | `credentials` → `KV` rows: Login email, Workspace URL (when `kaneoUrl !== null`), Status. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:104-114` | Workspace URL `KV` with `.kaneo-url__link` accent anchor (`color: var(--accent)`, `overflow-wrap: anywhere`). | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:116-118` | Status `KV` whose value snippet is `<StatusPill status={credentials.status} />`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:121-129` | `revealedPassword` → `Code truncate={false}` + `CopyButton label="Copy password"` + `.placeholder` "shown once" warning. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:130-141` | Reveal `Btn variant="secondary" size="sm" disabled={revealing} testid="kaneo-reveal"`, label swaps **Reveal password**/`Revealing…`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:145-185` | New `<style>` block (`.kaneo-rows`, `.kaneo-url` override, `.kaneo-url__link`, `.kaneo-pw`, `.kaneo-pw__label`, `.kaneo-pw__row`, `.kaneo-pw__reveal`). | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:152-157` | `.kaneo-url :global(.ui-kv__v) { white-space: normal; overflow: visible; text-overflow: clip; }` — defeats `KV` nowrap+ellipsis for the URL row. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:158-161` | `.kaneo-url__link { color: var(--accent); overflow-wrap: anywhere; }`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:168-175` | `.kaneo-pw__label` tokenized mono caption (`var(--font-mono)`, 10px, uppercase, `var(--fg3)`). | `read` confirms. |
| `tests/client/settings/sections/KaneoAccessSection.test.ts:54` | Not-provisioned asserts `'No Kaneo access yet'` (was `'not provisioned'`). | `read` confirms. |
| `tests/client/settings/sections/KaneoAccessSection.test.ts:80` | Reveal selector `button[data-testid="kaneo-reveal"]` (was `button[data-action="reveal-password"]`). | `read` confirms. |
| `tests/client/settings/sections/KaneoAccessSection.test.ts:30-103` | 4-test suite: login email, not-provisioned (404), reveal POST reveals `Secret1!Aa`, workspace URL present. | `read` confirms. |
| `client/settings/SettingsApp.svelte:117` | Nav scroll-target `{ id: 'kaneo-access', label: 'My Kaneo access' }` — `id` preserved. | `grep` confirms. |
| `client/settings/sections/KaneoAccessSection.stories.svelte:20-30` | Pre-existing Populated / Not provisioned / Error / Loading stories (fixture-keyed). | `read` confirms. |
| `tests/visual/settings/sections/KaneoAccessSection.spec.ts:9-29` | Four auto-screenshots: Populated, Not provisioned, Error, Loading. | `read` confirms. |
| `tests/visual/settings/sections/KaneoAccessSection.spec.ts:32-55` | Four manual shots: password-revealed, reveal-button hover, Populated narrow 640, Not-provisioned narrow 640. | `read` confirms. |
| `client/stories/msw/scenarios.ts:110-113` | `settings-kaneo-{populated,not-provisioned,error,loading}` scenario keys (pre-existing, reused unchanged). | `grep` confirms. |

Plan-vs-implementation notes:

- **Reveal `onClick` uses an arrow wrapper that discards the floating promise.** Spec §4 wrote `onClick={revealPassword}`; shipped uses `onClick={() => void revealPassword()}` (`KaneoAccessSection.svelte:137`), matching the plan's Step 4 task code and the Refresh icon's `() => void load(contextId)` — both `load` and `revealPassword` are async, so the `void` wrapper explicitly discards the floating promise. The spec's snippet was the simplified form; the plan's task code (which shipped) is the authoritative one.
- **`.kaneo-pw__label` is a section-local class, not the shared `.ui-field__label`.** Spec §4's snippet used `<span class="ui-field__label">Password (shown once)</span>`; the plan's Step 4/5 introduced a dedicated `.kaneo-pw__label` with a tokenized mono caption style (`var(--font-mono)`, 10px, weight 600, `0.08em` tracking, uppercase, `var(--fg3)`). Shipped follows the plan — the local class gives the one-time-secret caption a distinct treatment from regular editable-field labels (this is a read-only secret display, not a `Field`/`Input`).
- **Plan's `SettingsApp.svelte:113` line reference is stale.** The nav scroll-target `{ id: 'kaneo-access' }` actually lives at `SettingsApp.svelte:117` in the current tree. The "MUST be preserved" invariant is honored; only the plan's cited line number drifted as `SettingsApp` grew.
- **`.storybook-shots/` baselines are gitignored.** Task 2's `bun shoot -g KaneoAccessSection` re-shoot produces local-only PNGs under `.storybook-shots/`; they are not committed artifacts, so visual verification is a local/CI activity (consistent with sibling ADRs 0253/0258). No tracked file changed for Task 2.
- **No new MSW handler families.** The plan/spec correctly scoped this as presentation-only; the four `settings-kaneo-*` scenario keys (`scenarios.ts:110-113`) and the underlying Kaneo handler family pre-existed from ADR-0215 and were reused unchanged. No new fixtures were needed.
- **No new tracked files.** Per the plan's "No new files" invariant: every primitive pre-existed under `client/shared/ui/`, the stories and visual spec pre-existed, and only the one `.svelte` component plus its test were modified. This is the smallest-blast-radius case of the UX-fix batch.

The source plan `docs/superpowers/plans/2026-07-08-kaneo-access-ux-fixes.md` and design `docs/superpowers/specs/2026-07-08-kaneo-access-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
