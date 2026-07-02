<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AI UX Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a repeatable, guided "UX review" procedure — a project skill plus a fixed rubric and an output convention — that reviews one `client/` section from its Storybook screenshots + source and emits a severity-ranked, report-only findings document.

**Architecture:** Three authored markdown artifacts (a skill at `.claude/skills/ux-review/SKILL.md`, a rubric at `docs/ux-reviews/RUBRIC.md`, an output template at `docs/ux-reviews/_TEMPLATE.md`), then validated by dogfooding the skill against two real sections (`ToolsSection`, `TaskProviderSection`) to prove it produces conforming, repeatable output. No product source changes; the skill is review-only and guarded by a HARD-GATE.

**Tech Stack:** Markdown; the existing `bun shoot` / `@crvy/strybk` screenshot pipeline; the Read tool for ingesting PNGs. Pre-commit hook runs `lint`, `typecheck`, `format:check`, `license-headers` on staged files.

**Reference spec:** `docs/superpowers/specs/2026-07-02-ai-ux-review-workflow-design.md`

---

## Conventions used throughout this plan

- **Docs under `docs/` require an SPDX header.** Every `docs/ux-reviews/*.md` file must begin with the HTML-comment header shown in Task 1. The pre-commit `license-headers` check enforces this.
- **Skill files under `.claude/` do NOT get an SPDX header** — they start with YAML frontmatter (`---`), matching `.claude/skills/designing-new-provider/SKILL.md`.
- **Format before commit.** Run `bunx prettier --write <file>` before `git add`; otherwise the pre-commit `format:check` fails the commit (as it did on the spec).
- **Screenshot IDs** follow the pattern `settings-sections-<component-lowercase>--<story>` (e.g. `settings-sections-toolssection--populated`), confirmed in `tests/visual/settings/sections/ToolsSection.spec.ts`.

---

## File Structure

| File                                         | Responsibility                                                                                                                                               | Task |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `docs/ux-reviews/RUBRIC.md`                  | The fixed seven-dimension scoring reference (pass/warn/fail + guiding questions). Single source of truth the skill and every findings doc cite.              | 1    |
| `docs/ux-reviews/_TEMPLATE.md`               | The output convention: the exact skeleton a findings doc must follow (scorecard header + severity-ranked findings with 5 fields each).                       | 2    |
| `.claude/skills/ux-review/SKILL.md`          | The guided procedure: trigger → capture depth-B set → read screenshots + source → score → write findings doc. Carries the HARD-GATE forbidding source edits. | 3    |
| `docs/architecture/storybook-screenshots.md` | Existing pipeline doc; gains a cross-link to the review workflow.                                                                                            | 4    |
| `docs/ux-reviews/ToolsSection.md`            | Dogfood output #1 — proves the skill produces conforming output.                                                                                             | 5    |
| `docs/ux-reviews/TaskProviderSection.md`     | Dogfood output #2 — proves repeatability (structurally identical to #1).                                                                                     | 6    |

---

## Task 1: Author the rubric

**Files:**

- Create: `docs/ux-reviews/RUBRIC.md`

- [ ] **Step 1: Write the rubric file with full content**

Create `docs/ux-reviews/RUBRIC.md` with exactly this content:

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review Rubric

The fixed scoring reference for every UX review (see `.claude/skills/ux-review/SKILL.md`).
Score each dimension **pass** / **warn** / **fail**. A dimension is **warn** when there is a
real but non-blocking issue, **fail** when a user is likely to be confused, blocked, or
excluded.

## 1. Visual hierarchy & scanning

- Is the most important element the most prominent?
- Is the eyebrow / title / heading rhythm consistent with the rest of the app?
- Is related content grouped, and unrelated content separated?

## 2. Affordance & signifiers

- Do interactive elements look interactive?
- Is the current / selected / active state visible (compare against the nav's green active-border)?
- Are buttons, links, and plain-text actions visually distinguishable from each other?

## 3. Consistency with the design system

- Does it reuse shared primitives (`Btn`, `Field`, `Select`, `StatusPill`, `Pill`) instead of one-off styling?
- Does it match patterns already used by sibling sections?

## 4. Feedback & state

- Are loading / empty / error / success states present, clear, and non-alarming?
- Is validation surfaced at the right place and time?
- Can a user discover _why_ a disabled control is disabled?

## 5. Content & language

- Are labels clear and free of unexplained jargon (e.g. raw ids like `inst_abc`)?
- Is helper text useful rather than decorative?
- Do empty states give actionable next steps rather than a dead end?

## 6. Accessibility

- Contrast on the dark theme — flag suspect low-contrast greys.
- Focus order and keyboard reachability (checked against source).
- Semantic markup / ARIA — real `<button>`/`<label>`/`aria-*` vs. clickable `<div>`s (checked against source).
- Touch/click target sizes.

## 7. Responsive / layout

- Does it reflow cleanly at the narrow (~640px) viewport?
- Any overflow, clipping, or truncation of long values?
- Does the layout look sparse or unbalanced when data is minimal?
```

- [ ] **Step 2: Format and verify the header check passes**

Run:

```bash
bunx prettier --write docs/ux-reviews/RUBRIC.md
grep -c "SPDX-License-Identifier" docs/ux-reviews/RUBRIC.md
```

Expected: prettier reports the file; grep prints `1`.

- [ ] **Step 3: Verify all seven dimensions are present**

Run:

```bash
grep -E '^## [1-7]\.' docs/ux-reviews/RUBRIC.md | wc -l
```

Expected: `7`.

- [ ] **Step 4: Commit**

```bash
git add docs/ux-reviews/RUBRIC.md
git commit -m "docs(ux-reviews): add seven-dimension UX review rubric"
```

Expected: pre-commit prints `4/4 checks passed`.

---

## Task 2: Author the output template (the convention)

**Files:**

- Create: `docs/ux-reviews/_TEMPLATE.md`

- [ ] **Step 1: Write the template with full content**

Create `docs/ux-reviews/_TEMPLATE.md` with exactly this content:

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — &lt;Section&gt;

**Date:** YYYY-MM-DD
**Reviewed:** `client/settings/sections/<Section>.svelte`
**States captured:** Populated, Empty, Error, Loading, &lt;interaction states&gt; · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score          | Rationale (one line) |
| ------------------------------- | -------------- | -------------------- |
| 1. Visual hierarchy & scanning  | pass/warn/fail | …                    |
| 2. Affordance & signifiers      | pass/warn/fail | …                    |
| 3. Consistency w/ design system | pass/warn/fail | …                    |
| 4. Feedback & state             | pass/warn/fail | …                    |
| 5. Content & language           | pass/warn/fail | …                    |
| 6. Accessibility                | pass/warn/fail | …                    |
| 7. Responsive / layout          | pass/warn/fail | …                    |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] &lt;short title&gt;

- **Dimension:** &lt;2. Affordance & signifiers&gt;
- **Where visible:** &lt;state / viewport screenshot&gt;
- **Source:** `client/settings/sections/<Section>.svelte:NN`
- **Suggested fix:** &lt;one descriptive line — not an edit, not a before→after&gt;

### [Med] &lt;short title&gt;

- **Dimension:** …
- **Where visible:** …
- **Source:** `…:NN`
- **Suggested fix:** …

### [Low] &lt;short title&gt;

- **Dimension:** …
- **Where visible:** …
- **Source:** `…:NN`
- **Suggested fix:** …
```

- [ ] **Step 2: Format and commit**

```bash
bunx prettier --write docs/ux-reviews/_TEMPLATE.md
git add docs/ux-reviews/_TEMPLATE.md
git commit -m "docs(ux-reviews): add findings-doc output template"
```

Expected: pre-commit prints `4/4 checks passed`.

---

## Task 3: Author the review skill

**Files:**

- Create: `.claude/skills/ux-review/SKILL.md`

- [ ] **Step 1: Write the skill with full content**

Create `.claude/skills/ux-review/SKILL.md` with exactly this content:

````markdown
---
name: ux-review
description: Use when the user asks to review, critique, or assess the UI/UX of a papai settings/admin section or `client/` component — e.g. "UX review ToolsSection", "review the UI of the task provider panel", "run a UX review on the members section". Produces a report-only, severity-ranked findings document; it never edits source.
---

# UX Review (guided, screenshot + source, report-only)

Review one `client/` section by reading its Storybook screenshots **together with** its
source, scoring against the fixed rubric, and writing a severity-ranked findings document.

<HARD-GATE>
This skill is REVIEW-ONLY. While running it you MUST NOT:

- edit, create, or delete any `.svelte`, `.ts`, `.tsx`, `.js`, `.jsx` file under `client/` or `src/`;
- propose concrete edits, before→after diffs, or an ordered change-plan (findings carry only a one-line described fix);
- run any fix → re-shoot → verify loop.

Allowed outputs: markdown under `docs/ux-reviews/`; reading any repo file; running
`bun shoot` / `bun shoot:gen` to capture screenshots; reading the resulting PNGs. Applying
findings is a separate, human-initiated step in a separate session.
</HARD-GATE>

## When to Use

- "UX review `<Section>`", "review the UI of `<X>`", "run a UX review on `<X>`".
- `<X>` is a settings/admin section or a `client/` component with a Storybook story.

**Do NOT use** for: writing or fixing component code; visual-regression gating; whole-UI
batch sweeps (this is per-section, human-triggered).

## Prerequisites

- Storybook running: `bun storybook` (kept warm).
- One-time: `bunx playwright install chromium`.
- Background reading: `docs/architecture/storybook-screenshots.md`.

## Procedure

1. **Resolve the target.** Find the component (`client/**/<Section>.svelte`) and its story
   (`client/**/<Section>.stories.svelte`). Note the story id stem, e.g.
   `settings-sections-toolssection`.

2. **Capture the depth-B set.** Shoot the existing state stories:

   ```bash
   bun shoot -g <Section>
   ```

   Then add the interaction + narrow-viewport states you need in the manual region of the
   generated spec (`tests/visual/**/<Section>.spec.ts`, below `// @generated-end auto-screenshots`)
   and re-shoot. Use the real `@crvy/strybk` API:

   ```ts
   // below @generated-end auto-screenshots
   test('<Section> — expanded, narrow', async ({ sharedPage }) => {
     await switchStory(sharedPage, 'settings-sections-<section>--populated')
     await sharedPage.setViewportSize({ width: 640, height: 900 })
     await sharedPage.getByText('tasks').click() // expand an accordion group, etc.
     await expect(sharedPage).toHaveScreenshot()
   })
   ```

   Capture only the interaction states that apply (expanded group, focused input,
   invalid/validation, primary-action hover) plus the ~640px narrow width. Desktop is the
   default width.

3. **Read screenshots + source together.** Read the baseline PNGs under
   `.storybook-shots/**/<Section>.spec.ts/` with the Read tool, and read the component
   source. Source is mandatory — it is what makes affordance and accessibility findings real
   (semantic markup, `aria-*`, focus order, disabled reasoning) rather than guessed from pixels.

4. **Score against the rubric.** Walk all seven dimensions in `docs/ux-reviews/RUBRIC.md`;
   assign each `pass` / `warn` / `fail` with one line of rationale.

5. **Write the findings doc.** Copy `docs/ux-reviews/_TEMPLATE.md` to
   `docs/ux-reviews/<Section>.md` and fill it in: the scorecard header, then severity-ranked
   findings (High → Low). Each finding carries dimension · severity · where-visible · source
   anchor (`file:line`) · one-line suggested fix. Nothing more — no edits, no change-plan.

6. **Format and hand off.** `bunx prettier --write docs/ux-reviews/<Section>.md`, then report
   the path to the user. Do not commit unless asked. Stop — implementation is a separate session.

## Optional: cross-section consistency pass

When asked to review consistency rather than one component, read the composed `SettingsApp`
shots (`Personal-ready`, `Group-ready`, `Admin-ready`), compare sections against rubric
dimension 3, and write `docs/ux-reviews/_consistency.md` in the same findings format.
````

- [ ] **Step 2: Verify frontmatter and HARD-GATE are present**

Run:

```bash
head -4 .claude/skills/ux-review/SKILL.md
grep -c "HARD-GATE" .claude/skills/ux-review/SKILL.md
```

Expected: first line is `---`, `name: ux-review` present; grep prints `2` (open + close tag).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/ux-review/SKILL.md
git commit -m "feat(skills): add report-only ux-review guided procedure"
```

Expected: pre-commit passes (skill files are exempt from the SPDX header check).

---

## Task 4: Cross-link from the screenshot pipeline doc

**Files:**

- Modify: `docs/architecture/storybook-screenshots.md`

- [ ] **Step 1: Append a cross-link section**

Add this section to the end of `docs/architecture/storybook-screenshots.md`:

```markdown
## Structured UX review

To turn a screenshot into a scored, severity-ranked findings document, use the
`ux-review` skill (`.claude/skills/ux-review/SKILL.md`). It captures the depth-B state set,
reads screenshots alongside component source, scores against `docs/ux-reviews/RUBRIC.md`, and
writes a report-only findings doc under `docs/ux-reviews/`. Trigger it with
"UX review `<Section>`".
```

- [ ] **Step 2: Format and commit**

```bash
bunx prettier --write docs/architecture/storybook-screenshots.md
git add docs/architecture/storybook-screenshots.md
git commit -m "docs(storybook): link screenshot pipeline to ux-review skill"
```

Expected: pre-commit passes.

---

## Task 5: Dogfood #1 — review ToolsSection

This is the acceptance test for the whole workflow: run the skill end-to-end and confirm the
output conforms to the template.

**Files:**

- Create: `docs/ux-reviews/ToolsSection.md`
- Reference (read-only): `client/settings/sections/ToolsSection.svelte`, `.storybook-shots/settings/sections/ToolsSection.spec.ts/*.png`

- [ ] **Step 1: Ensure Storybook is running**

Run (in a separate shell if needed):

```bash
bun storybook
```

Expected: Storybook serves; leave it running.

- [ ] **Step 2: Capture the ToolsSection state set**

Run:

```bash
bun shoot -g ToolsSection
ls .storybook-shots/settings/sections/ToolsSection.spec.ts/
```

Expected: PNGs for `Populated`, `Empty`, `Error`, `Loading`, `Grouped`, `Preset-applied`.

- [ ] **Step 3: Add an expanded + narrow-viewport interaction shot**

In `tests/visual/settings/sections/ToolsSection.spec.ts`, below `// @generated-end auto-screenshots`, add:

```ts
test('Tools — grouped, expanded, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-toolssection--grouped')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.getByText('tasks').click()
  await expect(sharedPage).toHaveScreenshot()
})
```

Then run:

```bash
bun shoot -g ToolsSection
```

Expected: the new shot is captured under `test-results/` (transient) — read it there.

- [ ] **Step 4: Read screenshots + component source**

Read (with the Read tool): each ToolsSection PNG, plus `client/settings/sections/ToolsSection.svelte`.

- [ ] **Step 5: Write the findings doc**

Copy `docs/ux-reviews/_TEMPLATE.md` to `docs/ux-reviews/ToolsSection.md` and fill it in from
your observations. It MUST contain: the SPDX header, a scorecard with all seven dimensions
scored, and at least three severity-ranked findings, each with dimension · severity ·
where-visible · a resolvable `ToolsSection.svelte:NN` anchor · one-line fix. (Known starting
observations from design review: preset control shows no selected state; `Custom` is
visually detached from the presets; bare `Ask all` / `Allow all` text actions have unclear
affordance; populated view is sparse.)

- [ ] **Step 6: Verify structural conformance**

Run:

```bash
bunx prettier --write docs/ux-reviews/ToolsSection.md
grep -c "SPDX-License-Identifier" docs/ux-reviews/ToolsSection.md            # expect 1
grep -Ec '^\| [1-7]\.' docs/ux-reviews/ToolsSection.md                        # expect 7 (scorecard rows)
grep -Ec '^### \[(High|Med|Low)\]' docs/ux-reviews/ToolsSection.md            # expect >= 3
grep -Ec 'ToolsSection\.svelte:[0-9]+' docs/ux-reviews/ToolsSection.md        # expect >= 3
```

Expected: `1`, `7`, `>=3`, `>=3` respectively.

- [ ] **Step 7: Verify the HARD-GATE held**

Run:

```bash
git status --porcelain client/ src/
```

Expected: **empty** output — no product source was modified. (The `tests/visual/**` manual-region
edit is the only allowed exception; confirm nothing under `client/` or `src/` changed.)

- [ ] **Step 8: Commit**

```bash
git add docs/ux-reviews/ToolsSection.md tests/visual/settings/sections/ToolsSection.spec.ts
git commit -m "docs(ux-reviews): dogfood ux-review skill on ToolsSection"
```

Expected: pre-commit passes.

---

## Task 6: Dogfood #2 — review TaskProviderSection (repeatability)

**Files:**

- Create: `docs/ux-reviews/TaskProviderSection.md`
- Reference (read-only): `client/settings/sections/TaskProviderSection.svelte`, `.storybook-shots/settings/sections/TaskProviderSection.spec.ts/*.png`

- [ ] **Step 1: Capture the state set**

Run:

```bash
bun shoot -g TaskProviderSection
ls .storybook-shots/settings/sections/TaskProviderSection.spec.ts/
```

Expected: PNGs for the available stories (at least `Populated`, `Error`).

- [ ] **Step 2: Read screenshots + component source**

Read each TaskProviderSection PNG plus `client/settings/sections/TaskProviderSection.svelte`.

- [ ] **Step 3: Write the findings doc**

Copy `docs/ux-reviews/_TEMPLATE.md` to `docs/ux-reviews/TaskProviderSection.md` and fill it in
from your observations, following the same structure as Task 5.

- [ ] **Step 4: Verify structural conformance (same shape as ToolsSection)**

Run:

```bash
bunx prettier --write docs/ux-reviews/TaskProviderSection.md
grep -c "SPDX-License-Identifier" docs/ux-reviews/TaskProviderSection.md         # expect 1
grep -Ec '^\| [1-7]\.' docs/ux-reviews/TaskProviderSection.md                     # expect 7
grep -Ec '^### \[(High|Med|Low)\]' docs/ux-reviews/TaskProviderSection.md         # expect >= 1
grep -Ec 'TaskProviderSection\.svelte:[0-9]+' docs/ux-reviews/TaskProviderSection.md  # expect >= 1
```

Expected: `1`, `7`, `>=1`, `>=1`.

- [ ] **Step 5: Confirm repeatability**

The two findings docs must be structurally identical (same scorecard header, same finding
fields). Run:

```bash
diff <(grep -E '^(## |^\| [1-7]\.|\*\*Dimension|\*\*Where|\*\*Source|\*\*Suggested)' docs/ux-reviews/ToolsSection.md | sed 's/[0-9]\+//g') \
     <(grep -E '^(## |^\| [1-7]\.|\*\*Dimension|\*\*Where|\*\*Source|\*\*Suggested)' docs/ux-reviews/TaskProviderSection.md | sed 's/[0-9]\+//g') | head
```

Expected: the section headers and field labels match (differences only in prose/counts, not structure).

- [ ] **Step 6: Verify HARD-GATE and commit**

```bash
git status --porcelain client/ src/   # expect empty
git add docs/ux-reviews/TaskProviderSection.md
git commit -m "docs(ux-reviews): dogfood ux-review skill on TaskProviderSection"
```

Expected: `client/`/`src/` clean; pre-commit passes.

---

## Self-Review (completed during planning)

**Spec coverage:**

- Guided skill, per-section trigger → Task 3. ✔
- Depth B (states + interaction states + 2 viewports + source) → Task 3 step 1 procedure + Task 5 steps 2–4. ✔
- Seven-dimension rubric, pass/warn/fail → Task 1. ✔
- Report-only output (scorecard + severity-ranked findings, source anchors, no plan) → Task 2 template + Tasks 5–6 outputs. ✔
- HARD-GATE (no source edits) → Task 3 skill body + Tasks 5–6 step verifying `git status` clean. ✔
- Lives at `.claude/skills/ux-review/SKILL.md` + `docs/ux-reviews/RUBRIC.md` + `docs/ux-reviews/` → Tasks 1–3. ✔
- Optional cross-section consistency mode → Task 3 skill body. ✔
- Validation by dogfooding ToolsSection + TaskProviderSection → Tasks 5–6. ✔

**Placeholder scan:** the only `<Section>` / `…` placeholders are inside the template and skill
_content_ (where they are intentional fill-in markers), not in plan instructions. No TODO/TBD.

**Type/name consistency:** story-id stems, file paths, `@crvy/strybk` import, and grep acceptance
checks are consistent across Tasks 3, 5, 6.
