<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Make opencode-agent OpenSpec-compliant

Motivation and scope: `proposal.md`. Precedent: archived changes
`2026-08-10-migrate-brainstorming-to-openspec` (routing table D4, dogfood D2,
shared root tree D7) and `2026-08-10-superpowers-residue-cleanup`.
Compliance baseline: `sdd-runner/` + `docs/architecture/sdd-pipeline.md`.

## Context

- `opencode-agent` phases persist **artifacts** in hidden blocks on the issue
  (`AGENT_SPEC`/`AGENT_PLAN`) because Actions runners are scratch and the
  branch historically appears only at implementation time. `AGENT_STATE`
  (the machine) also lives there.
- `PHASE_SKILLS` and skill loader roots: `.superpowers/skills/` (pinned
  `obra/superpowers` checkout), `.claude/skills/`,
  `docs/superpowers/extensions/`. The openspec skills live in-repo at
  `.opencode/skills/` and `.agents/skills/`.
- `sdd-runner` established the compliance idiom this repo now standardizes
  on: TypeScript drives the OpenSpec CLI protocol (`new change`,
  `status --json`, `instructions --json`, `validate --strict` after every
  write with retry ≤2), the model composes artifact content only, and the
  diff guard confines model writes to `openspec/changes/`.
- The openspec-propose skill's own *planning boundary* ("after artifacts,
  stop; wait for a new user request") already matches the agent's park
  semantics — the gate is built into the workflow, not bolted on.

## Goals / Non-Goals

**Goals:**

- Every issue that becomes work carries a real, `validate --strict`-passing
  change folder on `agent/issue-<n>`; comments are renders of it.
- The agent's skill routing satisfies the repo's D4 routing table.
- Interactivity (clarify, `/ask`, mid-run steering, two human parks) is
  preserved; the parks now gate folder content.

**Non-Goals:**

- Shared foundation with sdd-runner (patterns reused, code not shared).
- Review-loop-on-artifacts automation; humans remain the quality gate.
- Runtime/capability/scope-model impact: none (dev tooling).
- DB changes: none. New external dependency: the `openspec` CLI in the CI
  environment (installed in the workflow beside the `opencode` CLI; it is
  dev tooling, not a papai dependency — same standing as the review-loop
  subprocess dependency).

## Decisions

### D1 — The folder is truth; comments are renders

proposal/specs/design/tasks live in `openspec/changes/<name>/` on
`agent/issue-<n>`. `AGENT_SPEC`/`AGENT_PLAN` blocks are retired; revision
counters become display metadata on rendered digests ("digest r3 ·
folder@a1b2c3"). `AGENT_STATE` stays on the issue (the machine needs the
thread; artifacts need the branch).
Alternative: keep blocks as the artifact transport mirroring the folder —
rejected: two truths, exactly the drift the archived migration eliminated.

### D2 — Branch from first-spec

The branch is created when `INIT_OR_CLARIFY` converges on a change, and the
scaffolded folder is commit #1. Every artifact revision is a pushed commit —
durability without blocks.
Alternative: lazy branch at implementation (status quo) — rejected: planning
artifacts would die with each Actions job, forcing blocks back in.

### D3 — TS drives the CLI protocol; the model composes content

A thin driver wraps `openspec status --json` / `instructions --json` /
`validate --strict` (same division of labor as `sdd-runner`'s
`openspec-driver.ts`, re-implemented, not imported). Phase handler loop:
typed instruction → model composes per template → validate → retry ≤2 with
the validation complaint attached (the existing `promptForJson` pattern
generalized to artifacts).

### D4 — Skill rewiring per the archived D4 routing table

- `INIT_OR_CLARIFY`: required `openspec-explore` (stance only — clarify
  material ambiguity, capture when crystallized); `brainstorming` dropped.
- `PLANNING`: required `openspec-propose`; `writing-plans` and
  `executing-plans` dropped.
- `REVIEW_AND_MUTATE`: `test-driven-development` +
  `verification-before-completion` unchanged (apply layer).
- `CI_FIX`: `systematic-debugging` unchanged.
- Loader roots gain `.opencode/skills/` (and `.agents/skills/` first-hit
  precedence per the repo's own skill layout); the pinned
  `obra/superpowers` checkout shrinks to execution skills.

### D5 — tasks.md is the plan's only shape

`implement-steps.ts` walks the change's `tasks.md` checkboxes; each step's
commit checks its box in the same commit (`operations.apply`: checkbox state
is filesystem state of record). Planner prompts inherit repo rules
(`openspec/config.yaml` rules.tasks) via the CLI instructions protocol
rather than prompt-hardening.

### D6 — Steering that changes scope edits artifacts first

Mid-run steering classified as scope-affecting triggers an artifact-update
turn (edit → validate → commit) *before* implementation continues, so the
folder cannot rot relative to the conversation — the interactive form of
sdd-runner's drift check.

### D7 — Merged PR is the archive door

New workflow trigger `pull_request.closed(merged)` → `ARCHIVE` phase runs
`openspec archive` as a small follow-up commit on master
(`operations.archive`). Trigger plumbing follows the existing
`ci-trigger.ts` door pattern (parse → guardrails → resolve issue via head
branch).

### D8 — Diff guard grants a named prefix for artifact writes

Planner/spec model turns gain write capability scoped to
`openspec/changes/<agent-change-name>/` only — same shape as sdd-runner's
guard, deny-everything-else and the existing protected-paths staging
(`.github/workflows/` etc.) unchanged.

### D9 — Capture policy: auto-capture gated by author association (A+D)

The triage turn ends with structured output via the existing `promptForJson`
pattern: `clarify | capture | answer`, plus the kebab change name on
`capture`. Auto-capture (scaffold + branch + proposal draft, no human touch)
fires only for `OWNER` / `MEMBER` / `COLLABORATOR` issue authors — the
association field the event payload already carries, in the spirit of the
existing `PR_FOREIGN_REPOSITORY` guardrail. External/first-time authors get
a "ready to capture `<name>` — confirm?" comment instead, and any
affirmative reply (routed through the existing clarify-intent classifier,
which re-runs triage on anything but `none`) completes the capture.
Mis-captures are ejected at the `DESIGN_SPEC` park (revise in place) or by
`/cancel`, which gains branch + change-folder cleanup. Rationale: the park
is the honest place to absorb capture errors; consent-for-everyone taxes
every crystal-clear issue with the maintainer touch the agent exists to
eliminate; a mis-capture is `git push -d` plus a folder away from gone.
Alternatives considered: explicit consent for all (friction on the fast
path), zero-turn tiering (the tier boundary is itself model judgment).

### D10 — Cross-repo posture: probe, fail closed

The agent runs in repos other than papai. At job start, config-discovery's
existing probe pattern gains an `openspec/` root probe (same testable ladder
shape as the `review-loop/` probe). Present → this change's behavior.
Absent → the agent posts one clear comment (the repo needs `openspec`
scaffolding, e.g. `openspec init`) and stands down, `warn`-logged. It never
scaffolds OpenSpec into a foreign repo, and — since `AGENT_SPEC`/
`AGENT_PLAN` retire outright (D12) — there is no legacy block mode to fall
back to; a block pipeline kept alive only for foreign repos is dead format
for the same reasons as per-issue backcompat. Mirrors the migration
precedent's scoping: overrides are repo-local; other projects adopt
OpenSpec on their own terms.

### D11 — Skill copy precedence

Loader roots order: `.opencode/skills/`, then `.agents/skills/`, then the
existing superpowers roots, first-hit wins (`loadSkills` already implements
it). openspec-explore / openspec-propose resolve from `.opencode/skills/`;
execution skills keep resolving from the pinned `.superpowers/` checkout.
Duplicate copies across trees stay edited in lockstep per the migration's
D9 rule.

### D12 — In-flight issues restart; no dual format

Deliberate `STATE_VERSION` bump: legacy state blocks are rejected by the
schema, the restore scan finds no valid state, and the issue starts over at
`INIT_OR_CLARIFY` under the compliant pipeline. When a restart finds a
pre-existing `agent/issue-<n>` branch (partial legacy work), it is reset to
the base branch before the scaffold commit — restart means *from zero*,
not "adopt the old diff". The migration precedent deliberately avoided
bumps *because* stranding was the cost; here stranding is the chosen
behavior, and restart-with-reset is the defined recovery path.
Alternative considered: per-issue format fork (`artifactMode` in state) —
rejected: doubles every artifact read/write path for the lifetime of a
handful of issues.

### D13 — Dogfood

This rework itself enters via `/opsx:propose` (this change). Post-merge
there is no dedicated shakedown protocol: real issues (starting with the
restarted in-flight ones) exercise the reworked pipeline immediately, and
any tuning lands as follow-up changes in the ordinary way.

## Risks / Trade-offs

- **Mis-capture litters branches** — a false "ready to scaffold" now creates
  a branch + folder, not just a comment → Mitigation: D9 (association-gated
  auto-capture, park ejection, `/cancel` cleanup).
- **Repo carries duplicate skill trees** (`.opencode/` vs `.agents/`) →
  Mitigation: loader precedence fixed in D4; both copies stay in lockstep
  per the migration's D9 rule.
- **Non-papai target repos without an `openspec/` root** → the agent runs
  in other repos; fail-closed per D10. Rolling OpenSpec out to those repos
  is a separate, per-repo decision, not this change's job.
- **openspec CLI availability in CI** → Mitigation: workflow installs it
  beside the `opencode` CLI; version pinned like the superpowers checkout.
- **In-flight legacy issues** → Mitigation: deliberate `STATE_VERSION` bump
  (D12) — stranding is *intended* here; legacy blocks are rejected, the
  restore scan finds nothing, and the issue restarts fresh under the
  compliant pipeline.

## Hook/TDD interactions

New files under `opencode-agent/src/` are gated by the repo Write/Edit TDD
hook pipeline; tests live in `tests/opencode-agent/` (no network). Work
order is test-first: driver + skill-loader root tests, then phase-handler
rewires, then the merged-PR trigger door. Live/integration suites
(`live-sdk`, `server-survival`) are untouched.

## Open Questions

None — the three candidate questions are resolved as D9, D10, D11. If
dogfooding (D13) shows mis-capture rates or consent friction higher than
expected, D9's thresholds are the first knob to revisit.
