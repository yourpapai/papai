<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Legacy corpus migration runbook

> Per-item procedure for porting the frozen `docs/superpowers/` corpus into
> OpenSpec, one item at a time. Rationale and freeze rules:
> `openspec/changes/archive/` → `migrate-brainstorming-to-openspec`
> (D1 strangler/no-backfill, D5 lazy-port); the banner with disposition rules
> is `docs/superpowers/README.md`. Defined by the
> `legacy-corpus-porting-procedure` change. Lane 0 tooling:
> `scripts/plan-adr-workflow.ts` (legacy-only; see its header).

## When to use this runbook

- Adopting a pending legacy design or `remaining/` brief into an OpenSpec
  change (Lane 1).
- A proposed change needs MODIFIED deltas against a capability that has no
  `openspec/specs/` entry yet (Lane 2 seed — see "Why seeds exist").
- Cleaning up the frozen tree: archiving shipped plans (Lane 0) or deleting
  dead designs (Lane 3).

Do **not** bulk-convert. One legacy item per change/commit.

## Why seeds exist (mechanics, verified 2026-08-07)

`openspec validate --strict` does **not** flag a MODIFIED delta whose target
capability has no main spec, but `openspec archive` hard-fails:

```text
demo-cap: target spec does not exist; only ADDED requirements are allowed
for new specs. MODIFIED and RENAMED operations require an existing spec.
```

So the first change that modifies a legacy-documented capability must seed
`openspec/specs/<capability>/spec.md` before it can archive (Lane 2).
Direct-write of a main spec plus `openspec validate --specs --strict` passes
and the spec accepts MODIFIED deltas immediately.

## Triage: which lane

Signals, in check order. **Reliable:** filesystem and code. **Unreliable
(measured 2026-08-07):** spec `Status:` headers (11 of 12 "pending" specs are
actually shipped), plan checkbox state (69 of 76 plans read "partial"; the old
workflow never checked boxes), `git log --grep=<slug>` (commits never cite
plan slugs).

1. **Slug match in `docs/archive/`** (strip the `YYYY-MM-DD-` prefix and any
   `-design`/`-implementation` suffix) → already processed; leave it (Lane 0
   done).
2. **`remaining/` brief exists** → partially implemented; the brief is the
   work item → Lane 1 or Lane 3.
3. **Paired plan's `Create:`/`Modify:` files exist in the repo** (sample the
   first ~6) → shipped → Lane 0.
4. **None exist** → targeted code check (codeindex `code_search` /
   `code_symbol`, grep for non-indexed files): shipped under different names
   (e.g. plugin-core-separation vs today's `plugins/`) → Lane 0; genuinely
   absent → Lane 1 if still wanted, Lane 3 if not.

When file evidence and code check disagree, code wins; when the legacy doc
and code disagree, code wins. Note the disagreement in the commit message.

## Lane 0 — archive shipped work (bulk, script-driven)

Prerequisite drain that shrinks the ambiguous corpus (~58–60 of 76 plans
verified shipped as of 2026-08-07). Not one-at-a-time.

```bash
bun scripts/plan-adr-workflow.ts --dry-run     # preview status checks
bun scripts/plan-adr-workflow.ts               # ADR + move pair to docs/archive/
```

- Run in reviewable batches; read the ADRs it writes into `docs/adr/`.
- New `remaining/` briefs it emits join the Lane 1/Lane 3 queue.
- Never point it at `openspec/changes/` (it is frozen legacy-only tooling).
- The 11 stale `Status:` headers on shipped specs stay as-is — the freeze
  rule bans new writes to the tree, and `docs/archive/` + ADRs are the truth.

## Lane 1 — adopt a pending design / brief into a change

1. Confirm the item is still wanted (user decision; this is the gate).
2. Triage per above to confirm it is genuinely pending.
3. **Drift-check:** read the legacy doc against current code. Strike sections
   already shipped or invalidated; what remains is the change scope. For
   cross-service items see "Cross-service items" below.
4. `openspec new change <slug>` — slug = filename minus date prefix and
   `-design`/`-implementation` suffix
   (`2026-06-30-readonly-exploration-sessions-design.md` →
   `readonly-exploration-sessions`).
5. Write artifacts per the porting map:

   | Legacy content                        | OpenSpec artifact                                                                                            |
   | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
   | Problem / Goal                        | `proposal.md` Why + What Changes                                                                             |
   | Non-goals / scope exclusions          | `proposal.md` Non-goals (required by project rules)                                                          |
   | Behavioral promises / contracts       | delta spec: new capability, `## Purpose` (50+ chars) + all-ADDED `### Requirement:` SHALL + `#### Scenario:` |
   | Architecture, options, trade-offs     | `design.md` Decisions (apply project rules: scope-model impact, drizzle migration/backfill, TDD order)       |
   | Plan task lists                       | `tasks.md`, test-first order, verification command per task, final full-gate task                            |
   | Validation matrices / status evidence | drop — historical, not change content                                                                        |

6. `openspec validate <slug> --strict`.
7. **Delete the legacy file(s)** (spec and/or plan, and the `remaining/`
   brief if adopting one) **in the same commit** as the change artifacts
   (delete-on-adopt, per the freeze rules).
8. Grep for references to the deleted path (`grep -rn "<filename>" --include="*.md"
--include="*.ts" .`) and update pointers.

## Lane 2 — seed a capability spec on first touch

Trigger: drafting a change whose proposal names a Modified Capability with no
`openspec/specs/` entry.

1. Gather sources in truth order: **code > `docs/adr/` > `docs/archive/`
   pair > legacy spec** (stalest).
2. Write `openspec/specs/<capability>/spec.md` describing **current
   behavior**: `# <capability> Specification`, `## Purpose`, then
   `## Requirements` with `### Requirement:` SHALL statements, each with at
   least one `#### Scenario:` WHEN/THEN.
3. Add a provenance line at the top:

   ```markdown
   <!-- seeded from docs/superpowers/specs/<file> (+ docs/archive/<pair>, docs/adr/<nnnn>) on <date> -->
   ```

   Seeds are auditable later via `grep -r "seeded from" openspec/specs/`.

4. `openspec validate --specs --strict`.
5. Land the seed as its own commit/PR; cite it in the triggering change's
   proposal. Then write MODIFIED deltas against it as normal.
6. The legacy source file stays (freeze rule: historical detail).

A seed describes what **is**, never what the legacy doc aspired to.

## Lane 3 — retire a dead design

1. Confirm unwanted or superseded (user decision; cite what superseded it).
2. Delete the file with a commit message stating why
   (`docs(legacy): retire <slug> — superseded by <x>`). No tombstone file.

## Cross-service items

Some legacy designs span papai + an external service (e.g.
`readonly-exploration-sessions` spans papai + **magi**, which lives outside
this repo). When adopting one, the change's `design.md` must list the
external-side work explicitly — it cannot ride this repo's PR and needs its
own execution path.

## Queue inventory (snapshot 2026-08-07)

Starter dispositions; each item still gets the triage pass above.

| Item                                                             | State                                      | Starter disposition                         |
| ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| ~~`specs/2026-06-30-readonly-exploration-sessions-design.md`~~   | verified shipped in magi 2026-08-09 (auto-finish.ts, answer milestone, last_message) → archived | done |
| `plans/2026-08-04-knip-facade-import-triage.md`                  | pending, plan-only, unstarted              | Lane 1 or Lane 3                            |
| ~~`remaining/2025-03-24-prompt-injection-defense.md`~~           | adopted 2026-08-09 → `openspec/changes/prompt-injection-defense/` | done                                      |
| `remaining/2026-03-20-phase-09-event-driven-suggestions.md`      | brief                                      | Lane 1 (residual) or Lane 3                 |
| `remaining/2026-03-20-phase-10-notification-controls.md`         | brief                                      | Lane 1 (residual) or Lane 3                 |
| `remaining/2026-03-30-plugin-system-implementation.md`           | brief, MVP shipped ("true follow-ups")     | Lane 1 per follow-up or Lane 3              |
| ~~`remaining/2026-04-04-db-foreign-keys-orphan-prevention.md`~~  | adopted 2026-08-09 → `openspec/changes/db-foreign-keys-orphan-prevention/` | done                      |
| `plans/2026-03-22-preprocessing-classifier-implementation.md`    | no `src/classifier*`                       | Lane 3 likely; verify first                 |
| `plans/2026-03-22-test-improvement-roadmap.md`                   | old, unverified                            | triage; Lane 0 or 3                         |
| `plans/2026-03-26-layered-architecture-violations-fix.md`        | no created files                           | triage; Lane 0 or 3                         |
| `plans/2026-04-03-deep-thinking-tool-research.md`                | research plan, no created files            | triage; Lane 0 or 3                         |
| ~~`plans/2026-04-08-user-profile-memory.md`~~                    | re-proposed 2026-08-09 → `openspec/changes/user-profile-memory/`  | done                                      |
| `plans/2026-04-11-audio-message-transcription-implementation.md` | 11/60 boxes, no `src/stt`                  | triage; Lane 1 or 3                         |
| `plans/2026-04-17-calendar-sync-implementation.md`               | docs-only commits, no code                 | Lane 3 likely; verify first                 |
| ~~`plans/2026-04-26-telemetry-metrics.md`~~                      | adopted 2026-08-09 → `openspec/changes/telemetry-metrics/`        | done                                      |
| `plans/2026-07-08-plugin-core-separation-phase-0-1-*.md`         | shipped under different shape (`plugins/`) | Lane 0                                      |
| `plans/2026-07-23-alert-polling-optimization.md`                 | partial file evidence (2/3)                | triage; Lane 0 with brief, or Lane 1        |
| `plans/2026-08-02-history-mutation-coverage.md`                  | partial file evidence (1/2)                | triage; Lane 0 with brief, or Lane 1        |
| All other `plans/` (~58–60)                                      | shipped, file-verified                     | Lane 0 bulk drain                           |
| All other `specs/` (~80 shipped + 11 stale-header)               | shipped                                    | frozen; Lane 2 seeds lazily, never backfill |
| `notes/` (17)                                                    | brainstorm notes / divergence reports      | never migrate                               |

## Verification

- Change artifacts: `openspec validate <slug> --strict`.
- Seeded specs: `openspec validate --specs --strict`.
- After any adoption deletion: grep for the old path; no dangling references.
