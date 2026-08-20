<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — &lt;Section&gt;

**Date:** YYYY-MM-DD
**Reviewed:** `client/settings/sections/<Section>.svelte`
**States captured:** Populated, Empty, Error, Loading, &lt;hover / active / focus / disabled / busy&gt;, &lt;long-content&gt; · desktop + ~640px
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
| 8. Spacing, alignment & sizing  | pass/warn/fail | …                    |
| 9. Interaction & micro-states   | pass/warn/fail | …                    |

## Findings

Severity-ranked, highest first. Each finding = id · status · dimension · severity · where visible ·
source anchor · suggested fix.

`Id` is kebab-case, section-prefixed, assigned by hand, and never derived from the heading — a
reworded title must not orphan it. Ids are never reused.

`Status` is one of:

- `open` — still reproduces.
- `fixed` — no longer reproduces; requires a `**Resolved:**` line naming the commit or sub-project.
- `superseded` — no longer meaningful; requires a `**Resolved:**` line.
- `wont-fix` — examined, and no change is warranted: either the finding's premise was wrong, or the current behaviour is accepted as-is. Requires a `- **Resolved:**` line carrying the rationale; unlike `fixed` and `superseded`, it needs no commit hash.
- `deferred` — a real gap, acknowledged, blocked on work outside this project's scope. Requires a `- **Resolved:**` line carrying the rationale and naming the blocker; no commit hash. Deferred findings are listed in `_BACKLOG.md`'s `## Deferred` section so they stay visible.

There is no `partial`. A partially-fixed finding stays `open` with its text narrowed to the residue,
keeping its id.

### [High] &lt;short title&gt;

- **Id:** &lt;section&gt;-&lt;short-defect-slug&gt;
- **Status:** open
- **Dimension:** &lt;2. Affordance & signifiers&gt;
- **Where visible:** &lt;state / viewport screenshot&gt;
- **Source:** `client/settings/sections/<Section>.svelte:NN`
- **Suggested fix:** &lt;one descriptive line — not an edit, not a before→after&gt;

### [Med] &lt;short title&gt;

- **Id:** …
- **Status:** open
- **Dimension:** …
- **Where visible:** …
- **Source:** `…:NN`
- **Suggested fix:** …

### [Low] &lt;short title&gt;

- **Id:** …
- **Status:** open
- **Dimension:** …
- **Where visible:** …
- **Source:** `…:NN`
- **Suggested fix:** …
