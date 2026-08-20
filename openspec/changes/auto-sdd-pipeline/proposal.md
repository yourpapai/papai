## Why

The current OpenSpec workflow still depends on a manual outer loop: the human drafts with an agent, resolves TODOs in fresh chats, answers review questions across rounds, and personally supplies the convergence signal — agent self-review never terminates on its own. A skill-only automation would leave the mechanics that most need determinism (round counting, context isolation, resume, convergence, progress visibility) to prompt discipline. The repo already proves the right shape: `review-loop/` and `mutation-improve/` spawn `opencode run` agents while runner code owns control flow. But their progress output (per-agent tool telemetry) is the wrong altitude for a semantic pipeline: it shows agents are alive, not what the pipeline has concluded.

## What Changes

- New Bun workspace `sdd-runner/` (sibling of `review-loop/`, `mutation-improve/`): spawns/kills fresh `opencode run` agents per stage and round, drives `openspec` CLI, owns the stage machine (intake → draft → review loop → decompose → atomicity → human gate), hands off to stock `/opsx:apply` → `/opsx:verify`.
- Three-altitude progress model: L0 agent telemetry, L1 agent lifecycle, **L2 pipeline semantics** (stage/round/finding/assumption/convergence/gate events) in a file-backed `events.ndjson` — replayable for resume and post-hoc reports.
- Semantic renderer: always-visible pipeline map, per-round convergence burndown, semantic one-liner stream, verbosity profiles, gate screen. Reuses review-loop modules via relative import; review-loop itself untouched.
- Runner-materialized loop artifacts: agents emit schema-validated JSON sidecars; the runner generates `review.md` / `assumptions.md` — markdown as a view, JSON the read model.
- Forked `auto-sdd` schema adding `assumptions` + `review` artifacts; convergence predicate, answer-before-ask, reviewer context isolation per the `sdd-automation` capability.
- Intake split: a read-only scope-estimator agent proposes implicated files; deterministic runner code assigns the S/M/L profile. `--depth` skips estimation — the expected path for small changes.
- Human gate as a run state: halt with digest + `gate resume`; checkbox veto protocol with redirects and BLOCKER answers; hand edits to agent-authored artifacts detected, with a drift-check pass when specs/design change.
- `report <runId> [--pr]`: evidence-backed synthesis from `events.ndjson` + change folder + branch git log, stating what scrutiny did and did not happen.
- Thin `/sdd:auto` wrapper command; docs page + index/routing rows.

## Capabilities

### New Capabilities

- `sdd-automation`: Autonomous SDD pipeline behavior — stage sequencing and resume, structured progress events and rendering, review-round mechanics, convergence predicate, reviewer isolation, agent lifecycle control, runner-materialized loop artifacts, assumption capture and gate, adaptive depth.

### Modified Capabilities

None. (`openspec/specs/` is empty; no existing capability requirements change.)

## Non-goals

- No changes to stock `/opsx:*` skills, the `spec-driven` schema, apply/verify/archive flows, or `review-loop`/`mutation-improve` behavior (read-only reuse).
- No full-screen TUI library; the renderer extends the proven cursor-block approach.
- Any papai runtime behavior: no platform/task instances, tools, or settings UI affected. Config-context scope impact: none — run state lives in a gitignored workDir; OpenSpec artifacts in the change folder.
- Auto-archive; archive stays human-triggered per repo guidance.

## Impact

- `sdd-runner/` (new workspace), root `package.json` (workspaces + `sdd-runner:*` scripts)
- `tests/sdd-runner/**`; TDD mapping extension in `.hooks/tdd/test-resolver.mjs` and `scripts/mutation/coverage-map.ts`
- `openspec/schemas/auto-sdd/` (via `openspec schema fork`), `openspec/config.yaml` (rules for new artifacts if supported)
- `.claude/commands/sdd-auto.md`, `.opencode/commands/sdd-auto.md` (thin wrappers)
- `docs/architecture/sdd-pipeline.md` (new), `CLAUDE.md`/`AGENTS.md` index + routing rows
- No new runtime dependencies beyond workspace-shared `zod`; no DB migrations.
