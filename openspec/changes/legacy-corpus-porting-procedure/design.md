<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Legacy corpus porting procedure

Motivation and scope: see `proposal.md`. Predecessor rationale:
`migrate-brainstorming-to-openspec` (D1 strangler/no-backfill, D5 lazy-port
bullet). This design turns that bullet into an operational runbook.

## Context

Measured corpus state (2026-08-07, this branch):

```text
docs/superpowers/plans/   76 ─┬─ ~58–60 shipped (file-verified) → Lane 0
                              ├─ 2 genuinely pending            → Lane 1
                              ├─ 5 remaining/ briefs            → Lane 1 or 3
                              └─ ~8 murky (2025-03→2026-04)     → mostly Lane 3
docs/superpowers/specs/   92 ─┬─ ~80 shipped → frozen forever (Lane 2 may
                              │    seed from them lazily)
                              ├─ 11 stale "pending" headers on shipped work
                              │    (do not edit; historical detail)
                              └─ 1 genuinely pending (readonly-exploration-
                                 sessions; cross-service papai + magi)
docs/superpowers/notes/   17 ─── never migrate
```

Verified OpenSpec mechanics (sandbox, installed CLI): `validate --strict`
passes a MODIFIED delta against a nonexistent main spec, but `archive`
hard-fails ("only ADDED requirements are allowed for new specs"). Direct-write
of `openspec/specs/<cap>/spec.md` plus `openspec validate --specs --strict`
passes and the spec immediately accepts MODIFIED deltas.

Unreliable status signals (measured): spec `Status:` headers (11/12 stale),
plan checkbox state (69/76 "partial", boxes never checked), git-log slug grep
(~0 hits — commits never cite plan slugs). Reliable signal: existence of the
plan's `Create:`/`Modify:` files.

## Goals / Non-Goals

**Goals:**

- One authoritative runbook an agent or human can execute per legacy item
  without re-deriving triage, lane choice, porting map, or validation steps.
- Lane 2 unblocks first-touch changes: a seeded capability spec accepts
  MODIFIED deltas at archive time.
- Queue inventory small enough to be honest: ~7–15 one-at-a-time items after
  the Lane 0 drain, not 170 raw files.

**Non-Goals:**

- Performing any migration, drain, seed, or retirement in this change.
- Scripting the porting itself (translation needs judgment; only triage
  signals are mechanical).
- Changing the freeze rules; the runbook operationalizes them.

## Decisions

### D1 — Runbook lives at `docs/operations/legacy-migration-runbook.md`

Fits the existing operations-runbook pattern (`analytics-runbook.md`).
Alternatives considered: expand `docs/superpowers/README.md` (too small for
step-by-step porting maps; README stays the freeze banner and gains a
pointer); a repo skill (`.agents/skills/`) — rejected, procedure is
human+agent operational documentation, not a session-discipline override;
embedding in this change's design.md à la D2 of the predecessor — rejected,
that suited a one-time migration, while this procedure is ongoing and must be
discoverable after this change archives.

### D2 — Four disposition lanes, triage per item

```text
item → triage → Lane 0 archive │ Lane 1 adopt │ Lane 2 seed │ Lane 3 retire
```

- **Lane 0 (archive):** shipped plan/spec → `plan-adr-workflow` writes the ADR
  and moves the pair to `docs/archive/`. Bulk, script-driven; the drain is
  the prerequisite that shrinks the ambiguous corpus by ~80%.
- **Lane 1 (adopt):** pending design / remaining brief still wanted →
  `openspec new change <slug>` (date prefix stripped), port content per the
  runbook's mapping table (Problem/Goal → proposal Why; non-goals → proposal
  Non-goals; behavioral promises → all-ADDED delta requirements with SHALL +
  `#### Scenario:`; decisions → design.md; plan steps → test-first tasks.md
  with per-task verification commands), drift-check against code first,
  `openspec validate <name> --strict`, then **delete the legacy file(s) in the
  same commit** (D5 of predecessor, kept per user decision).
- **Lane 2 (seed):** first-touch prerequisite. When a proposed change names a
  Modified Capability with no `openspec/specs/` entry, seed it first:
  direct-write the main spec as **current truth** (source order: code > ADRs
  > docs/archive pair > legacy spec), Purpose + Requirements, add a
  > `<!-- seeded from docs/superpowers/specs/<file> on <date> -->` provenance
  > line (greppable), `openspec validate --specs --strict`, land as its own
  > commit cited in the triggering change's proposal. Alternative considered:
  > a `seed-<cap>` change with all-ADDED delta → archive — rejected: a seed
  > describes no behavior _change_, so delta machinery adds ceremony without
  > review value; the direct commit/PR is the review surface.
- **Lane 3 (retire):** pending but no longer wanted / superseded → delete
  with a commit note; no tombstone file.

### D3 — Triage uses file-existence, not declared status

The runbook's triage step checks, in order: membership in `docs/archive/`
(slug match, date prefix stripped) → `remaining/` brief existence → paired
plan's `Create:`/`Modify:` file existence → targeted code check
(codeindex/grep). Status headers and checkboxes are explicitly documented as
noise. Alternative considered: a `legacy-triage` script emitting a queue
report — deferred as optional; the runbook lists the measured inventory so
the queue is known without tooling.

### D4 — Cross-service items carry an external-work note

`readonly-exploration-sessions` (the one genuinely pending approved spec)
spans papai + magi; magi lives outside this repo. Lane 1 porting of such
items must state the external-side work explicitly in the change's design.md.

### D5 — Hook/TDD and validation posture

All outputs are Markdown; the Write/Edit TDD hook pipeline gates `src/` and
`client/` only, so no test-first ordering applies inside this change.
Verification is `openspec validate legacy-corpus-porting-procedure --strict`
plus the standard final gate (`bun test`, `bun run typecheck`,
`bun run lint`). No capability/tool-prefs gating impact, no scope-model
impact (nothing persisted), no drizzle migration, no new dependency.

## Risks / Trade-offs

- File-existence triage is a proxy; renamed-but-shipped plans (e.g.
  `plugin-core-separation` vs today's `plugins/`) read as unshipped →
  Mitigation: runbook's murky-bucket step requires a human/agent code check
  before Lane 3; when in doubt, retire conservatively via Lane 0 ADR.
- Direct-write seeds bypass proposal review → Mitigation: seed lands as its
  own commit/PR, cited from the triggering change's proposal; provenance line
  makes seeds auditable (`grep -r "seeded from" openspec/specs/`).
- Runbook rots as the queue drains → Accepted: inventory section is a
  snapshot dated 2026-08-07; lanes and procedures are the durable content.
- Two doc homes for porting rules (README banner vs runbook) → Mitigation:
  README keeps the three disposition bullets and defers detail to the
  runbook; ambiguity resolves to the runbook.

## Migration Plan

1. Write the runbook (lanes, triage signals, porting maps, queue inventory,
   validation commands).
2. Point `docs/superpowers/README.md` disposition rules at the runbook.
3. Add the runbook to `CLAUDE.md`'s documentation index.
4. Add a pointer in `docs/architecture/openspec-superpowers-hybrid.md` next
   to the archived-migration reference.
5. Validate + final gate.

Rollback: all text; revert the commits.

## Open Questions

None.
