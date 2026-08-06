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

1. **Install & init** (above). Verify: `openspec list`, autocomplete on `/opsx`.
2. **Inventory existing docs.** Find prior outputs:
   `docs/superpowers/specs/*.md` (designs) and any implementation plans.
3. **Classify each document:**
   - *Shipped feature* → write its requirements directly as main specs:
     `openspec/specs/<capability>/spec.md` using `## ADDED Requirements` →
     re-read as the current truth (drop "ADDED" framing: main specs state what
     is). No change folder needed.
   - *In-flight work* → create `openspec/changes/<name>/` via `/opsx:propose`,
     then let the agent port the design doc into `proposal.md` + delta `specs/`
     + `design.md`; port the plan's steps into `tasks.md` checkboxes.
   - *Abandoned idea* → leave in place or delete; do not migrate.
4. **Convert format**, per requirement: design-doc prose → SHALL statement +
   at least one `#### Scenario:` with WHEN/THEN. Run `openspec validate
   --strict` after each file.
5. **Rewire CLAUDE.md** with the routing table in §3; delete the instruction
   that brainstorming gates all creative work; keep every other skill
   reference. Also update the `syncing-plan-with-code` skill's target path
   language to point at `openspec/changes/<name>/` artifacts.
6. **First new feature** runs the full loop explore → propose → apply → verify
   → archive as a shakedown; adjust `config.yaml` rules from what you observe.
7. **Ongoing:** `openspec update` after upgrading the npm package; treat
   `openspec/specs/` as review-required surface in PRs.

Checklist mapping (brainstorming step → OpenSpec step):

| brainstorming checklist item | OpenSpec |
|---|---|
| Explore project context | `/opsx:explore` reads code |
| Clarifying questions, one at a time | explore dialogue (keep the discipline) |
| Propose 2–3 approaches w/ trade-offs | explore; recommendation lands in proposal.md |
| Present design sections, approval gate | human reviews `changes/<name>/` artifacts before `/opsx:apply` |
| Write design doc + commit | `/opsx:propose` writes design.md; committed with the change |
| Spec self-review (placeholders, contradictions) | `openspec validate --strict` + same manual pass |
| User reviews spec | same gate, now on the artifact set |
| → writing-plans | tasks.md artifact (no separate plan doc) |
| → executing-plans | `/opsx:apply` (tasks.md checkboxes = progress) |

## 5. Open questions

- Enable expanded profile for `/opsx:verify` + `/opsx:onboard`, or stay on core
  and let superpowers skills cover verification?
- Do `review-loop/` and `mutation-improve/` workspaces get their own
  `openspec/` trees, or share the root one?
- Worth forking a `papai-sdd` schema now (extra artifacts) or after 2–3 changes
  of experience with the default?
