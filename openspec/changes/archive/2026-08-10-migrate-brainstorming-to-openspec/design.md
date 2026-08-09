<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Migrate brainstorming → OpenSpec

This is the operational migration guide. Motivation and scope: see
`proposal.md`. Decision research: `docs/architecture/openspec-superpowers-hybrid.md`
(§4 is superseded by this document).

## Context

The scaffold landed (`openspec/config.yaml` with papai-tailored rules,
`openspec-*` skills in `.claude/skills/` + `.agents/skills/` +
`.opencode/skills/`, `opsx` commands in `.claude/commands/opsx/` +
`.opencode/commands/`), but no entry point was rewired. Current state:

```text
STILL ROUTING TO THE OLD FLOW
═══════════════════════════════════════════════════════════════════
CLAUDE.md "Pi Workflow" ──────────► brainstorming gates all creative work
syncing-plan-with-code (×2 copies) ► syncs docs/superpowers/plans/
designing-new-provider (×2 copies) ► embeds brainstorming → writing-plans
tests/CLAUDE.md ──────────────────► e2e workflow + template under
                                     docs/superpowers/
mutation-improve/ ────────────────► diff-guard allows docs/superpowers/;
                                     prompt templates GENERATE spec+plan
                                     docs into docs/superpowers/
scripts/plan-adr-workflow*.ts ─────► walks legacy plans/, writes
                                     remaining/ briefs + ADRs from the
                                     legacy corpus
scripts/tool-surface-benchmark.ts ─► default output writes NEW files
                                     into docs/superpowers/plans/
review-loop/ ──────────────────────► plan-path-agnostic (--plan <file>);
                                     no legacy coupling

DELIBERATE LEGACY (audited, no action)
═══════════════════════════════════════════════════════════════════
ux-review skill, .hooks/, .opencode/plugins/ — clean of legacy refs
tsconfig.json excludes docs/superpowers/extensions — stays valid
code/test comments citing docs/superpowers/specs/* (bootstrap.ts,
  knip.config.ts, several tests) — historical citations, covered by
  the freeze banner

LEGACY CORPUS (frozen by this change, strangler — no backfill)
═══════════════════════════════════════════════════════════════════
docs/superpowers/specs/     92 design docs (mostly shipped, some pending)
docs/superpowers/plans/     76 plans
docs/superpowers/notes/     17 brainstorm notes / divergence reports
docs/superpowers/remaining/  5 not_implemented briefs
docs/archive/ + docs/adr/   shipped design+plan pairs with ADRs — already
                            the historical record; untouched
```

## Goals / Non-Goals

**Goals:**

- One routing source of truth: `CLAUDE.md` sends code-behavior work to
  `/opsx:explore` / `/opsx:propose`, keeps superpowers skills only where they
  don't conflict (TDD, verification, code review, debugging, branch finish).
- Every pointer that generates or edits old-format artifacts is retargeted or
  explicitly frozen.
- `mutation-improve` keeps working with `openspec/changes/` as its artifact
  home.
- The migration itself validates the explore → propose → apply → archive loop
  (dogfood).

**Non-Goals:**

- No runtime behavior change: no tool-surface/capability/tool-prefs gating
  impact, no scope-model impact (no new persisted state keyed by any context
  id), no DB change, no new dependency. Nothing under `src/`, `client/`,
  `plugins/` is touched.
- No legacy-corpus backfill, no lazy ports performed in this change.
- No global skill edits (`~/.claude/skills/` stays vanilla).

## Decisions

### D1 — Strangler, no backfill

`openspec/specs/` starts empty and accretes from future changes. The legacy
corpus stays in place as read-only reference; ADRs + `docs/archive/` remain
truth for shipped work. Alternatives considered: curated backfill from
ADR-backed capabilities (weeks of conversion effort for specs whose behavior
is already encoded in code and ADRs), full backfill (same, worse). Both were
rejected: delta specs earn their keep on _future_ changes, not as archaeology.

### D2 — The migration guide is this change's `design.md` (dogfood)

The guide lives inside the first OpenSpec change instead of a standalone
`docs/` page, so the migration validates the new loop end to end. After
archive, the guide survives at
`openspec/changes/archive/<date>-migrate-brainstorming-to-openspec/design.md`,
and `openspec-superpowers-hybrid.md` §4 is replaced with a pointer to it.
Alternative considered: a standalone `docs/architecture/sdd-migration-guide.md`
— rejected because it would document the new workflow while bypassing it.

### D3 — `skip_specs: true`

This change alters no papai system behavior (docs, agent instructions, dev
tooling only), so per the spec-driven schema rules it opts out of delta specs
rather than inventing requirements.

### D4 — CLAUDE.md routing table replaces "Pi Workflow"

Repo instructions override global skills (using-superpowers' own precedence
rule), so the override is scoped to this repo and other projects keep vanilla
superpowers. The table from the hybrid doc §3 lands verbatim in spirit:

| Trigger                                         | Route                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| "Let's build / add / change X" (code behavior)  | `/opsx:explore` or `/opsx:propose` — **not** brainstorming            |
| Non-code creative work (docs, process, writing) | brainstorming (unchanged)                                             |
| Bug / test failure                              | systematic-debugging; if root cause becomes a change, `/opsx:propose` |
| Inside `/opsx:apply`                            | test-driven-development, verification-before-completion               |
| Plan drifted from code                          | syncing-plan-with-code against `openspec/changes/<name>/` artifacts   |

### D5 — Legacy corpus frozen in place, ported lazily

Nothing is moved or deleted. A `docs/superpowers/README.md` banner marks the
tree frozen and states disposition rules:

- _Adopting a `remaining/` brief or pending design_ → `/opsx:propose` a change
  and port its content into `proposal.md` / `design.md` / `tasks.md`; then
  delete the stale legacy file in the same commit.
- _Referencing shipped behavior_ → read ADRs and `docs/archive/`; read
  `docs/superpowers/specs/` only as historical detail.
- _No new files_ under `docs/superpowers/` except the e2e workflow's own
  maintenance (D8).

### D6 — mutation-improve retargets to `openspec/changes/`

`mutation-improve/src/diff-guard.ts` `ALLOWED_PREFIXES` becomes `['tests/',
'openspec/changes/']`, and `prompt-templates.ts` writes its per-run
spec/plan artifacts under `openspec/changes/<run-change-name>/` instead of
`docs/superpowers/{specs,plans}/`. `mutation-improve/CLAUDE.md` gate
description follows. These are workspace-local code edits done test-first
(workspace TDD rules; the repo Write/Edit hook pipeline gates `src/` and
`client/`, markdown is ungated).

### D7 — Sub-workspaces share the root `openspec/` tree

`review-loop/` and `mutation-improve/` do not get their own trees; their
changes live in the root `openspec/changes/` like everything else. Revisit
only if artifact ownership friction appears.

### D8 — E2E planning docs stay, language retargeted

`docs/superpowers/e2e-planning-workflow.md` and `templates/` remain where they
are (load-bearing: `tests/CLAUDE.md` points at them); only their
artifact-home language is updated so new e2e plans land in
`openspec/changes/<name>/` artifacts instead of `docs/superpowers/plans/`.

### D9 — Duplicate skill copies updated in lockstep

Each custom skill exists as two identical files (`.claude/skills/<name>/` and
`.agents/skills/<name>/`). Both copies are edited identically in the same
commit to prevent drift.

### D10 — plan-adr-workflow frozen as legacy-only tooling

`scripts/plan-adr-workflow*.ts` (and the `plan-adr-workflow` package script)
automated the old pipeline's tail: walk `docs/superpowers/plans/`, check
implementation status, write ADRs via the architecture-decision-records
skill, archive plan+spec to `docs/archive/`, and emit `remaining/` briefs.
With the corpus frozen, its input set never grows. It stays in place,
header-marked as legacy-only, for processing the residual legacy corpus; its
`remaining/` outputs are an explicit carve-out in the freeze rule. For new
work the flow is: openspec archive handles change/spec bookkeeping, and ADRs
(when wanted) are written manually via the architecture-decision-records
skill against the change's artifacts. `docs/archive/` stops receiving new
design+plan pairs — the openspec archive replaces them. Alternative
considered: retiring the script now — rejected, deleting a working tool over
76 unprocessed legacy plans is destructive; retirement can be its own change
later.

### D11 — tool-surface-benchmark output leaves the legacy tree

`scripts/tool-surface-benchmark.ts` defaults its results file to
`docs/superpowers/plans/tool-surface-benchmark-results.md` — a live write of
new files into the frozen tree. The default moves to
`docs/research/tool-surface-benchmark-results.md` (results are analysis, not
plans), updated test-first with `tests/scripts/tool-surface-benchmark.test.ts`.

### D12 — review-loop is plan-format-agnostic; note, don't touch

`review-loop` resolves `--plan` against the repo root and reviews code
against whatever file it is handed; nothing in `review-loop/src/` references
the legacy tree, and `openspec/changes/<name>/tasks.md` uses the same `- [ ]`
checkbox convention the loop already parses. The only change is a usage note
in `review-loop/CLAUDE.md`: point `--plan` at the change's `tasks.md`.

## Risks / Trade-offs

- Two doc universes coexist indefinitely (`docs/superpowers/` legacy vs
  `openspec/`) → Mitigation: freeze banner (D5), routing table (D4), and no
  new writes to the legacy tree; ambiguity resolves to "openspec wins".
- Agent habit regression: global superpowers skills still push brainstorming →
  writing-plans for code work → Mitigation: `CLAUDE.md` is loaded every
  session and outranks global skills; repo-local retargeted skills remove the
  conflicting in-repo references.
- In-flight `mutation-improve` runs mid-migration still write to
  `docs/superpowers/` → Low impact (dev tooling); finish or discard in-flight
  runs before D6 lands.
- `plan-adr-workflow` writes `remaining/` briefs into the frozen tree →
  Accepted: explicit carve-out in the freeze rule (D10); no other new writes
  are permitted.
- `openspec-superpowers-hybrid.md` §4 goes stale the moment this design lands
  → Mitigation: §4 is replaced by a pointer in this change's final docs task.
- Rollback: everything here is git-tracked text; revert the commits. No data
  migration, no runtime surface, so rollback is trivial at any point.

## Migration Plan

Ordered execution steps; each maps to a verifiable task in `tasks.md`:

1. **Rewire `CLAUDE.md`.** Replace the "Pi Workflow" section with the D4
   routing table; keep every other skill reference.
2. **Retarget `syncing-plan-with-code`** (both copies): plan paths become
   `openspec/changes/<name>/` artifacts; drift sync = `/opsx:update`;
   follow-up plans become follow-up changes.
3. **Retarget `designing-new-provider`** (both copies): brainstorming step
   becomes `/opsx:explore`, spec/plan outputs become a proposed change's
   artifacts.
4. **Retarget `mutation-improve`** (TDD, in-workspace): failing tests for
   diff-guard prefixes and prompt-template paths first, then implementation;
   update `mutation-improve/CLAUDE.md` gate text.
5. **Retarget legacy-coupled scripts** (D10, D11): move the
   tool-surface-benchmark default output test-first; header-mark
   `plan-adr-workflow.ts` as legacy-only.
6. **Note review-loop usage** (D12): `--plan` points at a change's
   `tasks.md`; no code change.
7. **Retarget e2e pointers.** Update `tests/CLAUDE.md` and
   `docs/superpowers/e2e-planning-workflow.md` + template header so new e2e
   work lands in `openspec/changes/`.
8. **Freeze the legacy tree.** Add `docs/superpowers/README.md` with the D5
   disposition rules and the D10 carve-out.
9. **Supersede hybrid doc §4** with a pointer to this design.
10. **Final sweep.** Grep for `docs/superpowers` and `brainstorming` in
    `.claude/`, `.agents/`, `scripts/`, `package.json`, `*.md` instruction
    surfaces; every hit is either retargeted, banner-covered legacy, or a
    deliberate historical reference.
11. **Shakedown (after this change archives).** Run the next real feature
    through explore → propose → apply → archive; tune `openspec/config.yaml`
    rules from what is observed.

Ongoing: `openspec update` after upgrading the package; treat
`openspec/specs/` as review-required PR surface once it has content.

## Open Questions

- Enable the expanded profile (`/opsx:verify`, `/opsx:onboard`) or keep
  verification in superpowers skills? Defer until after the shakedown change.
- Fork a `papai-sdd` schema (e.g. a `ux-review` artifact gated on `client/`
  changes)? Defer until 2–3 changes of experience with the default schema.
