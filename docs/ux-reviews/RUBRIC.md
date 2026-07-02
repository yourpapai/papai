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
- Does the type scale actually distinguish tiers (heading / label / body / meta), or does everything collapse to one flat weight and size?

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
- Does it hold up with long / localized content (long display names, long error strings, wrapped labels) rather than only the short fixture values?

## 8. Spacing, alignment & sizing

Precision layer — measured against the spacing/size scale in the **source**, not eyeballed
from pixels alone. Flag one-off values that drift from the shared scale.

- Are gaps, margins, and padding consistent with sibling rows/sections, and drawn from the spacing tokens (`--gap-group` / `--gap-section` / `--gap-field` / `--gap-inline`) rather than arbitrary px?
- Do elements share a clean alignment edge and baseline — labels, inputs, and buttons in a row lined up, no ragged left/right edges or optical misalignment?
- Is whitespace balanced (even rhythm between controls), rather than cramped in one place and gappy in another?
- Are control sizes — button/input heights, icon-button and tap targets, border-radius (`--radius`) — pulled from the shared size tokens instead of hardcoded, so siblings match?

## 9. Interaction & micro-states

The transient visual states across an interaction's lifecycle. (Dimension 2 asks whether a
control _looks_ interactive at rest and dimension 4 whether states _exist_; this dimension
checks the visual transitions **between** resting → hover → active → focus → disabled → busy.)

- Do hover / active / pressed states give visible feedback that is distinct from the resting state?
- Is keyboard focus visible — a real `:focus-visible` ring, not `outline: 0` with nothing replacing it (checked in source)?
- Is a disabled control visibly disabled _and_ is the reason for it discoverable?
- Is in-flight / async work signalled (button "Saving…", busy/spinner, pending vs optimistic), not a dead frozen control?
