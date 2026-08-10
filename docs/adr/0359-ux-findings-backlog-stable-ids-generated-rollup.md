<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0359: UX Findings Backlog with Stable Ids and a Test-Gated Generated Roll-Up

## Status

Accepted

## Context

The UX review corpus under `docs/ux-reviews/` had grown to 18 review documents
holding 159 findings (35 High, 67 Med, 60 Low), but the findings were
unverifiable prose:

- Findings had no identity. A heading was the only handle, so a reworded title
  or a reordered document silently orphaned any external reference to a
  finding, and there was no way to answer "did finding X get fixed?"
- Findings had no status. Whether a finding still reproduced was tribal
  knowledge; guesses about what "looks fixed" had repeatedly been wrong because
  fixes landed in shared primitives (`Btn`, `Field`, `Input`) that a section's
  own source never mentions.
- There was no roll-up. "What UX work is left?" required reading 18 documents
  and keeping a mental tally.
- Re-reviews were unconstrained. Without a procedure, a re-verification pass
  could drift into editing components or silently deleting findings.

The corpus is produced and consumed by agents running the `ux-review` skill
(ADR-0245), so whatever record shape was chosen had to be
machine-parseable and mechanically enforceable, not a convention enforced by
review alone.

## Decision Drivers

- **Findings need durable identity**: a reworded heading must never orphan an
  id, and an id must never be reused.
- **Statuses need evidence**: `open` is the claim that needs no evidence; every
  closed status must name the commit or sub-project that resolved it.
- **The roll-up must not drift**: a checked-in generated file is only
  trustworthy if a test proves it byte-identical to a fresh regeneration.
- **Parse failures must be loud**: a malformed record throws naming the file
  and heading; the parser never skips. Otherwise documents rot quietly.
- **License-header byte-identity**: `_BACKLOG.md` is both generated and
  license-stamped; if the generator and the stamper disagree by one byte they
  rewrite each other forever.
- **No component edits during review**: re-reviews may touch stories and
  `tests/visual/**` only; the visual baseline floor (458 passed / 0 failed at
  decision time) is the regression gate, and re-shooting existing baselines
  turns that gate into a tautology.

## Considered Options

### Option 1: Hand-assigned ids + status field + generated roll-up with a currency test (chosen)

- Every finding gains `**Id:**` (kebab-case, section-prefixed, assigned by
  hand, never derived from the heading, never reused) and `**Status:**` as its
  first two bullets. Closed statuses require a `**Resolved:**` line.
- A pure library (`scripts/ux-backlog-lib.ts`) parses review documents and
  renders the roll-up; a thin CLI (`scripts/ux-backlog.ts`) wires it to the
  filesystem behind `bun run ux:backlog`.
- `tests/scripts/ux-backlog.test.ts` regenerates the roll-up in memory and
  asserts byte-identity with the checked-in `_BACKLOG.md`, plus pins the
  license-header literals against the stamper's source.
- The `ux-review` skill is updated so new reviews emit the record shape and a
  documented re-review procedure walks findings by id.
- **Pros**: single source of truth stays in the review documents; the roll-up
  is regenerable and provably current; malformed input fails the test suite
  with a named culprit; no new runtime dependencies.
- **Cons**: hand-assigned ids rely on author discipline; the currency test
  couples the test suite to the docs directory.

### Option 2: Derive ids from heading text

Hash or slugify each heading into its id automatically.

- **Pros**: zero authoring discipline needed; ids are free.
- **Cons**: a heading reworded for clarity orphans the id and breaks every
  reference; two similar headings can collide. Rejected: the id must name the
  *defect* (`members-delete-no-confirm`), not the prose describing it.

### Option 3: Keep the backlog as the hand-edited source of truth

Maintain `_BACKLOG.md` by hand and let review documents stay free-form.

- **Pros**: no parser needed.
- **Cons**: two places to update guarantees drift; nothing forces statuses to
  carry evidence; "what's left" depends on the last editor's diligence.
  Rejected: the direction of generation must be documents → roll-up, enforced
  by a test.

### Option 4: Track findings in an external tracker (Kaneo/YouTrack issues)

File each UX finding as a tracker issue and link from the documents.

- **Pros**: real workflow states, assignees, notifications.
- **Cons**: the corpus stops being self-contained in the repo; the agent-driven
  review loop would need tracker credentials and round-trips; issue lifetime is
  decoupled from the document lifetime that defines it. Rejected: findings are
  review artifacts and belong next to the reviews.

## Decision

Adopt Option 1:

1. **Record shape**: each finding is `- **Id:**` and `- **Status:**` as the
   first two bullets, then the existing fields. Statuses are `open`, `fixed`,
   `superseded`; the latter two require a `**Resolved:**` line naming the
   commit or sub-project. There is no `partial` — a partially-fixed finding
   stays `open` with its text narrowed to the residue, keeping its id.
2. **Parser is strict**: every malformed record throws, naming the file and
   heading (`missing Id`, duplicate id within or across documents, unknown
   status/severity, closed status without `Resolved:`, missing header date).
3. **Generation is gated**: `bun run ux:backlog` regenerates
   `docs/ux-reviews/_BACKLOG.md`; a currency test asserts the checked-in file
   equals a fresh in-memory regeneration, and a drift guard pins the
   license-header literals the generator and the stamper share.
4. **Review documents only**: `_TEMPLATE.md`, `RUBRIC.md`, and every
   underscore-prefixed file are never parsed; `isReviewDocument` is exported so
   the test reuses the exact directory filter rather than a drifting copy.
5. **The skill teaches the shape**: `.claude/skills/ux-review/SKILL.md`
   documents the fields and a re-review procedure (walk findings by id, read
   shared primitives not just the section's own file, re-score all nine
   dimensions, never delete a finding, regenerate and commit).

## Rationale

- Documents-as-source-of-truth keeps the corpus diffable, reviewable, and
  agent-writable with no external service; the generated roll-up is a pure
  function of committed files.
- The strict parser converts format rot into an immediate, named test failure
  instead of a silently shrinking roll-up.
- The currency test plus the license-header drift guard remove the two classic
  failure modes of checked-in generated files: staleness and generator/stamper
  disagreement.
- Hand-assigned ids cost a sentence of author discipline and buy permanence
  that derived ids cannot provide.

## Consequences

### Positive

- Every finding is addressable by a stable id; re-reviews walk ids, so nothing
  is lost when headings change.
- `_BACKLOG.md` answers "what UX work is left?" in one read: summary table per
  section plus severity-bucketed open findings with source anchors.
- Any edit to a review document without regenerating fails CI
  (`bun test tests/scripts/ux-backlog.test.ts`), so the roll-up cannot go
  stale unnoticed.
- The backfill pass itself was the first verification: assigning statuses
  forced re-reviewing all sections instead of guessing.

### Negative

- Authors must invent and never reuse ids; the parser enforces uniqueness but
  not meaningfulness.
- The currency test couples the unit-test suite to the docs tree; a malformed
  document anywhere fails the whole file.
- Closed findings stay in the documents forever (by design), so documents grow
  monotonically.

### Risks

- The id vocabulary could drift from the defect-naming convention, producing
  ids as opaque as headings.
  Mitigation: the template and skill both state the rule and show examples.
- New status values (the vocabulary later grew to include `wont-fix` and
  `deferred`, and a 19th section, `PluginsSection`, was added) change the
  roll-up schema and the parser together.
  Mitigation: statuses are a single `as const` tuple in
  `scripts/ux-backlog-lib.ts:7`; the currency test forces documents, parser,
  and roll-up to move in lockstep.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-02-ux-findings-backlog.md`; design
  spec: `docs/superpowers/specs/2026-08-02-ux-findings-backlog-design.md`.
- Key files: `scripts/ux-backlog-lib.ts` (pure parse/render),
  `scripts/ux-backlog.ts` (CLI), `tests/scripts/ux-backlog.test.ts` (parser
  errors, render determinism, currency, header byte-identity),
  `docs/ux-reviews/_BACKLOG.md` (generated), `docs/ux-reviews/_TEMPLATE.md`
  (record shape for new reviews), `.claude/skills/ux-review/SKILL.md`
  (re-review procedure); `package.json` script `ux:backlog`.
- Deliberate evolution during execution: the status vocabulary was extended
  from 3 to 5 values (`wont-fix`, `deferred`) with a matching Deferred section
  in the roll-up, and the corpus grew from 18 to 19 review documents — both
  absorbed by the same strict-parser + currency-test mechanism without
  weakening any gate.

## Related Decisions

- ADR-0245: AI UX review workflow — defines the review process whose findings
  this backlog makes addressable.
- ADR-0248 and successors (the per-section UX-fix ADRs) — the fix waves that
  closed most findings; their sub-project ids appear in `**Resolved:**` lines.

## References

- `docs/superpowers/specs/2026-08-02-ux-findings-backlog-design.md`
- `docs/superpowers/plans/2026-08-02-ux-findings-backlog.md`
- `docs/ux-reviews/_BACKLOG.md` (generated roll-up)
