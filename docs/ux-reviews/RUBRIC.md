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
