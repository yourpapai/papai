<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shared `settings.css` central fixes — design

Closes the three open findings whose fixes land in `client/settings/settings.css`. This is
sub-project 3 of the four that drain `docs/ux-reviews/_BACKLOG.md`; see "Position in the wider
backlog" at the end.

## Goal

Take the backlog from **14 open to 11 open** by fixing three shared rules *centrally*, so every
latent instance of each defect is corrected at once rather than only at the reported call site.
No visual baseline is added or orphaned. The audit floor stays at **467**.

## The three findings

| Id | Severity | Shared rule | Consumers |
| --- | --- | --- | --- |
| `code-host-setup-hint-unbounded-measure` | Med → **Low** (re-scored, see below) | `.placeholder` (`settings.css:97-99`) | 36 files / 139 occurrences |
| `release-subscription-error-text-spacing` | Low | `.status-error` (`settings.css:91-93`) | 38 files / 79 occurrences |
| `members-add-form-alignment-inert` | Low | `.settings-form` (`settings.css:38-44`) | 11 files / 12 form elements |

## Why central, and what that costs

Two of the three findings' own `Suggested fix` lines steer toward *local* remedies —
`code-host` says "put the hint paragraph on a shared, measure-constrained text style", and
`release-subscription` offers "reuse `.settings-section__action-error`". Both would leave the
shared rule colour-only and the defect latent everywhere else.

This sub-project deliberately takes the central path instead. The line is drawn by **whether the
defect is shared**, and in all three cases it demonstrably is:

- `.status-error` and `.placeholder` are single-declaration colour rules. Every consumer that
  wants spacing or measure is currently inventing it locally or inheriting a UA default.
- `.settings-form`'s misalignment is **not** unique to the reported section. `IdentitySection`
  (3 hinted fields), `admin/AdminUsersSection` (2), and `MembersSection` (1) each place a hinted
  `<Field>` in the same flex row as a submit `<Btn>`. `TaskProviderSection`'s field carries no
  hint and is unaffected. Fixing only the reported site would leave two identical defects
  standing.

The cost is real and is accepted: this sub-project re-baselines a large, unpredictable share of
the settings UI. The "Verification" section below is how that cost is made tractable rather
than waved away.

## Correction to `code-host-setup-hint-unbounded-measure`

The finding records the symptom as "one unbroken ~1230px line". **That does not reproduce in the
shipped application.** `CodeHostSection` renders inside `.settings-group settings-advanced`
(`SettingsApp.svelte:234,254`), and `.settings-group` sets `max-width: var(--content-max)`
(`settings.css:26`), which is `760px` (`tokens.css:46`). `.settings-advanced` carries no CSS rule
of its own, and `--content-max` is defined once and never overridden — both verified while
writing this spec.

The ~1230px measurement is an artifact of Storybook rendering the section standalone, outside any
`.settings-group`.

A reduced version of the finding survives: 760px of 11px text is roughly 100 characters, still
above a comfortable 65–75ch measure. So Task 5 **rewrites the finding** to state the real symptom
and **re-scores it Med → Low**, citing the `SettingsApp.svelte` / `settings.css` evidence. The fix
still ships, because `.placeholder` is the correct place for the constraint and not every consumer
sits inside a `.settings-group`.

This correction is itself a methodology signal worth recording: findings measured from isolated
Storybook shots can overstate a symptom that the composed app already constrains. It is noted in
the review doc, not generalised into a backlog-wide re-audit, which would be its own project.

## Architecture

Organised by **expected pixel impact**, carried over from SP1 and SP2 because it caught real
regressions in both. `bun shoot` overwrites baselines, so a green audit *after* a re-shoot proves
nothing. Task 3 holds the only change that must not move a pixel and runs its audit **without
re-shooting**, which makes its green result a genuine oracle.

| Task | Change | Expected pixel impact |
| --- | --- | --- |
| 1 | `.status-error` + `.status-success` token margin | wide — every status line in the settings UI |
| 2 | `.placeholder` measure cap | wide — but a no-op wherever content is short or inline |
| 3 | `Field` gains a `.ui-field__control` wrapper | **none** — audit runs unfiltered, WITHOUT re-shooting |
| 4 | `.settings-form` + `.ui-field` subgrid conversion | the 11 `.settings-form` consumers |
| 5 | documentation close-out | none |

Tasks 3 and 4 are separate and strictly ordered. Task 4's subgrid depends on every field being
exactly three rows, which is what Task 3 establishes. Splitting them is what makes Task 3's
pixel-neutrality independently provable; merged, a wrapper regression would hide inside the
subgrid's expected churn.

## Task 1 — `.status-error` and `.status-success` gain a token margin

`.status-error` (`:91-93`) and `.status-success` (`:94-96`) are both colour-only. A `<p>` carrying
either therefore takes the browser's UA default margin, so a section's layout shifts by an
unstyled amount whenever a status line appears or disappears.

Both gain `margin: var(--gap-inline) 0 0` — the same token `.settings-section__action-error`
already uses (`ReleaseSubscriptionSection.svelte:117`), so this generalises an existing local
decision rather than inventing a value.

**Both, not just the error.** The finding names only `.status-error`, but the two classes render
in the same slots throughout the settings UI. Giving one a token margin and leaving the other on
the UA default would make an error and a success message space differently in the same position —
a new inconsistency created by the fix. They move together.

Vertical margins do not apply to inline boxes, so any `<span>`-based consumer is unaffected by
construction. SP2's `.settings-repos__feedback .status-error { margin: 0 }` (`ReposSection.svelte`)
survives on specificity and keeps that flex row tight.

## Task 2 — `.placeholder` gains a measure cap

`.placeholder` (`:97-99`) gains `max-width: var(--content-max)`. The token already exists
(`tokens.css:46`, `760px`) and is what `.settings-group` uses, so a `.placeholder` paragraph now
wraps at the same measure as the content column that usually contains it. No new token.

`max-width` has no effect on inline boxes and no effect on any block whose content is already
narrower than 760px, so the majority of the 139 occurrences are no-ops. **That is a prediction,
not a licence to skip verification** — Task 2 produces its manifest exactly like every other task.

The one case to watch is a `.placeholder` inside a table cell, where a `max-width` can influence
column sizing. Any such change appears in the manifest and must be read and judged, not accepted
because it was predicted to be harmless.

## Task 3 — `Field` gains a control wrapper (pixel-neutral)

`Field.svelte` renders `[label, {@render children()}, hint|error]`. The children slot is not
guaranteed to emit exactly one element — `ReposSection`'s egress field emits two (the `Input` plus
the egress preview added in `e6c8f7ec3`). A fixed three-track subgrid span would therefore break
on that field.

The children slot is wrapped in a single element:

```svelte
<div class="ui-field">
  <span class="ui-field__label" id={labelId}>…</span>
  <div class="ui-field__control">{@render children()}</div>
  {#if error}…{:else if hint}…{/if}
</div>
```

`.ui-field__control` is `display: contents` in this task, so it introduces no box and cannot move
a pixel. Task 4 changes it to a real grid item.

**That is what Task 3's audit tests.** It runs unfiltered and **without re-shooting**; the expected
result is **467 passed, 0 failed**. A failure means `display: contents` is not neutral for some
consumer — most likely one whose stylesheet targets a direct-child selector through the field —
and must be reported and fixed, never re-shot. SP2's equivalent task is what proved a
`<p>`→`<h3>` promotion was genuinely pixel-identical.

`Field` has 47 usages across 19 files. Any test or stylesheet selecting a direct child of
`.ui-field` must be found and updated in this task; a `display: contents` element is invisible to
layout but **not** to `>` combinators or to `querySelector`.

## Task 4 — `.settings-form` subgrid conversion

`.settings-form` (`:38-44`) is `display: flex; flex-wrap: wrap; align-items: end`. Because
`.ui-field` is a column flex of `[label, control, hint]`, a hinted field is taller than a hintless
one by one line plus the 6px gap. `align-items: end` aligns each item's *bottom* to the row's
cross-end, so a sibling `<Btn>` bottom-aligns to the bottom of the **hint text**, not the input —
sitting visibly lower than the control it belongs to.

The row becomes a grid with three shared tracks, and each field spans them:

```css
.settings-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  grid-template-rows: auto auto auto;
  gap: var(--gap-inline);
  margin-bottom: var(--gap-field);
}
.settings-form > * {
  grid-row: span 3;
}
```

```css
.ui-field {
  display: grid;
  grid-template-rows: subgrid;
  grid-row: span 3;
  gap: 6px;
  min-width: 0;
}
```

Labels, controls, and hints then align across the whole row, which is what the finding asks for
and which no `align-items` value can deliver when siblings carry differing sub-content.

**Two risks this task must resolve rather than assume.**

1. **`.ui-field` outside a grid parent.** `Field` is used in many places that are not a
   `.settings-form`. `grid-template-rows: subgrid` on an element whose parent is not a grid is
   invalid and falls back, leaving `.ui-field` a three-row grid with `gap: 6px` — visually
   equivalent to the column flex it replaces. *Equivalent* is a prediction; the task verifies it
   from the manifest across all 19 Field-consuming files.
2. **Subgrid support in the shooting browser.** Chromium has shipped subgrid since 117. The task
   confirms the installed Playwright Chromium supports it before relying on the layout, and
   reports the version. If it does not, stop and report — do not fall back silently to a
   hardcoded offset.

`ReposSection`'s existing `#repos .settings-form` overrides (`:361`, `:365-366`, which set
`flex: 1 1 180px` on fields) target flex behaviour that no longer applies and must be
reconciled in this task, not left as dead CSS.

The second residue of the finding — the Members add row escaping the section's right padding —
is local to `MembersSection` and is fixed in this task alongside the shared change, since the
finding is not closed until both are addressed.

## Verification

Re-shooting makes the audit pass by construction, so a green audit after `bun shoot` is not
evidence. With three shared rules reaching 139, 79, and 12 consumers, "read every changed PNG"
needs to be bounded before it can be honest.

**The manifest technique.** `bun run visual:audit` is non-mutating. Run it *before* shooting: its
failure list is a machine-produced enumeration of exactly which baselines the change moves,
derived while the baselines are still the pre-change originals. That list is the task's manifest.

Each of Tasks 1, 2, and 4 therefore runs:

1. `bun run visual:audit` → record every failing baseline. **This is the manifest.** Write it into
   the task's report before shooting anything.
2. `bun shoot` → overwrite baselines.
3. Read every PNG named in the manifest and state what was actually seen in each.
4. `bun run visual:audit` → confirm 467 passed, 0 failed, and that the count is unchanged.

A baseline that appears in the manifest but was not predicted is not noise — it is the finding
this technique exists to surface, and must be explained before the task is complete.

`.storybook-shots/` is git-ignored, so `git status` never reveals baseline changes. The manifest
is the only record; it does not survive in git and must be written into the task report.

**Known infrastructure caveat.** SP2 established that `bun shoot -g <Section>` refreshes baselines
beyond those a change can affect, reproduced with the component reverted to unmodified source —
pre-existing non-determinism under 6-worker parallelism. A manifest entry that cannot be explained
by the CSS change should be checked against this before being treated as a regression, and the
check must be stated, not assumed.

## Constraints

- Statuses are exactly `open`, `fixed`, `superseded`. There is no `partial`. A non-`open` status
  requires a `Resolved:` line with a real commit hash or the backlog parser fails loud.
- No new visual baseline. The audit floor stays **467**. No baseline is orphaned — renaming a
  story orphans its PNG, so no story is renamed.
- Do not edit a pre-existing test to make something pass.
- Never `--no-verify`; never a lint-disable or type-ignore comment.
- `.js` extensions in import paths; Svelte 5 runes; strict TS with `noUncheckedIndexedAccess`.
- Formatter is **oxfmt** (`bun run format`), not prettier.
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.
- Client tests run via `bun run test:client` only — `bunfig.toml:8` excludes `tests/client/**`, so
  `bun test tests/client/...` silently discovers nothing and reports success.

## Testing strategy

| Change | Instrument |
| --- | --- |
| `.status-error` / `.status-success` margin | the Task 1 manifest, read directly |
| `.placeholder` measure | the Task 2 manifest, read directly |
| `.ui-field__control` wrapper | Task 3's zero-diff audit against untouched baselines |
| direct-child selectors through `.ui-field` | `bun run test:client` full suite |
| subgrid alignment | the Task 4 manifest, plus a client test asserting the Members add-row button and its input share a bottom edge |
| backlog regeneration | `bun test tests/scripts/ux-backlog.test.ts` (21 tests) |

The client suite stands at **1436** tests. Any task that adds one states the new total.

## Task 5 — documentation close-out

Flip the three findings to `fixed`, each with a `- **Resolved:**` line citing the real commit hash
from Tasks 1–4. Rewrite `code-host-setup-hint-unbounded-measure`'s symptom and re-score it to Low
per the correction above, and record the Storybook-isolation methodology note in
`docs/ux-reviews/CodeHostSection.md`.

**Every `file:line` citation written into the `Resolved:` prose must be re-derived against the
post-fix files.** SP1's Task 3 shipped four citations copied from pre-fix `Source:` anchors that
pointed at unrelated code; SP2 caught this by re-deriving all fourteen. The findings' own
`Source:` lines are left untouched — they correctly record the pre-fix state.

Re-score any rubric row whose rationale the fixes make false, in every review document this
sub-project touches — not only the three that own the findings. SP2 shipped a documentation task
that left three `pass` rationales asserting behaviour the fixes had removed, and needed a
follow-up commit.

Regenerate with `bun run ux:backlog`. Never hand-edit `_BACKLOG.md`.

Expected after regeneration: **11 open**, severity buckets **High 0 / Med 2 / Low 9**. The header
still reads **18 section(s)** — that count is `sorted.length` in `scripts/ux-backlog-lib.ts:178`,
the number of review documents, and does not drop when a section reaches zero open findings.

## Position in the wider backlog

| # | Scope | Findings | Status |
| --- | --- | --- | --- |
| SP1 | ToolsSection close-out | 5 | done — `ddb63df03`, `bb1aba29b`, `c9dfb3aa9`, `78069137b` |
| SP2 | ReposSection close-out | 4 | done — `e24abe5a1`, `3814bd2b8`, `e6c8f7ec3`, `95dd05395`, `dd596d757` |
| SP3 | shared `settings.css` trio (this spec) | 3 | this spec |
| SP4 | scattered singles — Byok ×2, CodingCredentials, GuestMode, KaneoAccess ×2, Members, Profile, AiOutput | 9 | not started |

SP4 is deliberately sequenced after this one: its sections' baselines would otherwise be shot
against pre-change shared CSS and re-baselined a second time here.

Set aside, not scheduled:

- `repos-no-edit-capability` — needs an API-shape decision plus new per-row UI.
  `src/debug/settings/coding-repos-routes.ts:69-81` exposes only `GET`/`POST`/`DELETE`. Its own
  feature spec.
- `debug-icon-buttons-control-height` — carved out by prior decision; stays `open` pending
  sign-off. Its own suggested fix says take no action.
