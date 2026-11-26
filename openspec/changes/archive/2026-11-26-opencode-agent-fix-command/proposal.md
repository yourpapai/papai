# Proposal: opencode-agent-fix-command

## Why

The CI-fix phase is reachable only through the automatic red-run door: a `workflow_run` event on the agent's pull request. When that event never arrives or is refused — cancelled rather than finishing red, dropped by the transition table, or left by a human push — a maintainer cannot ask the agent to repair it. Every other maintainer verb (`/review`, `/sync`, `/retry`) has a command; the remedies are hand-fixing or a dummy commit.

## What Changes

- New `/fix` command on the agent's pull request, entering `CI_FIX` through the existing `CI_FAILED` signal — the same transition and machinery the red-run door uses.
- The discovery prelude gains one branch: a command-bought round reads the head commit's failed check runs via the Checks API; only the report's wrong-door wording (zero-failure and read-error lines) turns door-aware (D7).
- Gated like `/review`/`/sync`: only once a pull request exists and in a phase admitting `CI_FAILED`; typed on the issue, refused naming where to type it.
- Budget refused before the signal is applied: `/fix` past `AGENT_MAX_CI_ATTEMPTS` is turned down first (`refuseReviews` precedent); nothing is parked, and the notice names the ceiling and the new-PR remedy.
- `SLASH_COMMANDS` grows the command; the workflow's PR arm follows in lockstep (`workflow.test.ts` keeps them honest), and the workflow gains `checks: read` — the grant the head-check-run read needs (D5).

## Capabilities

### New Capabilities

- `agent-fix-command`: the maintainer-initiated CI-repair door — when `/fix` is accepted, how it is gated, how a spent budget is answered, and that it reuses the CI-fix phase, not a second repair path. Without it, red checks no red-run event delivered stay out of the agent's reach.

### Modified Capabilities

None. `agent-ci-repair` (from the unarchived `ci-fix-red-run-analysis` change) owns what a repair run *does* once failures are known and has no spec under `openspec/specs/` to modify; this change adds only the door and how a command-bought round finds what is red (the `agent-command-steering`/`/sync` reasoning). No other spec covers the command surface.

## Impact

- No papai platform, task-instance or config-context scope impact: `opencode-agent/` is a standalone workspace, not a runtime dependency; the command persists only `AGENT_STATE` fields (`ciAttempts`, `phase`).
- `opencode-agent/src/` — `commands.ts`, `triggers.ts`/`command-refusals.ts`, `budget-notices.ts`/`outcomes.ts` (`CI_SPENT` notice), `phases/ci-fix.ts` + `github-actions.ts` (discovery branch, `listCheckRunsForRef`), `ci-report.ts` (door-aware wording).
- `.github/workflows/agent-pipeline.yml` — the PR-arm `contains`, `checks: read` and the permissions comment the grant lands beside (D5).
- `opencode-agent/CLAUDE.md` — command-surface doctrine plus the CI-fix doctrine bullet's command-bought discovery half; `opencode-agent/README.md` — command table, `CI_FIX` trigger row, once-per-PR silence passage; no `docs/architecture/` change.
- Tests under `tests/opencode-agent/` — parsing, gating, budget refusal, transition, head-check-run discovery.

## Non-goals

- No new diagnosis protocol, verdict branches or repair loop — `agent-ci-repair` owns those once failures are known; `/fix` adds the entry plus the head-commit discovery branch.
- No polling or watching of check runs; the red-run door is unchanged.
- No `/fix` before a pull request exists, and no bypass of `AGENT_MAX_CI_ATTEMPTS`.
- No guardrail changes: foreign-repository pull requests keep their existing refusals.
