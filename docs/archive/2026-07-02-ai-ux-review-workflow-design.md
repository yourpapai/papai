<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AI UX Review Workflow (guided, screenshot + source, report-only)

**Date:** 2026-07-02
**Status:** Design — approved for planning
**Topic:** A repeatable, guided procedure that lets a local Claude Code session review the UI/UX of a `client/` component or section — reading its Storybook screenshots _together with_ its source, scoring against a fixed rubric, and emitting a severity-ranked findings document. Review only; it never edits source.

## 1. Problem & Goal

The project already has the [Storybook → agent screenshot pipeline](./2026-06-30-storybook-agent-screenshot-pipeline-design.md): a session can shoot any story and read the PNG back in-session. That gives the agent _eyes_, but nothing structures what it does with them. Ad-hoc "review this UI" prompts produce inconsistent, un-comparable output and lean on the weakest form of screenshot review: a single default state, at a single viewport, with no source context and no accessibility signal.

The goal is a **repeatable review workflow** — a documented protocol plus a fixed rubric — that a human points at one section (`UX review ToolsSection`) and gets back a consistent, severity-ranked findings document scoped to that section.

The workflow is a **guided agent procedure**, not an automated pipeline: a human triggers it per-section; the agent drives the existing `bun shoot` tooling and the Read tool. This keeps build cost low and reuses infrastructure that already exists.

### Non-goals (YAGNI)

- **Automated/CI whole-UI sweeps.** No `bun ux:review` script, no multi-agent fan-out, no consolidated all-sections report. Per-section, human-triggered only.
- **Applying fixes.** The workflow is report-only (see §5). It does not edit `.svelte`/source, and it does not even produce an ordered change-plan — each finding carries a one-line _described_ fix, nothing more. Implementation is a separate, human-initiated step in a separate session.
- **Visual-regression gating.** Inherited from the screenshot pipeline's non-goals; we review the current render, not police a baseline.
- **Machine a11y tooling (axe/Storybook a11y addon) as a hard dependency.** Accessibility is reviewed by reasoning over screenshots + source. Wiring axe is a documented optional upgrade, not part of this phase.
- **Cross-browser / exhaustive viewport matrices.** Chromium only; two viewports (see §3).

## 2. Current State (findings)

- `bun shoot -g <name>` captures a story's PNG(s) under `.storybook-shots/` (gitignored baselines); the Read tool ingests them directly. Documented in [`docs/architecture/storybook-screenshots.md`](../../architecture/storybook-screenshots.md).
- Most settings sections already ship `Empty` / `Error` / `Loading` / `Populated` story states (e.g. `ToolsSection`, `TaskProviderSection`, `McpSection`). The state fuel largely exists.
- The shoot spec files support a **manual region** below `// @generated-end auto-screenshots` for interaction states (click-to-expand, focus, invalid), preserved across `bun shoot:gen`.
- Composed `SettingsApp` shots (`Personal-ready`, `Group-ready`, `Admin-ready`) exist and are useful for cross-section consistency.
- Project skills live at `.claude/skills/<name>/SKILL.md` (YAML frontmatter `name` + `description`, a purpose line, a **When to Use** section, an optional `<HARD-GATE>`, then the procedure). Reference docs live under `docs/`.
- There is no `docs/ux-reviews/` directory yet and no review rubric.

## 3. Depth: what a review captures (level "B")

Per section under review, the agent gathers:

- **State set** — the existing state stories (`Populated`/default, `Empty`, `Error`, `Loading`) where present, **plus** a small number of relevant **interaction states** captured via the manual-region trick: e.g. an expanded accordion group, a focused input, an invalid/validation state, primary-action hover — only those that apply to the component.
- **Viewports** — desktop (the existing default width) **and** a narrow width (~640px) to surface reflow, truncation, and sparseness. (375px mobile is an optional third pass, not required.)
- **Component source** — the `.svelte` component and its `.stories.svelte`. Reading source alongside the screenshot is mandatory: it is what makes affordance and accessibility findings _real_ (semantic markup, `aria-*`, focus order, disabled reasoning) rather than guessed from pixels.

Lean (default-only, desktop-only) and Deep (axe pass, full interaction matrix, 3 viewports, cross-section sweep) are documented as dials, but the standard procedure is B.

## 4. The rubric

A fixed reference at `docs/ux-reviews/RUBRIC.md`. Seven dimensions, each scored **pass / warn / fail**:

1. **Visual hierarchy & scanning** — is the most important element the most prominent; is the eyebrow/title/heading rhythm consistent; is related content grouped.
2. **Affordance & signifiers** — do interactive things look interactive; is the current/selected/active state visible; are buttons vs links vs plain-text-actions distinguishable.
3. **Consistency with the design system** — reuse of shared primitives (`Btn`, `Field`, `StatusPill`, the green active-border treatment) versus one-off styling; alignment with patterns already present elsewhere in the UI.
4. **Feedback & state** — are loading / empty / error / success states present, clear, and non-alarming; is validation surfaced; is a disabled control's reason discoverable.
5. **Content & language** — labels clear; jargon flagged (e.g. `inst_abc`); helper text useful; empty states give actionable guidance rather than a dead end.
6. **Accessibility** — contrast on the dark theme (flag suspect low-contrast greys), focus order, keyboard reachability, semantic markup / ARIA (checked against source), target sizes.
7. **Responsive / layout** — reflow at the narrow viewport, sparse or overflowing layout, truncation of long values.

## 5. Output

One document per review: `docs/ux-reviews/<Section>.md`, committed as a durable artifact.

Structure:

- **Scorecard header** — the seven dimensions, each `pass` / `warn` / `fail`, one line of rationale each.
- **Severity-ranked findings** — highest severity first. Each finding carries:
  - **dimension** (one of the seven),
  - **severity** (High / Med / Low),
  - **where it's visible** — the state and/or viewport screenshot it was observed in,
  - **source anchor** — `<file>:<line>`,
  - **suggested fix** — a single descriptive line (not an edit, not a before→after, not an ordered plan).

The document is diagnostic only. It contains no code changes and no change-plan. Acting on it is a separate human decision.

## 6. Where it lives (components)

| Unit          | Path                                | Purpose                                                                                                                                                                        | Depends on                         |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Review skill  | `.claude/skills/ux-review/SKILL.md` | The guided procedure: trigger → capture standard set → read screenshots + source → score against rubric → write findings doc. Carries a `<HARD-GATE>` forbidding source edits. | `bun shoot`, Read tool, the rubric |
| Rubric        | `docs/ux-reviews/RUBRIC.md`         | The fixed seven-dimension scoring reference the skill and every findings doc point at.                                                                                         | —                                  |
| Findings docs | `docs/ux-reviews/<Section>.md`      | Per-review output artifacts (see §5).                                                                                                                                          | rubric, screenshots, source        |

**Trigger phrases:** "UX review \<Section\>", "review the UI of \<X\>", "run a UX review on \<X\>".

## 7. Guardrails (HARD-GATE)

The skill is **review-only**. During it, the agent MUST NOT:

- edit, create, or delete any `.svelte`, `.ts`, `.tsx`, `.js`, `.jsx` file under `client/` or `src/`;
- propose concrete edits, before→after diffs, or an ordered change-plan (findings carry only a one-line described fix);
- run the full fix → re-shoot → verify loop (that is a separate, explicitly opt-in mode, off by default and out of scope here).

Allowed outputs: markdown under `docs/ux-reviews/`; reading any repo file; running `bun shoot` / `bun shoot:gen` to capture screenshots; reading PNGs.

## 8. Bonus mode (optional)

A **cross-section consistency pass**: rather than one component, the agent reviews the composed `SettingsApp` shots (`Personal-ready`, `Group-ready`, `Admin-ready`) and compares multiple sections against dimension ③ to catch drift that per-component isolation hides. Emitted as `docs/ux-reviews/_consistency.md`. Optional; invoked explicitly.

## 9. How this answers "is AI screenshot review the right approach?"

The workflow is deliberately the _strong_ form of screenshot review, closing the five weaknesses of the naive form:

| Weakness of naive screenshot review      | Closed by                                   |
| ---------------------------------------- | ------------------------------------------- |
| One state per story                      | §3 standard state + interaction-state set   |
| One viewport                             | §3 desktop + narrow (~640px)                |
| Image-only (no a11y, guessed affordance) | §3 mandatory source pairing; §4 dimension ⑥ |
| No structure / not comparable            | §4 fixed rubric + §5 scorecard              |
| Isolation hides flow & drift             | §8 cross-section consistency pass           |

## 10. Testing / validation

This is a documentation-and-procedure change (a skill + a rubric + an output convention), so validation is by dogfooding rather than unit tests:

- Run the skill against `ToolsSection` (the section already sketched in brainstorming) and confirm the output conforms to §5 (scorecard + severity-ranked findings with source anchors).
- Confirm the HARD-GATE holds: the run produces only markdown under `docs/ux-reviews/` and never edits a component.
- Confirm a second section (e.g. `TaskProviderSection`) produces a structurally identical document, demonstrating repeatability.

## 11. Open questions / future work

- Wiring `axe` / the Storybook a11y addon to give dimension ⑥ a machine-checkable signal (currently reasoning-only).
- An automated whole-UI sweep (the pipeline approach we deferred) if per-section reviews prove valuable enough to want batch runs.
- An opt-in fix → re-shoot → verify loop as a distinct skill that consumes a findings doc.
