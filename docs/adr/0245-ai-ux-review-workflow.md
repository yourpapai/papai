<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0245: AI UX Review Workflow

## Status

Implemented (with divergence)

## Date

2026-07-02

## Context

The project already had the Storybook → agent screenshot pipeline (ADR-0238): a session can `bun shoot -g <Section>` any story and read the PNG back in-session, giving the agent _eyes_. But nothing structured what it did with them — ad-hoc "review this UI" prompts produced inconsistent, un-comparable output and leaned on the weakest form of screenshot review (a single default state, at a single viewport, with no source context and no accessibility signal).

The design (`docs/superpowers/specs/2026-07-02-ai-ux-review-workflow-design.md`) and plan (`docs/superpowers/plans/2026-07-02-ai-ux-review-workflow.md`) wanted a **repeatable, guided, report-only review workflow** — a project skill plus a fixed rubric and an output convention — that a human points at one `client/` section (`UX review ToolsSection`) and gets back a consistent, severity-ranked findings document. Four things defined "repeatable":

1. A **guided agent procedure** (a `.claude/skills/ux-review/SKILL.md` skill) that captures a depth-B state set (state stories + interaction states + desktop & ~640px viewports), reads screenshots **together with** component source, scores against the rubric, and writes a findings doc.
2. A **fixed rubric** (`docs/ux-reviews/RUBRIC.md`) — seven dimensions, each `pass`/`warn`/`fail` — as the single source of truth every findings doc cites.
3. An **output convention** (`docs/ux-reviews/_TEMPLATE.md`): a scorecard header plus severity-ranked findings (High/Med/Low), each carrying dimension · severity · where-visible · `file:line` source anchor · one-line suggested fix.
4. A **HARD-GATE** forbidding source edits: the skill is review-only, produces only markdown under `docs/ux-reviews/`, and never proposes edits/diffs/change-plans.

Explicit non-goals (YAGNI): no `bun ux:review` automation/CI sweep, no multi-agent fan-out, no consolidated all-sections report (per-section, human-triggered only); no applying fixes; no visual-regression gating; no hard dependency on machine a11y tooling (axe). Validation is by dogfooding against `ToolsSection` and `TaskProviderSection`, not unit tests.

## Decision Drivers

- **Guided procedure over automated pipeline.** A human triggers the skill per-section; the agent drives the existing `bun shoot` tooling and the Read tool. Keeps build cost low and reuses the ADR-0238 infrastructure.
- **The strong form of screenshot review.** Close the five weaknesses of the naive form: many states (not one), two viewports (not one), mandatory source pairing (so affordance/a11y findings are real, not guessed from pixels), a fixed rubric + scorecard (comparable, structured), and an optional cross-section consistency pass.
- **Fixed rubric as the single source of truth.** Seven dimensions scored `pass`/`warn`/`fail`; every findings doc points at the same `RUBRIC.md` so reviews are comparable section-to-section.
- **Report-only HARD-GATE.** The workflow diagnoses; it never edits `.svelte`/`.ts`/source and never produces an ordered change-plan. Each finding carries only a one-line described fix; implementation is a separate, human-initiated session.
- **Source pairing is mandatory, not optional.** Reading the component source alongside the screenshot is what makes affordance (semantic markup, `aria-*`), focus order, and disabled-reasoning findings real rather than pixel-guesses.
- **Validation by dogfooding.** Run the skill end-to-end on two real sections and confirm the output conforms to the template and is structurally identical, proving repeatability.

## Considered Options

### Option 1 — Guided per-section skill + fixed rubric + report-only findings doc; depth-B capture (chosen)

Three authored markdown artifacts (skill, rubric, output template) plus dogfooding. The skill is human-triggered per section; it reuses the existing screenshot pipeline and the Read tool; it carries a HARD-GATE forbidding source edits.

- **Pros:** lowest build cost (markdown only, no product source changes); reuses ADR-0238 infrastructure; the rubric + scorecard make reviews comparable; the HARD-GATE keeps diagnosis cleanly separated from implementation; per-section triggering avoids the cost/risk of whole-UI sweeps.
- **Cons:** per-section triggering is manual, so coverage depends on a human remembering to run it; accessibility is reasoning-only (no machine axe signal); the agent must actually read source for findings to be trustworthy.

### Option 2 — Automated/CI whole-UI sweep (`bun ux:review` + multi-agent fan-out + consolidated report)

A script that walks every settings section, shoots each, and emits one consolidated all-sections findings report, optionally on a schedule or in CI.

- **Pros:** complete coverage with no manual triggering; a single consolidated artifact; can gate on regressions.
- **Cons:** explicitly rejected as a non-goal — high build cost, multi-agent fan-out complexity, and it duplicates visual-regression gating the screenshot pipeline already declined; loses the per-section, human-curated focus the operator wanted; an automated consolidated report is hard to keep trustworthy without per-section source review.

### Option 3 — Lean (default-state, desktop-only, no source) review

The weakest form: shoot the default story at the default width and free-form-comment on the PNG, no rubric, no source.

- **Cons:** rejected in the design — it is precisely the inconsistent, un-comparable, pixel-only output this workflow exists to replace; affordance and accessibility cannot be assessed from a single frame without source.

## Decision

Option 1 shipped in full across the skill, the rubric, the output template, the pipeline cross-link, and the two dogfooding acceptance outputs. What shipped:

1. **Rubric (`docs/ux-reviews/RUBRIC.md`).** The fixed scoring reference every findings doc cites. Scored `pass`/`warn`/`fail` per dimension, with `warn` for a real-but-non-blocking issue and `fail` when a user is likely to be confused, blocked, or excluded.
2. **Output template (`docs/ux-reviews/_TEMPLATE.md`).** The exact skeleton a findings doc follows: SPDX header, scorecard table, then severity-ranked findings (High → Low) each with dimension · severity · where-visible · `file:line` source anchor · one-line suggested fix.
3. **Skill (`.claude/skills/ux-review/SKILL.md`).** The guided procedure: resolve target → capture depth-B set → read screenshots + source together → score against the rubric → write findings doc → format and hand off. Carries the review-only `<HARD-GATE>` forbidding any source edit, edit/diff/change-plan, or fix → re-shoot → verify loop.
4. **Pipeline cross-link (`docs/architecture/storybook-screenshots.md`).** A "Structured UX review" section linking the screenshot pipeline to the skill and rubric.
5. **Dogfood #1 — `ToolsSection.md`.** Proves the skill produces a conforming, severity-ranked findings doc end-to-end against a real section.
6. **Dogfood #2 — `TaskProviderSection.md`.** Proves repeatability: structurally identical to #1 (same scorecard header, same finding fields).

## Consequences

### Positive

- A human can point the skill at any `client/` section and get back a consistent, comparable, severity-ranked findings document with real source anchors — closing the five weaknesses of naive screenshot review.
- Source pairing makes affordance and accessibility findings trustworthy (semantic markup, `aria-*`, focus order, disabled reasoning) rather than pixel-guesses.
- The HARD-GATE keeps diagnosis cleanly separated from implementation: the workflow never edits source and never produces an ordered change-plan, so acting on a finding is always a deliberate, separate human decision.
- Build cost was near-zero (markdown only; no product source changes) because it reuses the existing screenshot pipeline and the Read tool.
- The workflow was reused well beyond the two planned acceptance outputs (≈15 findings docs now live under `docs/ux-reviews/`), evidencing that it is genuinely repeatable and useful.

### Negative

- **The rubric grew beyond the plan** from 7 to 9 dimensions, so the two planned dogfood outputs (which score 7) now lag the current rubric (9) — the workflow's own artifacts are momentarily inconsistent with each other.
- **The skill's formatter instruction diverged** from the plan (`prettier` → `oxfmt`), reflecting a repo-wide formatter change; the plan's `bunx prettier --write` step would now fail.
- **Coverage is manual.** Per-section triggering means a section is only reviewed if a human remembers to run the skill; there is no coverage tracking.
- **Accessibility remains reasoning-only.** No machine axe/a11y signal, so contrast and ARIA findings are inferred from source/tokens rather than measured.
- **A dogfood run can be blocked by Storybook.** During the `ToolsSection` acceptance run `bun shoot` failed with a Storybook addons-channel error, forcing one finding to be source-inferred rather than screenshot-confirmed.

### Risks

- **Findings quality depends on the agent actually reading source.** If the agent skips source pairing, affordance/a11y findings degrade to pixel-guesses; the HARD-GATE prevents fixing this in-run.
- **Drift between rubric revisions and older findings docs.** As the rubric gains dimensions, existing findings docs are not retroactively re-scored; readers must note which dimension count a given doc was scored against.
- **Source-inferred findings are unverified by a screenshot.** When `bun shoot` fails mid-run, the workflow falls back to source-only reasoning, which is weaker evidence than a captured state (and is flagged as such in the doc).

## Related Decisions

- **ADR-0238: Storybook → Agent Screenshot Pipeline** — the prerequisite infrastructure (`bun shoot` / `@crvy/strybk`, the manual-region trick for interaction states, PNG ingestion via the Read tool) this workflow drives; the pipeline doc gained the "Structured UX review" cross-link back to this skill.
- **The `ux-review` skill** (`.claude/skills/ux-review/SKILL.md`) — the live, reusable guided procedure this ADR records; still the active entry point for "UX review `<Section>`" requests.
- **The settings-section conventions** (`Btn`/`Field`/`Select`/`StatusPill`/`PageHeader`/`EmptyState` shared primitives, the green active-border treatment) that rubric dimension 3 ("Consistency with the design system") measures against.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; the core artifact contents match the plan, with the divergences noted below.

| File | Role | Evidence |
| --- | --- | --- |
| `.claude/skills/ux-review/SKILL.md:1-4` | Skill with YAML frontmatter (`name: ux-review` + trigger `description`), matching the `designing-new-provider` precedent (no SPDX header). | `read` confirms. |
| `.claude/skills/ux-review/SKILL.md:11-21` | The review-only `<HARD-GATE>`: forbids editing `client/`/`src/`, proposing edits/diffs/change-plans, and running a fix → re-shoot → verify loop. | `read` confirms. |
| `.claude/skills/ux-review/SKILL.md:43-71` | Depth-B capture procedure; shoots state stories then adds interaction/micro-state (dim 9) + spacing/sizing (dim 8) variants in the manual spec region; notes `.focus()` does not trigger `:focus-visible`. | `read` confirms. |
| `.claude/skills/ux-review/SKILL.md:94` | Step 6 formatter changed to `bun run format` with the note "the repo formatter is `oxfmt`, not prettier". | `read` confirms; `package.json:36` shows `"format": "oxfmt --write ."`. |
| `.claude/skills/ux-review/SKILL.md:98-102` | Optional cross-section consistency pass → `docs/ux-reviews/_consistency.md`. | `read` confirms (no such doc shipped; it was optional). |
| `docs/ux-reviews/RUBRIC.md:15-57` | Dimensions 1–7 (visual hierarchy, affordance, design-system consistency, feedback/state, content, accessibility, responsive/layout) as planned. | `read` confirms. |
| `docs/ux-reviews/RUBRIC.md:59-67` | **Divergence:** added dimension 8 "Spacing, alignment & sizing" — measured against spacing/size tokens in source, flagging one-off px drift. Not in the plan/spec (which specified exactly 7). | `read` confirms. |
| `docs/ux-reviews/RUBRIC.md:69-78` | **Divergence:** added dimension 9 "Interaction & micro-states" — the transient resting → hover → active → focus → disabled → busy transitions. Not in the plan/spec. | `read` confirms. |
| `docs/ux-reviews/RUBRIC.md:20,57` | **Divergence:** dimension 1 gained a type-scale bullet and dimension 7 a long/localized-content bullet beyond the plan. | `read` confirms. |
| `docs/ux-reviews/_TEMPLATE.md:8-13` | Findings-doc skeleton: SPDX header, reviewed path, states-captured line, rubric link, report-only banner. | `read` confirms. |
| `docs/ux-reviews/_TEMPLATE.md:20-30` | Scorecard table; **divergence:** 9 dimension rows (adds rows 8 & 9) vs the plan's 7. | `read` confirms. |
| `docs/ux-reviews/_TEMPLATE.md:12` | **Divergence:** "States captured" references hover/active/focus/disabled/busy + long-content, vs the plan's generic interaction-states line. | `read` confirms. |
| `docs/ux-reviews/ToolsSection.md:8-23` | Dogfood #1: header, reviewed path, states captured, rubric link, report-only banner — conforms to the template. | `read` confirms. |
| `docs/ux-reviews/ToolsSection.md:16-21` | **Execution caveat:** `bun shoot -g ToolsSection` failed ("Storybook addons channel is unavailable"); the narrow-viewport/interaction finding is source-inferred and flagged as such. | `read` confirms. |
| `docs/ux-reviews/ToolsSection.md:30-38` | Scorecard with 7 rows (dimensions 1–7); `ToolsSection.md:44-121` has 6 severity-ranked findings each with dimension · where-visible · `file:line` source anchor · one-line fix. Meets the plan's `>=3` acceptance threshold. | `read` confirms. |
| `docs/ux-reviews/TaskProviderSection.md:16-22` | Dogfood #2: shoot succeeded (3/3); caveat that only 2 of 5 component states are exercised by any story, so 3 states are source-only inferences. | `read` confirms. |
| `docs/ux-reviews/TaskProviderSection.md:31-39` | Scorecard with 7 rows; structurally identical shape to `ToolsSection.md` (same header, same finding fields) — demonstrates repeatability. | `read` confirms. |
| `docs/architecture/storybook-screenshots.md:72-77` | "Structured UX review" cross-link section pointing the pipeline at the skill + rubric. | `grep` confirms. |
| `docs/ux-reviews/*.md` (15 files) | **Divergence (scale):** the workflow was reused far beyond the 2 planned outputs — ReleaseSubscriptionSection, ProfileSection, McpSection, KaneoAccessSection, IdentitySection, GuestModeSection, MembersSection, AiOutputSection, ByokSection, CodingCredentialsSection, GroupProviderSection, MemorySection, CodingIdentitySection (+ planned ToolsSection, TaskProviderSection). | `glob` confirms. |

Plan-vs-implementation notes:

- **The rubric grew from 7 to 9 dimensions.** The plan (Task 1) and spec (§4) fixed exactly seven dimensions. The shipped `RUBRIC.md` adds **dimension 8 — Spacing, alignment & sizing** (`RUBRIC.md:59-67`, measured against the `--gap-*`/`--radius` tokens in source) and **dimension 9 — Interaction & micro-states** (`RUBRIC.md:69-78`, the resting → hover → active → focus → disabled → busy transitions), and extends dims 1 and 7 with extra bullets. The skill and template were updated to match (9 scorecard rows; the depth-B capture and source-reading steps now key to dims 8 & 9). Intent unchanged — a richer fixed rubric — but the dimension count diverged.
- **The skill's formatter instruction changed.** The plan's every-task step was `bunx prettier --write <file>`. The shipped skill (`SKILL.md:94`) says `bun run format` and explicitly notes "the repo formatter is `oxfmt`, not prettier". Verified: `package.json:36` is `"format": "oxfmt --write ."`. The plan's `prettier` command would now fail the format check.
- **The two planned dogfood outputs score 7 dimensions, not 9.** Both `ToolsSection.md` and `TaskProviderSection.md` (dated 2026-07-02) carry 7-row scorecards, predating the rubric's expansion to 9. They conform to the _original_ plan's structure (and meet its `>=3`/`>=1` findings thresholds), but are momentarily inconsistent with the current 9-dimension rubric/template. A retroactive re-score is out of scope here.
- **A dogfood run was partially blocked by Storybook.** During the `ToolsSection` acceptance run, `bun shoot -g ToolsSection` failed for every story with "Storybook addons channel is unavailable" (`ToolsSection.md:16-21`); the one narrow-viewport/interaction finding was therefore source-inferred (`.settings-tools__domain-head` has no `flex-wrap`) rather than screenshot-confirmed, and is flagged as such. The HARD-GATE held (no `client/`/`src/` edits); only the depth-B capture was incomplete for that section. `TaskProviderSection` captured cleanly (3/3).
- **Dogfooding scaled well beyond the 2 planned outputs.** Tasks 5–6 specified `ToolsSection` and `TaskProviderSection` only; the shipped tree contains ≈15 findings docs, evidencing that the workflow is genuinely repeatable and has been in regular use. The optional `_consistency.md` cross-section pass was never produced — it was explicitly optional in the plan/spec, so its absence is not a divergence.
- **No product source was changed by the workflow**, consistent with the HARD-GATE. This is a documentation-and-procedure change (skill + rubric + template + cross-link + findings docs).

The source plan `docs/superpowers/plans/2026-07-02-ai-ux-review-workflow.md` and design `docs/superpowers/specs/2026-07-02-ai-ux-review-workflow-design.md` are archived alongside this ADR to `docs/archive/`.
