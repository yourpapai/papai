<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Make opencode-agent OpenSpec-compliant

## Why

The archived `migrate-brainstorming-to-openspec` change (D4 routing table)
made OpenSpec the planning substrate for every entry point in this repo —
**except** `opencode-agent`, whose `PHASE_SKILLS` still routes triage to
`brainstorming` and planning to `writing-plans`, producing freeform
`AGENT_SPEC`/`AGENT_PLAN` blocks that no `openspec validate` ever sees. Its
branches ship code **without** a change folder, violating the
`operations.apply` rule that artifacts ride with code. The agent is the last
unmigrated entry point; `.worktrees` exploration and the now-built
`sdd-runner` (real folder + CLI-driven + `validate --strict` after every
write) prove the compliance idiom that the agent should adopt.

## What Changes

- `INIT_OR_CLARIFY` keeps its conversational clarify (the agent's
  interactive identity) but inlines the **openspec-explore** stance instead
  of `brainstorming`; when triage converges it scaffolds a real
  `openspec/changes/<name>/` change on `agent/issue-<n>` and pushes it.
- `PLANNING` inlines the **openspec-propose** skill instead of
  `writing-plans`; the CLI protocol parts (`new change`, `status --json`,
  `instructions --json`, `validate --strict` retry loop) are driven from
  TypeScript, the model composes artifact content. `executing-plans` is
  dropped everywhere (subsumed by `tasks.md`).
- `DESIGN_SPEC` / `PLAN_REVIEW` stay human parks, but now review **rendered
  digests of the real folder**; the folder on the branch is truth, comments
  are renders.
- `REVIEW_AND_MUTATE` walks `tasks.md` checkboxes as filesystem state of
  record; each step's commit checks its box in the same commit. TDD and
  `verification-before-completion` stay inlined (apply layer per D4).
- **New** archive door: `pull_request.closed(merged)` trigger runs
  `openspec archive` as a follow-up commit on master, closing the
  propose → apply → archive loop.
- Branch becomes the artifact durability mechanism: `AGENT_STATE` stays on
  the issue; `AGENT_SPEC`/`AGENT_PLAN` blocks are retired.

## Capabilities

### New Capabilities

None — dev-workflow/tooling change to `opencode-agent/` only; no papai
runtime behavior changes. `skip_specs: true` is set in `.openspec.yaml`,
matching the precedent of `migrate-brainstorming-to-openspec`.

### Modified Capabilities

None. `openspec/specs/` is empty (strangler); nothing to modify.

## Non-goals

- No changes to `sdd-runner/`; its compliance patterns are reused as
  patterns, not imported as code, and no shared foundation is extracted.
- No changes to papai runtime (`src/`, `client/`, `plugins/`); no
  platform-instance/task-instance surface impact; no config-context scope
  impact (no new persisted state keyed by any context id).
- No removal of the agent's interactivity: clarifying conversation, `/ask`,
  mid-run steering, and the two human parks are preserved.
- No review-loop-on-artifacts (sdd-runner's convergence machinery); the
  human parks remain the quality gate.
- No legacy compatibility for in-flight issues: they are restarted under
  the reworked pipeline (the stale branch is reset); no dual-format state.

## Impact

- **Docs/instructions:** `opencode-agent/CLAUDE.md`, `opencode-agent/README.md`,
  `docs/architecture/openspec-superpowers-hybrid.md` (routing table note).
- **Code:** `opencode-agent/` phases (`INIT_OR_CLARIFY`, `PLANNING`,
  `DESIGN_SPEC`, `PLAN_REVIEW`, `REVIEW_AND_MUTATE` step source),
  `PHASE_SKILLS`, artifact/blocks layer, diff-guard write grant for
  `openspec/changes/`, new merged-PR trigger + `ARCHIVE` phase.
- **OpenSpec tree:** this change lives in the root tree per the migration's
  D7 (sub-workspaces share the root `openspec/` tree).
