<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shared `settings.css` Central Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three open findings whose fixes live in `client/settings/settings.css` by fixing each shared rule centrally, so every latent instance is corrected rather than only the reported call site.

**Architecture:** Five tasks ordered by expected pixel impact. Tasks 1, 2 and 4 change shared CSS and must enumerate their blast radius with a non-mutating audit *before* re-shooting. Task 3 is a DOM change to the `Field` primitive that must move no pixels, and proves it by running the audit against untouched baselines. Task 5 closes the documentation.

**Tech Stack:** Svelte 5 (runes), strict TypeScript with `noUncheckedIndexedAccess`, Bun test runner, Playwright 1.61.1 + Storybook for visual baselines, oxfmt for formatting.

## Global Constraints

- Statuses in `docs/ux-reviews/*.md` are exactly `open`, `fixed`, `superseded`. **There is no `partial`.** A non-`open` status requires a `- **Resolved:**` line with a real commit hash or the backlog parser fails loud.
- **No new visual baseline. The audit floor stays 467. No baseline is orphaned — do not rename any story.**
- Do not edit a pre-existing test to make something pass.
- Never `--no-verify`. Never add a lint-disable or type-ignore comment — hook policy blocks them; fix the underlying issue.
- Use `.js` extensions in import paths. Svelte 5 runes (`$state`, `$props`, `$derived`, `$effect`).
- The formatter is **oxfmt**: `bun run format`. Not prettier.
- Client tests run via `bun run test:client` **only**. `bunfig.toml:8` sets `pathIgnorePatterns` including `tests/client/**`, so `bun test tests/client/...` silently discovers nothing and reports success. If a run reports 0 tests, you used the wrong command.
- The client suite baseline is **1436 tests, 0 fail**. Any task that adds tests states the new total.
- `bun run visual:audit` is a **non-mutating** compare. `bun shoot` runs `--update-snapshots=all` and **overwrites baselines**. Never run `bun shoot:gen` — it regenerates every spec's `@generated-begin` region and causes branch-wide churn.
- `.storybook-shots/` is git-ignored. `git status` never shows baseline changes.
- Branch `ui-ux-review-01`; **no merge, no push**; PR #212 untouched.
- Docs under `docs/` carry an HTML-comment SPDX header; `.ts` files carry a `//` comment header. The pre-commit hook checks this.

---

## File Structure

| File | Responsibility in this plan |
| --- | --- |
| `client/settings/settings.css` | The three shared rules. Tasks 1, 2, 4. |
| `client/shared/ui/Field.svelte` | Gains `.ui-field__control`; becomes a subgrid item. Tasks 3, 4. |
| `client/settings/sections/ReposSection.svelte` | Flex-era overrides reconciled. Task 4. |
| `client/settings/sections/MembersSection.svelte` | Flex-era override reconciled; add-row padding residue. Task 4. |
| `tests/client/settings/settings-css.test.ts` | Text assertions on the stylesheet. Tasks 1, 2, 4. |
| `tests/client/shared/ui/field-context.test.ts` | `Field` DOM assertions. Task 3. |
| `docs/ux-reviews/*.md` | Finding close-out and re-scoring. Task 5. |
| `docs/ux-reviews/_BACKLOG.md` | **Generated only.** Never hand-edit. Task 5. |

---

## The manifest technique — read this before Tasks 1, 2, and 4

Re-shooting makes the audit pass by construction, so **a green audit after `bun shoot` is not evidence of anything.** These three tasks change rules with 139, 79, and 12 consumers, so "look at what changed" has to be bounded before it can be honest.

`bun run visual:audit` does not write baselines. Run it *before* shooting: its failure list enumerates exactly which baselines your change moves, produced while the baselines are still the pre-change originals. **That list is the manifest.**

Every one of Tasks 1, 2, and 4 follows this sequence:

1. Run `bun run visual:audit`. Copy the full list of failing baseline names into your report file. **This is the manifest — write it down before you shoot anything, because shooting destroys the evidence that produced it.**
2. Run `bun shoot`.
3. Read every PNG named in the manifest with the Read tool, and state in your report what you actually saw in each one.
4. Run `bun run visual:audit` again. Expect **467 passed, 0 failed**.

A baseline in the manifest that your change cannot explain is not noise — it is exactly what this technique exists to surface. Explain it before completing the task.

**Known infrastructure caveat.** SP2 established that `bun shoot` can refresh baselines beyond those a change can affect — reproduced with the component reverted to unmodified source, so it is pre-existing non-determinism under 6-worker parallelism, not your bug. If a manifest entry cannot be explained by your CSS change, check it against this possibility and **state the check in your report**. Do not assume it silently.

---

## Task 1: `.status-error` and `.status-success` gain a token margin

**Files:**
- Modify: `client/settings/settings.css:90-96`
- Test: `tests/client/settings/settings-css.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: the commit hash of Step 8, which Task 5 cites in one `- **Resolved:**` line. No new classes, props, or exports.

**Context you need.**

`.status-error` and `.status-success` are colour-only. A `<p class="status-error">` therefore takes the browser's UA default margin (`1em` top *and* bottom), so a section's layout shifts by an unstyled amount whenever a status line appears or disappears. That is the defect.

The value `var(--gap-inline)` (`12px`, `client/shared/tokens.css:51`) is not invented here — it is what `.settings-section__action-error` already uses at `client/settings/sections/ReleaseSubscriptionSection.svelte:117`. This generalises an existing local decision.

**Why both classes, when the finding names only `.status-error`.** The two render in the same slots throughout the settings UI. Giving one a token margin and leaving the other on the UA default would make an error and a success message space *differently in the same position* — a new inconsistency created by the fix. They move together. This is deliberate and is not scope creep to be trimmed.

Vertical margins do not apply to inline boxes, so `<span>`-based consumers are unaffected by construction.

**Existing overrides that must keep working.** Both are more specific than the shared rule and will win, but confirm them in the manifest rather than assuming:
- `client/settings/sections/ReposSection.svelte` — `.settings-repos__feedback .status-error { margin: 0 }` (keeps SP2's flex row tight).
- `client/settings/sections/MembersSection.svelte:185-187` — `.members-error { margin: 0 0 var(--gap-field) }`. Svelte scopes component styles with a hash class, giving it higher specificity than the global rule.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('settings.css', …)` block in `tests/client/settings/settings-css.test.ts`, after the `'admin zone has a danger divider'` test and before the block's closing `})`:

```typescript
  test('status text uses a spacing token rather than the UA default margin', () => {
    const statusError = css.match(/\.status-error \{[^}]*\}/)?.[0] ?? ''
    const statusSuccess = css.match(/\.status-success \{[^}]*\}/)?.[0] ?? ''
    expect(statusError).toContain('margin: var(--gap-inline) 0 0')
    expect(statusSuccess).toContain('margin: var(--gap-inline) 0 0')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client -t 'spacing token rather than the UA default'`

Expected: FAIL — both `toContain` assertions receive a rule body holding only the `color` declaration.

If it reports 0 tests run, you used the wrong command — see the Global Constraints note about `bunfig.toml:8`.

- [ ] **Step 3: Add the token margins**

In `client/settings/settings.css`, replace lines 90-96:

```css
/* ---- status text ---- */
.status-error {
  color: var(--danger);
}
.status-success {
  color: var(--success);
}
```

with:

```css
/* ---- status text ---- */
/* Both carry the same margin so an error and a success message occupy identical
   space in the same slot; a section must not shift by the UA default when one
   swaps for the other. */
.status-error {
  color: var(--danger);
  margin: var(--gap-inline) 0 0;
}
.status-success {
  color: var(--success);
  margin: var(--gap-inline) 0 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:client -t 'spacing token rather than the UA default'`

Expected: PASS, 1 test.

- [ ] **Step 5: Run the full client suite**

Run: `bun run test:client`

Expected: **1437 pass / 0 fail** (1436 before this task, plus the one added in Step 1).

- [ ] **Step 6: Build the manifest — audit BEFORE shooting**

Run: `bun run visual:audit`

Expect failures. **Copy the complete list of failing baseline names into your report file now.** This is the manifest, and running `bun shoot` in the next step destroys the originals that produced it.

Do not shoot until the manifest is written down.

- [ ] **Step 7: Re-shoot and read every PNG in the manifest**

```bash
bun shoot
```

Then read every PNG named in your manifest with the Read tool. Baselines live under `.storybook-shots/<spec path>/`. For each one, state in your report what you actually saw — specifically whether the status line's spacing now looks deliberate and whether anything *other* than status-line spacing moved.

Pay particular attention to the two overrides named in the Context section: `ReposSection`'s feedback row should stay tight, and `MembersSection`'s error should keep its `--gap-field` bottom margin.

- [ ] **Step 8: Confirm the audit is clean and commit**

```bash
bun run visual:audit
```

Expected: **467 passed, 0 failed**. If the count is not 467, a baseline was added or orphaned — stop and report.

```bash
bun run format
git add client/settings/settings.css tests/client/settings/settings-css.test.ts
git commit -m "fix(settings): give status text a token margin instead of the UA default

.status-error and .status-success were colour-only, so every status line
took the browser's default <p> margin and its section shifted by an
unstyled amount whenever the line appeared or disappeared. Both now use
var(--gap-inline), the token .settings-section__action-error already
used locally.

Both classes change together: they render in the same slots, so giving
only the error a token margin would make an error and a success message
space differently in the same position.

Closes release-subscription-error-text-spacing."
```

---

## Task 2: `.placeholder` gains a measure cap

**Files:**
- Modify: `client/settings/settings.css:97-99`
- Test: `tests/client/settings/settings-css.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1. The two rules are independent; this task only needs Task 1 committed so the manifests do not overlap.
- Produces: the commit hash of Step 8, which Task 5 cites in one `- **Resolved:**` line.

**Context you need.**

`.placeholder` sets only `color: var(--text-muted)`. It is used 139 times across 36 files, including for prose paragraphs that consequently have no reading measure at all.

The token `--content-max` already exists (`client/shared/tokens.css:46`, `760px`) and is what `.settings-group` uses (`client/settings/settings.css:26`). Using it means a `.placeholder` paragraph wraps at the same measure as the content column that usually contains it. **Do not invent a new token and do not hardcode a px value.**

**A correction you should know about.** The finding that motivated this describes "one unbroken ~1230px line" in `CodeHostSection`. That does not reproduce in the shipped app: `CodeHostSection` renders inside `.settings-group settings-advanced` (`client/settings/SettingsApp.svelte:234,254`), which is already capped at 760px. The ~1230px measurement is an artifact of Storybook rendering the section standalone. The fix still ships because `.placeholder` is the right home for the constraint and not every consumer sits inside a `.settings-group` — but do not expect the CodeHost baseline to change dramatically. Task 5 rewrites the finding accordingly. This context is here so a modest diff does not read to you as a failed fix.

**What to expect.** `max-width` has no effect on inline boxes and no effect on any block already narrower than 760px, so most of the 139 occurrences are no-ops. **That is a prediction, not permission to skip the manifest.** The case that genuinely warrants attention is a `.placeholder` inside a table cell, where `max-width` can influence column sizing. If one appears in the manifest, read it and judge it — do not wave it through because this note predicted harmlessness.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('settings.css', …)` block in `tests/client/settings/settings-css.test.ts`, after the test added in Task 1:

```typescript
  test('placeholder prose is capped at a reading measure', () => {
    const placeholder = css.match(/\.placeholder \{[^}]*\}/)?.[0] ?? ''
    expect(placeholder).toContain('max-width: var(--content-max)')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client -t 'capped at a reading measure'`

Expected: FAIL — the matched rule body contains only the `color` declaration.

- [ ] **Step 3: Add the measure cap**

In `client/settings/settings.css`, replace lines 97-99:

```css
.placeholder {
  color: var(--text-muted);
}
```

with:

```css
/* --content-max is the same cap .settings-group uses, so placeholder prose
   wraps at the measure of the column that usually contains it. */
.placeholder {
  color: var(--text-muted);
  max-width: var(--content-max);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:client -t 'capped at a reading measure'`

Expected: PASS, 1 test.

- [ ] **Step 5: Run the full client suite**

Run: `bun run test:client`

Expected: **1438 pass / 0 fail** (1437 after Task 1, plus the one added in Step 1).

- [ ] **Step 6: Build the manifest — audit BEFORE shooting**

Run: `bun run visual:audit`

**Copy the complete list of failing baseline names into your report file before shooting.**

- [ ] **Step 7: Re-shoot and read every PNG in the manifest**

```bash
bun shoot
```

Read every PNG named in the manifest and state what you saw. Two things specifically:
- any `.placeholder` in a table cell whose column width changed;
- `settings-sections-CodeHostSection-Incomplete-1.png`, where the setup hint should now wrap at 760px in the standalone Storybook render.

- [ ] **Step 8: Confirm the audit is clean and commit**

```bash
bun run visual:audit
```

Expected: **467 passed, 0 failed**.

```bash
bun run format
git add client/settings/settings.css tests/client/settings/settings-css.test.ts
git commit -m "fix(settings): cap placeholder prose at a reading measure

.placeholder was colour-only, so a paragraph carrying it had no measure
constraint of its own. It now uses --content-max, the same 760px cap
.settings-group applies, rather than a new token or a hardcoded value.

Closes code-host-setup-hint-unbounded-measure."
```

---

## Task 3: `Field` gains a control wrapper (must move no pixels)

**Files:**
- Modify: `client/shared/ui/Field.svelte:45-52` (markup), `:55-60` (the `.ui-field` rule)
- Test: `tests/client/shared/ui/field-context.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: **`.ui-field__control`** — a `<div>` wrapping the children slot inside `.ui-field`, styled `display: contents` in this task. Task 4 changes it to `display: block` and makes it the middle row of a subgrid. Task 4 depends on this element existing.

**Context you need.**

`Field.svelte` renders `[label, {@render children()}, hint|error]`. The children slot is **not guaranteed to emit exactly one element** — `ReposSection`'s egress field emits two (the `Input` plus the egress preview added in `e6c8f7ec3`). Task 4 converts the field into a three-track subgrid, and a variable number of children would break that span. This task makes the structure exactly three rows so Task 4 can rely on it.

**The risk this task exists to test.** `display: contents` removes the wrapper's box from layout entirely, so it *should* be pixel-neutral. But it is not invisible to CSS `>` combinators or to `querySelector`. This task is separate from Task 4 precisely so that neutrality can be proven against untouched baselines — merged, a wrapper regression would hide inside the subgrid's expected churn.

**What I already checked, so you do not have to.** There are **no** `>` combinator selectors through `.ui-field` anywhere in `client/` (verified with `grep -rn 'ui-field >\|\.ui-field >' client/` — no matches). Every test that reaches into a field uses a descendant selector (`.ui-field__label`, `.ui-field__error`, `.ui-field .ui-input`, `.closest('.ui-field')`), all of which are unaffected by an extra wrapper. If your full-suite run in Step 5 contradicts this, report it — it means I missed a selector and the finding matters.

`Field` has 47 usages across 19 files.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('field-context', …)` block in `tests/client/shared/ui/field-context.test.ts`, before the block's closing `})`:

```typescript
  test('wraps the children slot in a single control element', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { hint: 'https only' } })
    const field = target.querySelector<HTMLElement>('.ui-field')!
    const control = field.querySelector<HTMLElement>('.ui-field__control')!
    expect(control).not.toBeNull()
    expect(control.parentElement).toBe(field)
    expect(control.querySelector('[data-testid="hint-input"]')).not.toBeNull()
    expect(field.children.length).toBe(3)
    void unmount(c)
  })
```

`FieldHintFixture` is already imported at the top of this file (`line 13`) and already renders an input with `data-testid="hint-input"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client -t 'wraps the children slot in a single control element'`

Expected: FAIL — `control` is `null`, so `expect(control).not.toBeNull()` fails.

- [ ] **Step 3: Add the wrapper element**

In `client/shared/ui/Field.svelte`, replace the markup block at `:45-52`:

```svelte
<div class="ui-field">
  <span class="ui-field__label" id={labelId}>
    {label}{#if required}<span class="ui-field__req" aria-hidden="true">*</span>{/if}
  </span>
  {@render children()}
  {#if error}<span class="ui-field__error" id={errorId} role="alert">{error}</span>{:else if hint}<span
      class="ui-field__hint" id={hintId}>{hint}</span>{/if}
</div>
```

with:

```svelte
<div class="ui-field">
  <span class="ui-field__label" id={labelId}>
    {label}{#if required}<span class="ui-field__req" aria-hidden="true">*</span>{/if}
  </span>
  <div class="ui-field__control">{@render children()}</div>
  {#if error}<span class="ui-field__error" id={errorId} role="alert">{error}</span>{:else if hint}<span
      class="ui-field__hint" id={hintId}>{hint}</span>{/if}
</div>
```

- [ ] **Step 4: Add the neutral style**

In the same file's `<style>` block, immediately after the `.ui-field` rule that ends at `:60`, add:

```css
  /* display: contents keeps this wrapper out of layout entirely, so adding it
     moves no pixels. Task 4 promotes it to a real grid row. */
  .ui-field__control {
    display: contents;
  }
```

- [ ] **Step 5: Run the test and the full client suite**

```bash
bun run test:client -t 'wraps the children slot in a single control element'
bun run test:client
```

Expected: the single test PASSes; the full suite reports **1439 pass / 0 fail** (1438 after Task 2, plus the one added in Step 1).

A failure elsewhere in the suite means some selector does depend on `.ui-field`'s direct-child structure. Report it with the failing test name — do not edit that test to accommodate the wrapper.

- [ ] **Step 6: Run the visual audit WITHOUT re-shooting**

Run: `bun run visual:audit`

Expected: **467 passed, 0 failed.**

**Do not run `bun shoot` in this task.** The audit here is the entire point: it runs against the untouched baselines, so a green result proves `display: contents` really was neutral, and a failure proves it was not. Re-shooting destroys the only evidence this task produces.

**If the audit fails**, stop and report it. Name every failing baseline and its pixel count. Fix the stylesheet so the audit passes against the *existing* baselines. Do not re-shoot to make it green.

- [ ] **Step 7: Commit**

```bash
bun run format
git add client/shared/ui/Field.svelte tests/client/shared/ui/field-context.test.ts
git commit -m "refactor(ui): wrap the Field children slot in a control element

Field rendered [label, children, hint], and the children slot is not
guaranteed to emit exactly one element -- ReposSection's egress field
emits two. The subgrid conversion that follows needs every field to be
exactly three rows, so the slot now sits inside .ui-field__control.

display: contents keeps the wrapper out of layout, verified by running
the visual audit against the untouched baselines rather than re-shooting."
```

---

## Task 4: `.settings-form` subgrid conversion

**Files:**
- Modify: `client/settings/settings.css:37-44`
- Modify: `client/shared/ui/Field.svelte` (the `.ui-field` and `.ui-field__control` rules)
- Modify: `client/settings/sections/ReposSection.svelte:361-367`
- Modify: `client/settings/sections/MembersSection.svelte:188-192`
- Test: `tests/client/settings/settings-css.test.ts`

**Interfaces:**
- Consumes: `.ui-field__control` from Task 3 — the wrapper element inside `.ui-field`, currently `display: contents`. This task changes it to `display: block` so it becomes a real grid item occupying the middle track.
- Produces: the commit hash of Step 11, which Task 5 cites in one `- **Resolved:**` line.

**Context you need.**

`.settings-form` is `display: flex; flex-wrap: wrap; align-items: end`. `.ui-field` is a column flex of `[label, control, hint]`, so a hinted field is taller than a hintless one by one line plus the 6px gap. `align-items: end` aligns each item's *bottom* to the row's cross-end — so a sibling `<Btn>` bottom-aligns to the bottom of the **hint text**, sitting visibly lower than the control it belongs to.

No `align-items` value fixes this, because the items carry different sub-content. Shared grid tracks do.

**This defect is not unique to the reported section.** Three forms place a hinted `<Field>` in the same row as a submit `<Btn>`: `MembersSection` (1 hinted field), `IdentitySection` (3), and `admin/AdminUsersSection` (2). `TaskProviderSection`'s field carries no hint and is unaffected. All three should visibly improve.

**Subgrid support.** Playwright is pinned at **1.61.1**, whose bundled Chromium is far newer than 117 (when subgrid shipped), so support is expected. Confirm it empirically in Step 8 anyway and report the browser version. If subgrid is somehow unsupported, **stop and report** — do not fall back to a hardcoded offset.

**Expect field widths to change in all 12 forms, and treat that as intended.** Today most forms have content-sized flex children; only `ReposSection` and `MembersSection` set `flex` on their fields. Uniform `1fr` columns make sizing consistent across every settings form, which is the point of taking the central path. It will produce a large manifest. Read it.

**The button placement rule.** Fields span all three tracks; non-field children span only the first two (label + control) and align to the bottom of the control track. That is what puts a submit button level with the input it belongs to. Using `grid-row: span 2` rather than an absolute `grid-row: 2` matters: an absolute row pins the button to the first row-set and breaks when the form wraps at narrow widths.

**If the narrow-width (~640px) shots show the button misplaced after wrapping, stop and report it** with the PNG names. The fallback is to wrap form actions in their own element, which is a markup change across 12 forms and needs a decision — do not improvise it.

**Second residue of the finding.** The Members add row currently escapes the section's right padding, with the button's right edge on the viewport edge. `justify-self: start` should resolve this as a side effect by keeping the button at its natural width at its column's start. **Verify it from the PNG in Step 10** rather than assuming, and report either way — the finding is not closed until both residues are gone.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('settings.css', …)` block in `tests/client/settings/settings-css.test.ts`, after the test added in Task 2:

```typescript
  test('settings-form shares grid tracks so controls align across the row', () => {
    const form = css.match(/\.settings-form \{[^}]*\}/)?.[0] ?? ''
    expect(form).toContain('display: grid')
    expect(form).not.toContain('align-items: end')
    expect(css).toContain('grid-row: span 2')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client -t 'shares grid tracks so controls align'`

Expected: FAIL — the rule body still contains `display: flex` and `align-items: end`.

- [ ] **Step 3: Convert `.settings-form` to a grid**

In `client/settings/settings.css`, replace lines 37-44:

```css
/* forms */
.settings-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-inline);
  align-items: end;
  margin-bottom: var(--gap-field);
}
```

with:

```css
/* forms */
/* Three shared tracks -- label / control / hint. Fields span all three via
   subgrid (Field.svelte), so labels, controls and hints line up across the
   whole row. Non-field children (submit buttons) span only label+control and
   sit at the bottom of the control track, which puts them level with the
   inputs rather than below a neighbour's hint text. */
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
.settings-form > :not(.ui-field) {
  grid-row: span 2;
  align-self: end;
  justify-self: start;
}
```

- [ ] **Step 4: Make `.ui-field` a subgrid item**

In `client/shared/ui/Field.svelte`, replace the `.ui-field` rule at `:55-60`:

```css
  .ui-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
```

with:

```css
  /* subgrid adopts the parent's three tracks so this field's label, control and
     hint align with every sibling's. Outside a grid parent, subgrid is invalid
     and falls back to independent auto rows -- visually the same stack as the
     column flex this replaces. */
  .ui-field {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span 3;
    gap: 6px;
    min-width: 0;
  }
```

- [ ] **Step 5: Promote `.ui-field__control` to a real grid row**

In the same file, replace the rule Task 3 added:

```css
  /* display: contents keeps this wrapper out of layout entirely, so adding it
     moves no pixels. Task 4 promotes it to a real grid row. */
  .ui-field__control {
    display: contents;
  }
```

with:

```css
  /* A real box now, so the field always occupies exactly three grid rows no
     matter how many elements the children slot emits. */
  .ui-field__control {
    display: block;
    min-width: 0;
  }
```

- [ ] **Step 6: Reconcile the ReposSection flex-era overrides**

In `client/settings/sections/ReposSection.svelte`, replace lines 361-367:

```css
  #repos .settings-form {
    margin-bottom: 0;
    align-items: start;
  }
  #repos .settings-form :global(.ui-field) {
    flex: 1 1 180px;
  }
```

with:

```css
  #repos .settings-form {
    margin-bottom: 0;
  }
```

`align-items: start` and `flex: 1 1 180px` are flex-era declarations that the shared grid now supersedes — the `minmax(180px, 1fr)` track carries the same 180px floor. Leaving them would be dead CSS.

- [ ] **Step 7: Reconcile the MembersSection override**

In `client/settings/sections/MembersSection.svelte`, replace lines 188-192:

```css
  /* Keep the input growing and the button on the same baseline; hint wraps below the row. */
  .members-add :global(.ui-field) {
    flex: 1;
    min-width: 220px;
  }
```

with nothing — delete all five lines. The shared grid now sizes the field, and the comment describes flex behaviour that no longer exists. A stale comment asserting the opposite of what the code does is worse than no comment.

- [ ] **Step 8: Run the tests and confirm subgrid support**

```bash
bun run test:client -t 'shares grid tracks so controls align'
bun run test:client
bunx playwright --version
```

Expected: the single test PASSes; the full suite reports **1440 pass / 0 fail** (1439 after Task 3, plus the one added in Step 1); Playwright reports `Version 1.61.1` or newer.

Record the version in your report. If the suite fails, report the failing test names — do not edit a pre-existing test to accommodate the layout change.

- [ ] **Step 9: Build the manifest — audit BEFORE shooting**

Run: `bun run visual:audit`

Expect a **large** number of failures — every `.settings-form` consumer. **Copy the complete list into your report file before shooting.**

- [ ] **Step 10: Re-shoot and read every PNG in the manifest**

```bash
bun shoot
```

Read every PNG named in the manifest. Report specifically on:

- `MembersSection`, `IdentitySection`, `admin/AdminUsersSection` at **both** the desktop and ~640px widths — is the submit button now level with its input rather than below the hint?
- The Members add row's right edge — does the button now sit inside the section's padding rather than on the viewport edge? This is the finding's second residue; state explicitly whether it is resolved.
- Any form where wrapping at 640px placed the button somewhere unexpected. If you see this, **stop and report** rather than improvising a fix.
- `ReposSection`'s add form, which lost two overrides in Step 6.

- [ ] **Step 11: Confirm the audit is clean and commit**

```bash
bun run visual:audit
```

Expected: **467 passed, 0 failed**. If the count is not 467, stop and report.

```bash
bun run format
git add client/settings/settings.css client/shared/ui/Field.svelte client/settings/sections/ReposSection.svelte client/settings/sections/MembersSection.svelte tests/client/settings/settings-css.test.ts
git commit -m "fix(settings): align form controls on shared grid tracks

.settings-form was a flex row with align-items: end, so a submit button
bottom-aligned to the bottom of a neighbouring field's hint text rather
than to the input it belongs to -- visibly low in MembersSection,
IdentitySection and AdminUsersSection alike.

The row is now a three-track grid (label / control / hint) with fields
adopting the tracks via subgrid. Buttons span label+control only and sit
at the bottom of the control track, level with the inputs. Flex-era
overrides in ReposSection and MembersSection are removed as dead CSS.

Closes members-add-form-alignment-inert."
```

---

## Task 5: Documentation close-out

**Files:**
- Modify: `docs/ux-reviews/ReleaseSubscriptionSection.md`
- Modify: `docs/ux-reviews/CodeHostSection.md`
- Modify: `docs/ux-reviews/MembersSection.md`
- Modify: `docs/ux-reviews/_BACKLOG.md` (**generated — via `bun run ux:backlog` only**)

**Interfaces:**
- Consumes: the commit hashes from Tasks 1, 2 and 4. Derive them with `git log --oneline -6` and match them to the commit subjects above — do **not** guess, and do not cite a test-only follow-up commit if one exists.
- Produces: nothing. This is the final task.

**Context you need.**

Each finding's `- **Status:** open` becomes `- **Status:** fixed` and gains a `- **Resolved:**` line directly beneath it, citing the real commit hash. **There is no `partial` status** — a non-`open` status without a `Resolved:` line makes the backlog parser fail loud.

Leave every finding's own `- **Source:**` line untouched. Those correctly record the *pre-fix* state.

| Finding | Document | Commit to cite |
| --- | --- | --- |
| `release-subscription-error-text-spacing` | `ReleaseSubscriptionSection.md` | Task 1 |
| `code-host-setup-hint-unbounded-measure` | `CodeHostSection.md` | Task 2 |
| `members-add-form-alignment-inert` | `MembersSection.md` | Task 4 |

**Every `file:line` citation you write into the `Resolved:` prose must be re-derived by opening the post-fix file at that line.** SP1 shipped four citations copied from pre-fix `Source:` anchors that pointed at unrelated code. SP2 avoided it by re-deriving all fourteen. Open each file and confirm the line holds what you claim before you write it.

- [ ] **Step 1: Collect the three commit hashes**

Run: `git log --oneline -6`

Match subjects to tasks: `"fix(settings): give status text a token margin…"` (Task 1), `"fix(settings): cap placeholder prose…"` (Task 2), `"fix(settings): align form controls on shared grid tracks"` (Task 4). Record all three.

- [ ] **Step 2: Close `release-subscription-error-text-spacing`**

In `docs/ux-reviews/ReleaseSubscriptionSection.md`, find the finding whose `- **Id:** release-subscription-error-text-spacing`. Change its `- **Status:** open` to `- **Status:** fixed` and insert a `- **Resolved:**` line immediately after, following this shape (substituting the real hash and re-derived line numbers):

```markdown
- **Resolved:** `<task-1-hash>` ("fix(settings): give status text a token margin instead of the UA default") (2026-08-04). `.status-error` now carries `margin: var(--gap-inline) 0 0` (`client/settings/settings.css:<line>`), so the reload-failure line's vertical spacing comes from the spacing scale rather than the browser's default `<p>` margin, and the caption no longer shifts by an unstyled amount when the line appears. `.status-success` gained the same margin (`:<line>`) so an error and a success message occupy identical space in the same slot.
```

- [ ] **Step 3: Close and re-scope `code-host-setup-hint-unbounded-measure`**

In `docs/ux-reviews/CodeHostSection.md`, set that finding's status to `fixed`, add a `Resolved:` line citing the Task 2 hash and the re-derived `client/settings/settings.css` line for the `max-width` declaration.

Then make two corrections to the finding itself, which the implementation established were factually wrong:

- Change its severity marker in the `###` heading from `[Med]` to `[Low]`.
- Add a `- **Correction:**` line recording that the "~1230px" symptom does not reproduce in the shipped app, because `CodeHostSection` renders inside `.settings-group settings-advanced` (`client/settings/SettingsApp.svelte:234,254`) which is already capped at `max-width: var(--content-max)` (`client/settings/settings.css:26`, `760px` at `client/shared/tokens.css:46`). State that the measurement was an artifact of Storybook rendering the section standalone, and that the surviving defect is the narrower one — 760px of 11px text is still roughly 100 characters, above a comfortable 65-75ch measure.

**Re-derive all four of those `file:line` citations against the current files before writing them.**

- [ ] **Step 4: Close `members-add-form-alignment-inert`**

In `docs/ux-reviews/MembersSection.md`, set that finding's status to `fixed` and add a `Resolved:` line citing the Task 4 hash. The finding names **two** residues — the escaped right padding and the button's baseline — so the prose must address both explicitly, citing the re-derived `.settings-form` grid rule and the `:not(.ui-field)` rule in `client/settings/settings.css`, plus the `.ui-field` subgrid rule in `client/shared/ui/Field.svelte`.

If Step 10 of Task 4 found the right-padding residue **not** resolved, do not mark this finding `fixed`. Stop and report instead.

- [ ] **Step 5: Re-score stale rubric rows in all three documents**

Read the nine-row scorecard at the top of each of the three documents. A row's rationale must describe the component's **current** state.

Two things to fix, in every one of the three documents:
- any row scored `warn` **solely** because of a finding this plan just closed → re-score to `pass` with a rationale describing the new behaviour. A row whose `warn` also covers a still-open finding stays `warn`.
- any row already scored `pass` whose **rationale text** asserts behaviour these fixes removed → rewrite the rationale. The score does not change; the text does.

That second case is the one SP2 missed, shipping three `pass` rationales that described gaps the fixes had closed and needing a follow-up commit. Check for it deliberately.

- [ ] **Step 6: Regenerate the backlog**

```bash
bun run ux:backlog
bun test tests/scripts/ux-backlog.test.ts
```

Expected: the parser tests report **21 pass / 0 fail**.

Then confirm the regenerated `docs/ux-reviews/_BACKLOG.md` reads:
- header: **11 open finding(s) across 18 section(s)** — the section count is `sorted.length` in `scripts/ux-backlog-lib.ts:178`, the number of review *documents*, and does not drop when a section reaches zero open findings;
- severity buckets: **High (0) / Med (2) / Low (9)**.

If any number differs, stop and report it rather than editing `_BACKLOG.md` — it is generated, and a hand-edit hides a real parsing problem.

- [ ] **Step 7: Commit**

```bash
bun run format
git add docs/ux-reviews/
git commit -m "docs(ux-reviews): close the three shared settings.css findings

Flips release-subscription-error-text-spacing,
code-host-setup-hint-unbounded-measure and
members-add-form-alignment-inert to fixed, each citing its commit.

Also re-scores the code-host finding Med -> Low and records why: its
~1230px symptom does not reproduce in the app, which already caps that
column at 760px via .settings-group. The measurement was an artifact of
Storybook rendering the section standalone.

Backlog: 14 open -> 11 open."
```

---

## Self-Review

Checked against the spec:

**Spec coverage.** Every section maps to a task — `.status-error`/`.status-success` → Task 1; `.placeholder` → Task 2; the `Field` control wrapper → Task 3; the subgrid conversion, the ReposSection/MembersSection override reconciliation, and the Members right-padding residue → Task 4; the finding close-out, the CodeHost re-scoping, and the rubric re-scoring → Task 5. The manifest technique is hoisted into its own section ahead of the tasks that use it, so it is stated once rather than three times.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Every code step carries the complete before and after. The two contingencies (button misplacement under wrapping in Task 4; the right-padding residue not resolving) are specific, named, and instruct stop-and-report rather than improvisation.

**Type and name consistency.** `.ui-field__control` is introduced in Task 3 as `display: contents` and promoted in Task 4 to `display: block` — the Interfaces blocks of both tasks state this handoff. Test counts chain correctly: 1436 → 1437 (T1) → 1438 (T2) → 1439 (T3) → 1440 (T4). The severity arithmetic closes: Med 3−1 = 2, Low 11−2 = 9, total 14−3 = 11.
