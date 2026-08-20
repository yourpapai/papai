<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Superpowers residue cleanup

Motivation and scope: see `proposal.md`. Predecessor artifacts:
`migrate-brainstorming-to-openspec` (freeze), `legacy-corpus-porting-procedure`
(runbook), the Lane 0 drain commit `12dbd6713`.

## Context

Post-drain `docs/superpowers/` holds: README banner, 31 frozen specs, 17
notes, two living operational docs (e2e planning workflow + template, per
the banner's carve-out), and one orphaned pi extension. The workflow doc's
Realism Tiers section declares its canonical definition to be
`docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`, which
the drain moved to `docs/archive/` (paired with the tier-aware-ledger plan,
ADR-0324).

## Goals / Non-Goals

**Goals:** the tree becomes purely historical; living docs get a live home
with no dangling references; dead code leaves; the tier taxonomy keeps
exactly one canonical owner.

**Non-goals:** see proposal Non-goals — no notes/specs relocation, no
wholesale tree move, no latent-item adoption.

## Decisions

### D1 — Living docs move to `docs/operations/`

The e2e planning workflow is operational how-to guidance of the same kind
as `analytics-runbook.md` and `legacy-migration-runbook.md`; co-locating
makes the docs index honest. Template goes to
`docs/operations/templates/`. Alternatives: `docs/architecture/` (rejected —
it documents system behavior, not procedures); `tests/` (rejected — the
workflow is referenced by agents authoring OpenSpec changes, not only by
test writers; `tests/CLAUDE.md` keeps a pointer).

### D2 — Tier canon inverts to the workflow doc (user decision, option B)

ADR-0324 established "one canonical tier table owned by the spec". The
owning spec is now archived (historical). Rather than pointing canon at a
tombstone (option A) or seeding an `openspec/specs/` entry without a
triggering change — backfill, banned by the migration design's D1 (option
C) — the workflow doc's already-complete mirror table becomes the
definition. The section header changes from "Canonical definition: …" to
"This table is the canonical definition; the archived spec
(`docs/archive/2026-07-23-tier-expansion-roadmap-design.md`) is historical."
ADR-0324 is not edited (historical record); a one-line note is added to
its Status pointing here, matching the 0313/0316 annotation convention.

### D3 — Extension retired, not archived

`extensions/compact-tools.ts` is code, not a planning doc; the freeze
banner doesn't cover `extensions/`. Lane 3 retire with a commit citing
`ec6cd43df` (pi wiring removal). Archiving dead code in `docs/archive/`
would imply it was documentation.

### D4 — Latent triage is report-only in this change

The two candidates (`notes/llm-rate-limiting-and-plans.md`,
`specs/2026-05-23-chat-provider-as-plugin-design.md`) get the runbook's
code-check triage; the outcome is recorded in this change's tasks.md /
commit message. Any adoption or retirement is a separate user-gated act —
this change never deletes them.

### D5 — Hooks/validation posture

Docs-only; the TDD hook pipeline does not gate Markdown. Verification:
`openspec validate superpowers-residue-cleanup --strict`, full-text grep
for moved-path references, `bun run lint`/`format:check` via the commit
hooks.

## Risks / Trade-offs

- External (outside-repo) links to the workflow doc break → Mitigation:
  repo-internal greps cover all references we control; the file keeps its
  basename for searchability.
- Future agents read ADR-0324 and miss the inversion → Mitigation: Status
  annotation on the ADR (D2) plus the workflow doc's own canon statement.
- Tier table later drifts from reality with no spec gate → Accepted: it is
  enforced in code by `TIER_SUITE_ROOTS`/`LIVE_STORY_TIERS`
  (`tests/stories/catalog/coverage.ts`), which the doc already defers to.

## Migration Plan

1. Retire the extension (own commit).
2. Move workflow + template; rewrite the canon section (D2); fix
   `tests/CLAUDE.md`, the banner carve-out, in-doc paths.
3. Annotate ADR-0324 Status.
4. Triage the two latent items; record outcome.
5. Validate + gate.

Rollback: all text; revert the commits.

## Open Questions

None.
