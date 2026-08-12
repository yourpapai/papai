<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Make opencode-agent OpenSpec-compliant

Design: `design.md` (D1–D13). Test-first throughout: each task's failing
test lands before its implementation, per `tests/CLAUDE.md` and the repo
Write/Edit TDD hook pipeline.

## 1. OpenSpec driver + probes

- [x] 1.1 Add failing tests for an openspec CLI driver (`status --json`,
  `instructions --json`, `new change`, `validate --strict`, retry ≤2 with
  the validation complaint attached) in `tests/opencode-agent/openspec-driver.test.ts`
  — `bun test tests/opencode-agent/openspec-driver.test.ts`
- [x] 1.2 Implement `opencode-agent/src/openspec-driver.ts` (DI'd shell
  seam, argv vectors with `shell: false`, zod-decoded JSON output)
  — `bun test tests/opencode-agent/openspec-driver.test.ts`
- [x] 1.3 Add failing tests for the `openspec/` root probe in
  `config-discovery` (present → compliant mode; absent → stand-down
  comment + `warn`, fail-closed per D10)
  — `bun test tests/opencode-agent/config-discovery.test.ts`
- [x] 1.4 Implement the probe (D10), the stand-down path, and the
  deliberate `STATE_VERSION` bump (D12): legacy state blocks rejected →
  restore finds nothing → issue restarts fresh
  — `bun test tests/opencode-agent/state-manager.test.ts tests/opencode-agent/config-discovery.test.ts`

## 2. Skill rewiring

- [x] 2.1 Add failing tests for the reworked `PHASE_SKILLS` table (D4:
  `INIT_OR_CLARIFY`→`openspec-explore`, `PLANNING`→`openspec-propose`,
  execution skills unchanged, `brainstorming`/`writing-plans`/
  `executing-plans` gone) and for loader root precedence (D11):
  in-repo openspec trees first-hit-win — `bun test tests/opencode-agent/obra-skills.test.ts`
- [x] 2.2 Implement `PHASE_SKILLS` + loader roots (`.opencode/skills/`,
  then `.agents/skills/`, then superpowers roots)
  — `bun test tests/opencode-agent/obra-skills.test.ts`

## 3. INIT_OR_CLARIFY: explore stance + capture policy

- [x] 3.1 Add failing tests for the structured triage outcome
  (`clarify | capture | answer` + kebab change name) parsed via
  `promptForJson`, and for the D9 association gate (auto-capture for
  OWNER/MEMBER/COLLABORATOR; consent comment otherwise; affirmative reply
  routed via `applyClarifyIntent` completes capture)
  — `bun test tests/opencode-agent/triggers.test.ts tests/opencode-agent/phases.test.ts`
- [x] 3.2 Implement the triage outcome + D9 gate + consent path; scaffold
  the change (`new change` via driver) on capture
  — `bun test tests/opencode-agent/phases.test.ts`

## 4. Branch-from-first-spec + artifact writes

- [x] 4.1 Add failing tests for capture-time branch creation
  (`agent/issue-<n>` + folder scaffold as commit #1) and for the diff-guard
  named-prefix grant limiting planner/spec turns to
  `openspec/changes/<change-name>/` (D8), protected-paths staging unchanged
  — `bun test tests/opencode-agent/git-commit.test.ts tests/opencode-agent/diff-guard.test.ts`
- [x] 4.2 Implement branch-from-first-spec (D2) and the prefix grant;
  capability profile for artifact-writing turns (deny-by-default + named
  grant) — `bun test tests/opencode-agent/diff-guard.test.ts tests/opencode-agent/openai-config.test.ts`

## 5. PLANNING + parks on real artifacts

- [x] 5.1 Add failing tests for the PLANNING drafter loop (D3): typed
  instruction → model composes per template → `validate --strict` → retry
  ≤2; digest rendering from the folder (D1) with revision display metadata
  — `bun test tests/opencode-agent/phases.test.ts`
- [ ] 5.2 Implement the drafter loop; `DESIGN_SPEC`/`PLAN_REVIEW` parks
  render digests of real proposal/specs/design/tasks; retire
  `AGENT_SPEC`/`AGENT_PLAN` blocks outright (no legacy restore path —
  in-flight issues restart via the `STATE_VERSION` bump, D12)
  — `bun test tests/opencode-agent/phases.test.ts tests/opencode-agent/artifacts.test.ts`
- [x] 5.3 Sweep every remaining reader of the retired `AGENT_SPEC`/
  `AGENT_PLAN` blocks and their revision counters (`specRevision`,
  `planRevision`): prompts that envelope spec/plan text, PR body rendering,
  status/progress tables, report block stamping, `findPlan`/`findHandoff`
  — each becomes a folder read or is deleted; a repo-wide grep for the
  retired block names returns only the migration-era test fixtures
  — `bun test tests/opencode-agent/ && rg -l "AGENT_SPEC|AGENT_PLAN|specRevision|planRevision" opencode-agent/src`

## 6. REVIEW_AND_MUTATE on tasks.md

- [x] 6.1 Add failing tests for walking `tasks.md` checkboxes as the step
  source (D5), box checked in the same commit as the step's work, drift from
  a cursor past the end
  — `bun test tests/opencode-agent/plan-steps.test.ts tests/opencode-agent/implement-steps.test.ts`
- [x] 6.2 Implement the checkbox step source (D5)
  — `bun test tests/opencode-agent/implement-steps.test.ts`
- [ ] 6.3 Add failing tests for steering-drift: scope-affecting steering in
  `REVIEW_AND_MUTATE` triggers an artifact-update turn (edit → validate →
  commit) before implementation continues (D6)
  — `bun test tests/opencode-agent/comment-intent.test.ts tests/opencode-agent/phases.test.ts`
- [ ] 6.4 Implement steering-drift (D6)
  — `bun test tests/opencode-agent/phases.test.ts`

## 7. Archive door

- [ ] 7.1 Add failing tests for the `pull_request.closed(merged)` trigger:
  parse → guardrails → resolve issue via head branch (existing door
  pattern), foreign-repo refusal, `ARCHIVE` phase running
  `openspec archive` as a follow-up commit on master (D7)
  — `bun test tests/opencode-agent/pr-trigger.test.ts tests/opencode-agent/triggers.test.ts`
- [ ] 7.2 Implement the trigger + `ARCHIVE` phase + workflow YAML job;
  install + pin the `openspec` CLI in `agent-pipeline.yml` beside the
  `opencode` CLI — `bun test tests/opencode-agent/pr-trigger.test.ts`

## 8. Restart + cancel cleanup

- [ ] 8.1 Add failing tests for restart semantics (D12): a restarted issue
  whose `agent/issue-<n>` branch already exists resets the branch to base
  before the scaffold commit; and for `/cancel` gaining branch +
  change-folder cleanup (D9) — `bun test tests/opencode-agent/triggers.test.ts`
- [ ] 8.2 Implement restart-with-reset + cancel cleanup
  — `bun test tests/opencode-agent/triggers.test.ts`

## 9. Docs + full verification

- [ ] 9.1 Update `opencode-agent/CLAUDE.md` (phase descriptions, artifact
  model, new door, no-legacy policy), `opencode-agent/README.md` and
  `opencode-agent/ROADMAP.md` (open findings referencing blocks or the
  superpowers skill set), and
  `docs/architecture/openspec-superpowers-hybrid.md` routing table
  (opencode-agent entry now points at this change)
  — `bun run format:check`
- [ ] 9.2 Run full `bun test`, `bun run typecheck`, `bun run lint`
  — `bun run test && bun run typecheck && bun run lint`
