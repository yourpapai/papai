<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0248: ProfileSection UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-02

## Context

A 9-dimension UX re-review of the settings Profile section surfaced 8 findings (4 Med, 4 Low). Several were not ProfileSection-local — they lived in shared design-system code and recurred across every settings section that renders config fields (`ProfileSection`, `TaskProviderSection`, `AiOutputSection` all share `ConfigFieldRow`, `EmptyState`, and the `Btn`/`Input`/`IconButton` primitives). The headline problems: every save/clear triggered a full-section `Loading…` flash that wiped all fields; errors rendered as a raw red `<p>` with only an unlabeled `⟳` glyph to retry; the "Clear" button was a `ghost` (transparent) control indistinguishable from its label yet gated a destructive confirm; and several contrast/radius/spacing tokens were off the shared scale or below WCAG AA.

The design (`docs/superpowers/specs/2026-07-02-profilesection-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-02-profilesection-ux-fixes.md`) chose a **full design-system sweep** rather than a Profile-only patch: fix the shared primitives and tokens so all three config sections improve together. The one behavioral change is a loading guard ("keep fields on refresh"); everything else is CSS or composition.

## Decision Drivers

- **Keep fields on refresh.** The full-section `Loading…` placeholder must render only on the initial load (no data yet), never on a post-save refetch — the header `⟳` `busy` spin becomes the refresh signal.
- **One shared error component, reused everywhere.** A framed `ErrorState` (icon + title + message + optional retry) mirrors `EmptyState`'s layout and replaces the raw error `<p>` in all three sections; the retry is a real labeled button, not a glyph.
- **Sharpen the radius outlier, not blur the rule.** `Btn`/`Input` already use `2px`; reconcile `IconButton` (6px) onto a new shared `--radius-control: 2px` token so adjacent controls match, preserving the app's sharp-control aesthetic.
- **Outline, not ghost, for destructive-gated Clear.** A bordered `outline` button carries real affordance while the existing `Confirm` dialog continues to gate the destructive action — no red-on-every-row needed.
- **Tokenize, don't hardcode.** Add `--gap-tight: 8px` and fold the hardcoded field/control px onto the `--gap-*` / `--radius*` scales so the design system stays the single source of spacing.
- **AA contrast.** The `EmptyState` hint (`--fg3`, ≈4:1) is below WCAG AA for 11px normal text; a size bump cannot fix that, so it must be a color change to `--fg2` (≈7:1).
- **Source-assertion tests for CSS.** happy-dom does not reliably compute scoped-CSS custom properties, so radius/contrast fixes are guarded by reading the source (the repo's existing `tokens.test.ts` pattern), not by asserting computed style.

## Considered Options

### Option 1 — Full design-system sweep: tokens → shared components → section wiring (chosen)

Add the two tokens first, reconcile the three control primitives onto `--radius-control`, build the shared `ErrorState`, fix `ConfigFieldRow` (outline Clear + right-align + tokens) and `EmptyState` (AA hint), then wire the loading guard + `ErrorState` adoption across all three sections plus the Profile-local empty-action/intro copy.

- **Pros:** fixes all 8 findings at the root; Profile, TaskProvider, and AiOutput improve together for one round of work; shared `ErrorState`/tokens benefit ~12 other `EmptyState`/primitive users.
- **Cons:** broader blast radius (radius/spacing touch every `Btn`/`Input`/`IconButton`/config field) so regression risk is higher; more files than a Profile-only patch.

### Option 2 — Profile-only patch

Fix only the findings that live inside `ProfileSection.svelte`, leaving the shared primitives and tokens untouched.

- **Pros:** minimal, low-blast-radius change; no risk to other sections.
- **Cons:** rejects the root-cause scope — the loading flash, ghost Clear, and contrast issues would recur identically in TaskProvider/AiOutput, and the shared design-system debt would remain.

### Option 3 — Optimistic inline updates instead of the keep-fields-on-refresh guard

Rewrite the save data-flow to patch field state optimistically in place, eliminating the refetch entirely.

- **Pros:** no loading state to guard at all; snappier perceived save.
- **Cons:** explicitly rejected in the design as a bigger rewrite with staleness edge cases; out of scope for a UX-fixes pass built on CSS + composition.

## Decision

The chosen Option 1 shipped in full across tokens, primitives, a new shared component, and all three config sections. All 8 plan findings are covered and the core commit messages match the plan verbatim. What shipped:

1. **Tokens.** `--gap-tight: 8px` and `--radius-control: 2px` added to `client/shared/tokens.css`, guarded by `tests/client/shared/tokens.test.ts`.
2. **Control-radius reconciliation.** `Btn`, `Input`, and `IconButton` all point at `var(--radius-control)`, guarded by a source-assertion test (`tests/client/shared/ui/control-radius.test.ts`).
3. **EmptyState AA contrast.** `.ui-empty__hint` color changed `--fg3` → `--fg2`, guarded by a source-assertion test.
4. **Shared `ErrorState`.** New `client/shared/ui/ErrorState.svelte` (icon + title + message + optional outline retry button, `testid="error-retry"`), a Storybook story, and a render + retry-callback test.
5. **`ConfigFieldRow` Clear affordance.** Both Clear buttons switched `ghost` → `outline` (guarded by a test asserting `ui-btn--outline` / not `ui-btn--ghost`).
6. **ProfileSection.** Loading guard (`loading && visible.length === 0`), `ErrorState` on error, empty-state `action` snippet linking to `#task-provider`, sharpened empty hint copy, and a `PageHeader` `sub` intro. Field-list gap tokenized to `--gap-inline`.
7. **TaskProviderSection.** Loading guard keyed off `instanceData === null`, `ErrorState` adoption.
8. **AiOutputSection.** Loading guard keyed off `visible.length === 0`, `ErrorState` adoption.

## Consequences

### Positive

- Saving or clearing a field no longer wipes the whole section with a `Loading…` flash — fields stay on screen and the header `⟳` signals the refresh; all three config sections benefit from the one shared guard.
- Errors are now a recoverable, framed card with a labeled "Try again" button instead of a bare red line whose only retry was an unlabeled glyph.
- The Clear control reads as a button (bordered `outline`) while the confirm dialog still gates the destructive action.
- The design system gained two reusable tokens (`--gap-tight`, `--radius-control`); adjacent controls now share corners; the `EmptyState` hint meets WCAG AA across all ~12 consumers.
- Source-assertion tests pin the CSS fixes against happy-dom's unreliable custom-property computation.

### Negative

- The Task 5 layout edits landed in a **new** `SettingsFieldShell.svelte`, not in `ConfigFieldRow.svelte` as the plan specified — the field-row shell was extracted post-plan (see Implementation Notes), so the plan's line references into `ConfigFieldRow.svelte`'s `<style>` no longer apply.
- The `ProfileSection` unit test the plan mandated (`tests/client/settings/ProfileSection.test.ts`) was **not** created; ProfileSection behavior is covered by the visual spec and the shared-component/unit tests instead.
- TaskProvider's guard diverged into a `error !== null && instanceData === null` form that retains last-good data on a refetch *error* — a stronger guarantee than the spec's "out of scope" stance, and an inconsistency vs Profile/AiOutput (which wipe to `ErrorState` on any error).

### Risks

- **Radius/spacing sweep regression surface.** Pointing every `Btn`/`Input`/`IconButton` at one token and retokenizing every config field's spacing means an accidental token change now shifts the whole settings UI at once — mitigated by the source-assertion tests and visual re-baselines.
- **Divergent refetch-error behavior across sections.** Profile/AiOutput drop to `ErrorState` on a refetch error while TaskProvider keeps last-good data; a user moving between sections may see inconsistent recovery behavior.

## Related Decisions

- **ADR-0233: Release Announcement Subscriptions** — sibling settings-area work; its `ReleaseSubscriptionSection` later adopted the same shared `ErrorState`/loading-guard pattern this ADR introduced.
- The `SettingsFieldShell` extraction and the subsequent "refresh failure keeps loaded data" series (`GuestMode`, `TaskProvider`, `MemorySection`, `ReleaseSubscription`) built directly on the `ErrorState` component and the keep-data-on-refresh idea established here.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; all eight plan commit messages match the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/tokens.css:52,54` | Adds `--gap-tight: 8px` and `--radius-control: 2px`. | `read` confirms. |
| `tests/client/shared/tokens.test.ts` | Asserts both new tokens exist (layout + sizing case). | `glob` confirms; commit `962dbba56` touches it. |
| `client/shared/ui/Btn.svelte:63` | `border-radius: var(--radius-control)`. | `read` confirms. |
| `client/shared/ui/Input.svelte:91` | `border-radius: var(--radius-control)`. | `read` confirms. |
| `client/shared/ui/IconButton.svelte:37` | `border-radius: var(--radius-control)` (was `var(--radius)`). | `read` confirms. |
| `tests/client/shared/ui/control-radius.test.ts:12-18` | Source-asserts all three primitives use `var(--radius-control)`. | `read` confirms. |
| `client/shared/ui/EmptyState.svelte:48` | `.ui-empty__hint` color is `var(--fg2)` (AA). | `read` confirms. |
| `tests/client/shared/ui/EmptyState.test.ts:38-45` | Source-asserts the hint rule uses `--fg2`. | `read` confirms. |
| `client/shared/ui/ErrorState.svelte:1-62` | New shared error card; `role="alert"`, outline retry `Btn`, `testid="error-retry"`. | `read` confirms; matches plan verbatim. |
| `client/shared/ui/ErrorState.stories.svelte:17-18` | "With retry" + "Message only" stories. | `read` confirms. |
| `tests/client/shared/ui/ErrorState.test.ts:18-42` | Renders message/default title + retry-callback-fires tests. | `read` confirms. |
| `tests/visual/shared/ui/ErrorState.spec.ts` | Visual spec for the new story (Task 9). | `glob` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:128,152` | Both Clear buttons are `variant="outline"`. | `read` confirms. |
| `tests/client/settings/components/ConfigFieldRow.test.ts:535-556` | Asserts Clear has `ui-btn--outline`, not `ui-btn--ghost`. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:49-82` | Field shell owning the tokenized gaps/right-align (`.settings-field`/`__head`/`__editor`); `--gap-tight`, `--gap-inline`, `margin-right: auto`. | `read` confirms. |
| `client/settings/sections/ProfileSection.svelte:11,52,59-71,84` | `ErrorState` import; `PageHeader` `sub` intro; error→`ErrorState`; `loading && visible.length === 0` guard; empty-state `action`→`#task-provider`; `--gap-inline` list gap. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:10,113-116` | `ErrorState` import; guard `loading && instanceData === null`; `ErrorState` on error. | `read` confirms. |
| `client/settings/sections/AiOutputSection.svelte:11,67-70` | `ErrorState` import; `loading && visible.length === 0` guard; `ErrorState` on error. | `read` confirms. |
| `tests/visual/settings/sections/ProfileSection.spec.ts` | Visual spec covering ProfileSection states (Task 9 re-shoot). | `glob` confirms. |
| commits `962dbba56`…`09b27054e` | The 8 plan commit messages (`feat(tokens)…`, `…unify control radius`, `…EmptyState hint contrast`, `…shared ErrorState`, `…outline Clear`, `…ProfileSection keep-fields-on-refresh`, `…TaskProviderSection keep-data-on-refresh`, `…AiOutputSection keep-fields-on-refresh`, `test(visual): add ErrorState story spec`) match the plan verbatim. | `git log --grep` confirms. |

Plan-vs-implementation notes:

- **Task 5's layout/tokenization edits moved to `SettingsFieldShell.svelte`, not `ConfigFieldRow.svelte`.** The plan edited `.settings-field` / `.settings-field__head` / `.settings-field__editor` rules inside `ConfigFieldRow.svelte`'s `<style>`. The shipped tree extracts the field-row shell into a new `client/settings/components/SettingsFieldShell.svelte`, and those tokenized rules (gap `--gap-tight`, padding `--gap-inline`, `margin-right: auto` right-align) now live there (`SettingsFieldShell.svelte:49-82`). `ConfigFieldRow.svelte` retains only the Clear-`outline` change (Task 5's other half) and a `.settings-field__hint` rule; its `<style>` no longer contains the field/head/editor layout. Intent (right-align + tokenize) fully preserved; the host file changed. The shell also adds `border-radius: var(--radius-control)` and a required-marker `*` span beyond the plan.
- **The `ProfileSection` unit test was never created.** Task 6 mandated `tests/client/settings/ProfileSection.test.ts` (5 behavior tests). `glob` finds no such file. ProfileSection behavior is instead exercised by the shared-component tests (`ErrorState`, `EmptyState`, `ConfigFieldRow`) and the visual spec `tests/visual/settings/sections/ProfileSection.spec.ts`. The keep-fields-on-refresh guard and empty-action link are therefore covered only visually, not by a DOM-level assertion.
- **TaskProvider's error guard is stronger than the spec.** The plan/spec set the branch to `{#if error !== null}` → `ErrorState` and noted retaining last-good fields on a refetch *error* was out of scope. The shipped `TaskProviderSection.svelte:113` uses `{#if error !== null && instanceData === null}` → `ErrorState`, so a refetch error that arrives after data is loaded keeps the form visible (with an inline `status-error`) rather than replacing it. ProfileSection/AiOutput did not get this strengthening — they still drop to `ErrorState` on any error — so the three sections are now inconsistent on refetch-error recovery.
- **TaskProvider wraps the error message.** The plan wrote `<ErrorState message={error} ...>`; shipped uses `<ErrorState message={formatFetchError(error)} ...>` (TaskProvider's `error` is `unknown`, vs `string | null` in Profile/AiOutput). Cosmetic — same component, formatted input.
- **ProfileSection empty-action link gained a class.** The plan's `<a href="#task-provider">` shipped as `<a class="settings-empty-link" href="#task-provider">` with accent-color styling (`ProfileSection.svelte:69,87-95`). Minor enhancement.
- **`.settings-field` background token differs.** The plan used `var(--surface)` (a legacy alias); shipped uses the canonical `var(--surface-1)`. Equivalent rendering.

The source plan `docs/superpowers/plans/2026-07-02-profilesection-ux-fixes.md` and design `docs/superpowers/specs/2026-07-02-profilesection-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
