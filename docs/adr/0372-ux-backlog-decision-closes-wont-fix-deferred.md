<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0372: Decision-Closes for UX Findings — `wont-fix` / `deferred` Statuses and a Tuple-Derived Summary Table

## Status

Accepted

## Context

The UX findings backlog (ADR-0359) gave every finding under `docs/ux-reviews/` a
stable id and a `**Status:**` line, with the generated `_BACKLOG.md` roll-up
proving byte-identity via a currency test. But the status vocabulary had only
three values — `open`, `fixed`, `superseded` — and two of the three closing
statuses require a commit reference as evidence.

That left no honest way to close a finding that is **not a UI defect**:

- `debug-icon-buttons-control-height` — its own text says "No action needed in
  DebugApp". 24px meets WCAG 2.5.8 (Target Size Minimum)'s 24×24px floor, so it
  is not an accessibility failure; the only real fix is raising
  `--control-h-sm` in `client/shared/tokens.css`, which changes every consumer
  at once and is explicitly out of scope (see ADR-0344).
- `repos-no-edit-capability` — `client/settings/repos-fetchers.ts:16-34`
  exposes only `addRepo`/`deleteRepo`; per-row editing needs backend update
  support that does not exist. The residue is a capability gap, not a UX
  defect.

With only commit-backed closes available, these findings would have to stay
`open` forever, and the open count would stop meaning "UI work still to do" —
the document's whole purpose. Meanwhile the summary table in
`scripts/ux-backlog-lib.ts` hardcoded three status columns in four places
(header row, separator row, per-section counts, total row) that must agree; a
mismatch produces a silently malformed markdown table, and any vocabulary
extension would have to edit all four consistently by hand.

## Decision Drivers

- **The open count must mean something**: findings closed by decision must
  leave the open list, or the backlog inflates and loses triage value.
- **Decision-closes still need evidence**: the parser requires a non-empty
  `- **Resolved:**` line for every non-`open` status; for decision-closes it
  carries a dated rationale instead of a commit hash (the parser checks
  non-emptiness only, never hash shape).
- **Acknowledged-but-blocked work must stay visible**: a `deferred` finding is
  real work that may genuinely be done later; if it appeared only as a column
  count it would effectively disappear.
- **Genuinely rejected work should not linger**: `wont-fix` findings get only a
  column count — the table plus the finding's own review document are
  sufficient record.
- **The table must not drift**: the four hardcoded column sites must be derived
  from the `STATUSES` tuple so extending the vocabulary cannot desynchronize
  them.
- **Exact-string contract**: statuses are lowercase-hyphenated
  (`wont-fix`, `deferred`); display labels are `Won't fix` (ASCII apostrophe)
  and `Deferred`; column order follows tuple order, bracketed by `Section`
  first and `Last reviewed` last.

## Considered Options

### Option 1: Add `wont-fix` and `deferred` statuses, derive the table from the tuple, list deferred findings separately (chosen)

- Widen `STATUSES` to a 5-tuple and derive `FindingStatus` from it; generate
  the invalid-status error message from `STATUSES.join(', ')` so it can never
  go stale.
- Introduce a module-level `STATUS_LABELS: Record<FindingStatus, string>` map
  and derive all four table sites (header, separator, section rows, total row)
  from `STATUSES` + `STATUS_LABELS`.
- Extract the one-line-per-finding renderer as `renderFindingLine` and reuse it
  for both the severity buckets and a new `## Deferred` section (which reads
  `_None._` when empty).
- **Pros**: open count regains meaning; deferred work stays visible; table
  drift becomes impossible; the `status !== 'open'` Resolved-line check covers
  the new statuses unchanged; parser and roll-up remain one source of truth.
- **Cons**: two more states for humans writing review docs to understand
  (mitigated by documenting them in `_TEMPLATE.md`); the checked-in
  `_BACKLOG.md` must be regenerated, which the currency test already enforces.

### Option 2: Close both findings as `fixed` or `superseded`

- **Pros**: zero parser changes.
- **Cons**: dishonest — neither finding was fixed by a commit, and nothing
  superseded them. It would teach the corpus that `Resolved` lines need not be
  truthful, undermining the evidence rule from ADR-0359.

### Option 3: Delete the two findings from their review documents

- **Pros**: open count drops with no new machinery.
- **Cons**: destroys the record of why no action was taken; a future re-review
  would re-raise the same findings. The backlog's value is precisely that
  decisions are recorded, not erased.

### Option 4: Leave both findings `open` with a note

- **Pros**: no code changes at all.
- **Cons**: the open count permanently includes non-actionable items, so "what
  UX work is left?" again requires reading every document — the exact problem
  ADR-0359 solved.

## Decision

Adopt Option 1.

1. `STATUSES` becomes `['open', 'fixed', 'superseded', 'wont-fix', 'deferred']`;
   the invalid-status error interpolates the tuple.
2. `renderBacklog` derives the summary table (header, separator, section rows,
   total) from `STATUSES` and `STATUS_LABELS`; the header sentence and severity
   buckets continue to count only `open` findings.
3. `renderFindingLine` is shared by the severity buckets and a new
   `## Deferred` section; `wont-fix` findings get no list.
4. `_TEMPLATE.md` documents both new statuses for humans.
5. `debug-icon-buttons-control-height` closes as `wont-fix` and
   `repos-no-edit-capability` closes as `deferred`, each with a dated
   `Resolved` rationale placed immediately after `Status`; `Source` and
   `Suggested fix` lines stay untouched.
6. `_BACKLOG.md` is regenerated, never hand-edited.

## Rationale

The three closing statuses now form a truthful spectrum: `fixed` (code
changed, commit named), `superseded` (replaced by later work), `wont-fix`
(examined, rejected, rationale recorded), and `deferred` (acknowledged, blocked
on work outside scope, kept visible). Deriving the table from the tuple turns a
four-way manual consistency obligation into a type-level guarantee, and
reusing `renderFindingLine` keeps the deferred list byte-consistent with the
severity buckets.

## Consequences

### Positive

- The open count again means "UI work still to do" — at implementation time it
  dropped from 11 to 9 across 18 sections with High 0 / Med 2 / Low 7.
- Future vocabulary extensions touch exactly one tuple; the error message,
  type, and all four table sites follow automatically.
- Deferred capability gaps remain discoverable in `_BACKLOG.md` instead of
  vanishing into a count.
- The test suite grew from 21 to 29 passing cases, including a
  derive-from-tuple header assertion that pins the property rather than
  today's labels.

### Negative

- Review-doc authors must now choose among five statuses; misclassification
  (e.g. `wont-fix` for genuinely deferred work) is only caught by human
  review, not the parser.
- `deferred` findings have no expiry or escalation mechanism — a long-deferred
  item stays listed indefinitely until someone revisits it.

### Risks

- The corpus may accumulate `deferred` items as a parking lot. Mitigation: the
  `## Deferred` section keeps them visible in every roll-up, and the
  `Resolved` rationale must name the blocker, making stale deferrals obvious.

## Implementation Notes

- Source: `scripts/ux-backlog-lib.ts` (`STATUSES`, `STATUS_LABELS`,
  `renderFindingLine`, `renderBacklog`, `renderDeferredSection`).
- Tests: `tests/scripts/ux-backlog.test.ts` (29 pass / 0 fail at
  implementation time); exactly two pre-existing cases were sanctioned to
  change — a title correction and the MembersSection row gaining two `0`
  columns — with no assertion loosened.
- No file under `client/` or `src/` changed; `bun run visual:audit` remained at
  467 passed / 0 failed, and `bun shoot` was never run.
- Plan: `docs/superpowers/plans/2026-08-04-ux-backlog-vocabulary.md`; design:
  `docs/superpowers/specs/2026-08-04-ux-backlog-vocabulary-design.md`.

## Related Decisions

- ADR-0359: UX Findings Backlog with Stable Ids and a Test-Gated Generated
  Roll-Up — establishes the corpus this ADR extends.
- ADR-0344: Control-Height Token Scale and WCAG Floor Ratchet — the token-scale
  work whose scope boundary motivates the DebugApp `wont-fix` close.
- ADR-0245: AI UX Review Workflow — the agent workflow that produces and
  consumes these documents.

## References

- Plan: `docs/superpowers/plans/2026-08-04-ux-backlog-vocabulary.md`
- Spec: `docs/superpowers/specs/2026-08-04-ux-backlog-vocabulary-design.md`
- Implementation: `scripts/ux-backlog-lib.ts`, `tests/scripts/ux-backlog.test.ts`
