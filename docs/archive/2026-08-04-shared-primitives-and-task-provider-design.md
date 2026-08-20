<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shared primitives + TaskProviderSection close-out — design

**Status:** approved in brainstorming, pending spec review
**Branch:** `ui-ux-review-01` (no merge, no push)
**Predecessor:** `docs/superpowers/specs/2026-08-04-provider-pair-open-findings-design.md`

## Goal

Close three open UX findings — two anchored in shared UI primitives, one at a
section call site — taking `TaskProviderSection` to `0 open` and dropping the
backlog from 26 to 23. Additionally record a decision on a fourth finding that
is not a defect.

| Finding | Severity | Home |
| --- | --- | --- |
| `task-provider-empty-secret-blank-pill` | Med | `client/shared/ui/Secret.svelte` + fixture |
| `ai-output-toggle-no-feedback` | Low | `client/shared/ui/SegmentedControl.svelte` |
| `task-provider-summary-list-no-inset` | Low | `TaskProviderSection.svelte` call site |
| `debug-icon-buttons-control-height` | Low | **decision only — no code change** |

## Why these three are one project

They were selected by asking which open findings live in shared primitives,
because a shared-primitive change moves many sections' screenshot baselines at
once. Doing such changes *after* verifying a section's screenshots would
invalidate work already proven, forcing a re-shoot and re-read of everything.

Investigation during brainstorming narrowed that set considerably. The backlog
summary lines implied five shared findings; only two survived scrutiny. The
third item here is section-local but included because it is the last finding
standing between `TaskProviderSection` and `0 open`, and its analysis is
adjacent to the first item's.

### Investigation findings that shaped this spec

Three of the five candidates were reclassified. These conclusions are recorded
because they are non-obvious and a future reader would otherwise re-derive them:

1. **`repos-no-heading-element` is already narrowed.** The `PageHeader.svelte`
   half is fixed; the residual is `ReposSection.svelte:159` promoting an
   "Add repository" `<p>` to `<h3>`. Section-local. Belongs to a Repos batch.

2. **`debug-icon-buttons-control-height` is not a defect.** The finding states
   "no action needed"; 24px *meets* WCAG 2.2 SC 2.5.8 (Target Size Minimum)
   rather than violating it. It was filed as a shared-token fact with an
   explicit warning not to "fix" it locally in `DebugApp`. See "Decision"
   below.

3. **`task-provider-summary-list-no-inset` must be fixed at the call site, not
   in the primitive.** `SummaryList` has six consumers. Five are debug detail
   panels (`TraceDetail`, `LogDetail`, `FailureDetail`, `TurnDetail`,
   `SessionDetail`), all rendered inside `DebugDetailRail`'s
   `.debug-detail-rail__body`, which supplies `padding: 12px 14px`
   (`DebugDetailRail.svelte:106-110`). Only `TaskProviderSection`
   renders `SummaryList` bare. Adding padding to the primitive would
   double-pad five correct consumers to fix one broken one.

## Item 1 — `Secret` empty-value guard + fixture correction

### The finding is about an unreachable state

`task-provider-empty-secret-blank-pill` reports that a sensitive field with
`hasValue: true` and `value: ''` renders a blank masked pill, because
`maskSecret('')` (`client/settings/lib/mask-secret.ts:7-9`,
`value.replace(/\*/gu, '•')`) returns `''` — there are no `*` characters to
substitute.

That state cannot be produced by the server:

- `maskSensitiveValue` (`src/config.ts:144-146`) returns
  `` `****${value.slice(-4)}` `` — never empty.
- The three routes feeding `ConfigFieldRow` all gate on non-empty raw input and
  then apply that mask: `config-routes.ts:38,49`,
  `byok-field-response.ts:75,79`, `coding-credentials-routes.ts:68,75`. So
  `hasValue: true` always implies a non-empty `****xxxx` value.
- `plugins-routes.ts:36` does emit `hasValue` with no `value` at all, but plugin
  fields are typed `PluginConfigFieldSchema = StoredConfigValueSchema.omit({ value: true })`
  (`client/settings/fetcher-schemas.ts:151`) and render through
  `PluginsSection.svelte`, never `ConfigFieldRow`.

The `Bound` fixture invented the state by setting `hasValue: true, value: ''`.

### Resolution

Two changes, deliberately both:

**Correct the fixture.** `client/stories/msw/settings-handlers-task-provider.ts`
(the `kaneo_apikey` field, lines 26-35) sets `value: '****WvfQ'`. `Bound-1.png`
then renders `••••WvfQ`.

**Add a narrow guard to the primitive.** `client/shared/ui/Secret.svelte:15`
already declares `let { value = '••••••••', hint, onReveal }: Props = $props()`
— the component *already* defines a placeholder. It never fires here because a
Svelte default applies only when the prop is `undefined`, and `ConfigFieldRow`
passes an explicit `''` returned by `maskSecret`.

The guard therefore treats an empty string the same as an absent value, falling
back to the component's existing `'••••••••'` default. **Do not introduce a new
placeholder glyph** — the eight-bullet default is the codebase's own answer, and
a second variant would make two `Secret` renderings disagree about what "a
stored secret" looks like.

This lands in `Secret.svelte` rather than `maskSecret` so that `maskSecret`
remains a pure string normalizer and all six `Secret` consumers
(`TaskProviderSection`, `CodeHostSection`, `CodingCredentialsSection`,
`AdminAnalyticsSection`, `AdminPluginsConfigSection`, `ConfigFieldRow`) inherit
the protection.

**The finding's resolution text must record that production cannot reach the
empty state**, citing the route analysis above. Without that note a future
reader will conclude the server once emitted blank secrets and reason from a
false premise.

### Why keep the guard if the state is unreachable

The guard is defense-in-depth against a future route populating a `ConfigField`
without going through `maskSensitiveValue`. It is one branch. It is documented
as such, not as a bug fix.

## Item 2 — `SegmentedControl` busy state

### Current behaviour

`ConfigFieldRow.saveEnum` (`:107-122`) sets `saving = true`, updates `current`
optimistically, and passes `disabled={saving}` to `SegmentedControl` (`:133`).
`SegmentedControl` dims to `opacity: 0.5` with `cursor: not-allowed`
(`:73-76`). There is no distinct busy cue, so a slow save and a merely-disabled
control are indistinguishable — and nothing is exposed to assistive tech.

The text-field `Save` button in the same primitive already swaps its label to
`Saving…` (`ConfigFieldRow.svelte:177`), so the pattern exists but was never
extended to the segmented control. A segmented control cannot borrow it
directly: its labels *are* its values.

### Resolution

Add an optional `busy?: boolean` prop to
`client/shared/ui/SegmentedControl.svelte`, defaulting to `false`. When `busy`:

- keep the existing disabled dim;
- render a `Saving…` caption adjacent to the control, reusing the wording
  already established by the `Save` button;
- set `aria-busy="true"` on the control.

`ConfigFieldRow.svelte:133` passes `busy={saving}` alongside its existing
`disabled={saving}`.

The default of `false` means the three other consumers — `ToolsSection`,
`AnalyticsPreferencesSection`, `SettingsFieldShell` — render identically and
their baselines do not move.

### Why a caption and not an animation

The finding suggested a pulsing accent. A static caption was chosen instead
because it needs no `prefers-reduced-motion` fallback, is deterministic to
capture in a screenshot test, reuses the codebase's existing busy vocabulary,
and — paired with `aria-busy` — actually reaches screen-reader users, which an
opacity change never did.

## Item 3 — `TaskProviderSection` provision-reveal inset

`SummaryList.svelte:36-39` sets `display: grid; column-gap: 32px` with no
horizontal padding, and `.ui-summary__row` (`:40-48`) has none either.
`TaskProviderSection.svelte:173-176` renders it directly inside
`.settings-provision__reveal` with no wrapping inset, so revealed values sit
flush at the viewport edge — visible in
`TaskProvider-—-provision-reveal-1.png` at 1280px, where
`demo-user@example.invalid` and `https://kaneo.example` terminate at x≈1280
while sibling `ConfigFieldRow` cards inset ~16px (their `Clear` ends at x≈1264).

**Resolution:** `.settings-provision__reveal` currently has **no style rule at
all** — it is an unstyled `<div>`. Add one giving it
`padding-inline: var(--gap-inline)`, the same token the sibling cards use via
`SettingsFieldShell.svelte:81` (`padding: var(--gap-inline)`, 12px).
`SummaryList.svelte` is not modified, for the double-padding reason above.

Note that `--gap-inline` is 12px while the finding measured the cards' content
edge at ~16px from the viewport (`Clear` ending at x≈1264). The difference comes
from container-level inset outside the card, not from the card's own padding.
The acceptance criterion is therefore **alignment, not a pixel count**: in the
re-shot `TaskProvider-—-provision-reveal-1.png`, the `SummaryList` values' right
edge must line up with the sibling `Clear` button's right edge. If
`var(--gap-inline)` alone does not achieve that, the reveal block needs the same
container treatment as the cards rather than a hand-tuned one-off px value —
matching the token scale is the point of the finding.

## Decision — `debug-icon-buttons-control-height`

No code change. The finding records that `Btn`'s `sm` size consumes
`--control-h-sm: 24px` (`client/shared/tokens.css:63`), that this meets WCAG 2.2
SC 2.5.8, and that any change belongs in the token rather than in `DebugApp`.

**Recommendation:** close as `superseded`, preserving the WCAG analysis and the
warning against local "fixes" in the resolution text. Raising `--control-h-sm`
app-wide would move nearly every baseline in the audit and is a design-system
decision, not a bug fix — if wanted, it deserves its own project.

**This recommendation requires explicit sign-off at spec review.** If it is not
approved, the finding stays `open` and the backlog lands at 23 rather than 22.

## Verification

The visual audit is green by construction after a re-shoot, so a passing audit
is not evidence. Every changed PNG must be read and described.

**Baselines re-shot (2):**
- `settings-sections-TaskProviderSection-Bound-1.png` — must show `••••WvfQ`,
  not a blank pill.
- `TaskProvider-—-provision-reveal-1.png` — values must no longer terminate at
  the viewport edge; inset must match the sibling cards.

**Baseline added (1):** a busy-frame case capturing `SegmentedControl` with the
`Saving…` caption.

**Audit floor: 466 → 467.**

Consumers whose baselines must be confirmed *unchanged*: the five debug
`SummaryList` panels, and the three non-`ConfigFieldRow` `SegmentedControl`
consumers. A change in any of those means the fix leaked past its intended
scope.

## Testing

Unit tests:
- `Secret` falls back to its `'••••••••'` default for an empty-string value,
  and renders the real masked value otherwise.
- `SegmentedControl` renders the caption and `aria-busy="true"` when `busy`, and
  neither when not.
- `ConfigFieldRow` passes `busy` in step with `saving`.

Gates, all run unfiltered: full `bun test`, `bun run visual:audit`,
`bun security`, plus `bun test tests/scripts/ux-backlog.test.ts` after the docs
loop.

If a pre-existing test needs to change, that is escalated rather than edited.
The predecessor project's list of tests-that-may-change was wrong four separate
times, and every implementer who escalated instead of editing was correct to.

## Closing the loop

Three findings flip to `fixed`, each with a `- **Resolved:**` line citing a real
commit hash — the backlog parser fails loud without one. Statuses are exactly
`open` / `fixed` / `superseded`; there is no `partial`, and a partially-fixed
finding stays `open` with its text narrowed to the residue.

Scorecards re-scored: `TaskProviderSection` dimensions 4 and 8, `AiOutputSection`
dimension 9. Dimension 8 currently reads `warn` solely because of item 3 and
returns to `pass` when it closes.

`docs/ux-reviews/_BACKLOG.md` is regenerated with `bun run ux:backlog` and never
hand-edited.

**Expected end state:** 23 open (22 if the control-height decision is approved),
`TaskProviderSection` 0 open, `AiOutputSection` 1 open.

Report whatever the generator actually produces. A count reached by declaring a
residual defect fixed is a failure however green the audit is.

## Risks

- **The `Secret` guard leaks.** Six consumers render `Secret`; a change to its
  empty-value path could alter any of them. Mitigated by the guard firing only
  on empty input, which no current route produces.
- **The caption shifts layout.** Adding text next to `SegmentedControl` may
  reflow `ConfigFieldRow`. The busy-frame baseline is what proves it does not
  clip or displace neighbours.
- **Fixture correction is mistaken for hiding a defect.** The predecessor
  project's standing rule is never to prettify a fixture to make a defect
  disappear. This is the mirror case — a fixture fabricating a state the server
  cannot emit — and the distinction is recorded in the finding's resolution text
  so the change is not misread later.

## Success criteria

- Three findings `fixed` with real commit hashes; the control-height decision
  recorded either way.
- `TaskProviderSection` at `0 open`.
- Audit at 467, unfiltered, with every changed PNG read and described, and the
  unaffected-consumer baselines confirmed unchanged.
- Full `bun test`, `bun security` clean.
- All work on `ui-ux-review-01`. No merge, no push.
