<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# OpenSpec × Superpowers hybrid workflow

Research summary, proposed workflow, and migration guide for adopting
[Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) in papai while
keeping the `obra/superpowers` skills that do not conflict with it.

## 1. What OpenSpec is

Spec-driven development (SDD) layer for AI coding assistants, in two halves:

- **CLI** (`npm i -g @fission-ai/openspec`, Node ≥ 20.19): scaffolds/validates
  the `openspec/` tree, serves structured JSON to the agent
  (`openspec status --change X --json`, `openspec instructions <artifact>
  --json`), merges delta specs on archive, dashboard via `openspec view`.
- **Generated skills/commands**: `openspec init` writes
  `.claude/skills/openspec-*/SKILL.md`, `.opencode/skills/openspec-*/` +
  `.opencode/commands/opsx-*.md` (native opencode support), or `.agents/skills/`
  for the shared target. The agent drives the workflow; the CLI is the engine.

Directory model:

```text
openspec/
├── specs/            # living source of truth, per capability
├── changes/          # in-flight changes: proposal.md, specs/ (deltas), design.md, tasks.md
│   └── archive/      # completed, date-prefixed
├── schemas/          # optional custom artifact graphs
└── config.yaml       # project context + per-artifact rules injected into prompts
```

Delta specs use `## ADDED/MODIFIED/REMOVED Requirements` with
`### Requirement:` SHALL statements and `#### Scenario:` WHEN/THEN blocks.
Archive merges deltas into `openspec/specs/`.

Core command loop (default `core` profile, typed in chat, not terminal):

```text
/opsx:explore → /opsx:propose → /opsx:apply → /opsx:archive
                 ↑ /opsx:update revises artifacts anytime; /opsx:sync merges deltas
```

Expanded profile adds `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`,
`/opsx:bulk-archive`, `/opsx:onboard` (enable via `openspec config profile` +
`openspec update`).

Key properties vs. ad-hoc planning: artifacts are filesystem state (no phase
gates, any action anytime), delta specs are validated by the CLI, main specs
survive the change as durable truth, and schemas/templates are forkable
(`openspec schema fork spec-driven my-workflow`).

## 2. Conflict analysis with superpowers

| Superpowers skill | OpenSpec equivalent | Verdict |
|---|---|---|
| `brainstorming` | `/opsx:explore` + `/opsx:propose` | **Direct conflict.** Both gate creative work behind a Q&A → design → approval flow. brainstorming writes `docs/superpowers/specs/YYYY-MM-DD-*-design.md` then hands to `writing-plans`; OpenSpec writes `changes/<name>/{proposal,specs,design,tasks}.md`. |
| `writing-plans` | `design.md` + `tasks.md` artifacts | **Conflict.** tasks.md is the implementation checklist, CLI-tracked with checkboxes. |
| `executing-plans`, `subagent-driven-development` | `/opsx:apply` | Partial overlap. `/opsx:apply` drives tasks.md; superpowers adds review checkpoints and TDD discipline OpenSpec lacks. |
| `test-driven-development` | — | **Keep.** OpenSpec has no TDD opinion; papai hooks enforce it. |
| `verification-before-completion` | `/opsx:verify` (expanded) | Keep both: verify checks spec↔code coherence; the skill enforces evidence-before-claims. |
| `systematic-debugging` | `/opsx:explore` (mid-bug) | Keep skill; explore can front a bugfix change. |
| `requesting-/receiving-code-review` | — | **Keep.** No OpenSpec equivalent. |
| `finishing-a-development-branch` | `/opsx:archive` | Complementary: archive = spec bookkeeping; branch skill = merge/PR decision. |

Why OpenSpec should win the front of the pipeline: brainstorming produces
single-file design docs that go stale; OpenSpec keeps a validated, delta-based,
living spec tree the agent re-reads on every change, plus CLI state queries any
tool can consume. brainstorming's real value is its *dialogue discipline*
(one question at a time, 2–3 approaches with trade-offs, incremental approval)
— that discipline ports cleanly into `/opsx:explore`.

## 3. Proposed hybrid workflow

```text
idea ──► /opsx:explore            (brainstorming discipline, OpenSpec surface;
          │                       no artifacts, no code)
          ▼
       /opsx:propose <name>       (proposal + delta specs + design + tasks;
          │                       human reviews artifacts before any code)
          ▼
       /opsx:apply                (per task: superpowers TDD; hooks unchanged;
          │                       steering/update anytime via /opsx:update)
          ▼
       verification-before-completion + /opsx:verify (expanded profile)
          ▼
       requesting-code-review → receiving-code-review   (unchanged)
          ▼
       /opsx:archive  +  finishing-a-development-branch (specs sync, then PR/merge)
```

Routing rule to add to `CLAUDE.md` (replaces the current "Pi Workflow" section;
repo instructions override global skills per using-superpowers' own precedence
rules):

| Trigger | Route |
|---|---|
| "Let's build / add / change X" (code behavior) | `/opsx:explore` or `/opsx:propose` — **not** brainstorming |
| Non-code creative work (docs, process, writing) | brainstorming (unchanged) |
| Bug / test failure | systematic-debugging; if root cause becomes a change, `/opsx:propose` |
| Inside `/opsx:apply` | test-driven-development, verification-before-completion |
| Plan drifted from code | syncing-plan-with-code (update the change's artifacts, i.e. `/opsx:update`) |

Do **not** edit `~/.claude/skills/brainstorming/` globally — scope the override
to this repo via CLAUDE.md so other projects keep vanilla superpowers.

### Repo setup

```bash
npm install -g @fission-ai/openspec@latest
openspec init --tools claude,opencode   # writes .claude/skills/openspec-* and .opencode/{skills,commands}
```

Commit the whole `openspec/` tree (specs are the point; archive included).
Generated `openspec-*` skill dirs coexist with existing custom skills — no name
clashes.

Suggested `openspec/config.yaml`:

```yaml
schema: spec-driven
context: |
  Runtime Bun; Zod v4; Vercel AI SDK; strict TypeScript with .js import extensions.
  Error extraction: error instanceof Error ? error.message : String(error).
  p-limit for bounded concurrency. pino metadata-first logging; never log secrets.
  No lint-disable/type-ignore comments; max-lines failures mean split the file.
rules:
  proposal:
    - Name the affected platform/task instances and config-context scope impact
  specs:
    - Scenarios use WHEN/THEN; include guest-mode and scope-model edge cases where relevant
  design:
    - State capability/tool-prefs gating impact for any new tool surface
  tasks:
    - Every task ends with its verification command (bun test path, bun run typecheck)
```

Optional later: `openspec schema fork spec-driven papai-sdd` to add e.g. a
`ux-review` artifact gated on `client/` changes.

## 4. Migration guide: brainstorming → OpenSpec

Superseded. The operational migration guide is the design document of the
`migrate-brainstorming-to-openspec` change (the first dogfood change on the
workflow above):

- While the change is active: `openspec/changes/migrate-brainstorming-to-openspec/design.md`
- After it archives: `openspec/changes/archive/<date>-migrate-brainstorming-to-openspec/design.md`

That design covers the strangler/no-backfill decision, the frozen legacy tree
rules for `docs/superpowers/`, the CLAUDE.md routing table, and the
retargeting of repo-local skills and dev tooling. §1–§3 of this document
remain the decision research. Porting individual legacy items into OpenSpec
(one at a time: archive/adopt/seed/retire) is operationalized by
[`docs/operations/legacy-migration-runbook.md`](../operations/legacy-migration-runbook.md).

### opencode-agent — the last entry point

`opencode-agent/` was the one entry point the migration above left untouched:
its `PHASE_SKILLS` still routed triage to `brainstorming` and planning to
`writing-plans`, producing freeform `AGENT_SPEC`/`AGENT_PLAN` blocks no
`openspec validate` ever saw. The `opencode-agent-openspec-compliance` change
brings it onto the same OpenSpec substrate as every other entry point — see
`openspec/changes/opencode-agent-openspec-compliance/` for the full design
(D1–D13): the folder is truth (comments are renders), `PHASE_SKILLS` rewired
to `openspec-explore`/`openspec-propose`, `tasks.md` as the step source,
steering-drift (D6), the merged-PR archive door (D7), and the deliberate
`STATE_VERSION` bump that strands legacy issues onto a fresh restart (D12).

## 5. Open questions

- Enable expanded profile for `/opsx:verify` + `/opsx:onboard`, or stay on core
  and let superpowers skills cover verification?
- Do `review-loop/` and `mutation-improve/` workspaces get their own
  `openspec/` trees, or share the root one?
- Worth forking a `papai-sdd` schema now (extra artifacts) or after 2–3 changes
  of experience with the default?
