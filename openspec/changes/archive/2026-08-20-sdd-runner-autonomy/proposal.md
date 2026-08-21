# Proposal: sdd-runner autonomy

## Why

Every converged sdd-runner run still ends in a final-gate checkbox ceremony, every
cap-hit with open BLOCKERs/MATERIALs halts even when the burndown is strictly
decreasing, and nothing records which interventions were mechanical — so the gate
policy cannot improve from data. Most gate asks are decidable by deterministic
policy over signals the pipeline already computes (severity convergence, burndown
slope, per-round cost, blast radius, budget ceilings); severity convergence in
`runPostReviewToGate` is one such rule, and this change generalizes it into a
bounded, auditable policy ladder: lazy about human attention, never about evidence.

## What Changes

- **Autonomy levels** `observe` (default: byte-identical behavior plus an
  `### Auto-decision preview` block on every gate and an append-only
  counterfactual `auto-policy.jsonl` sidecar), `assist` (policy decides the
  mechanical surfaces), `auto` (everything the ladder permits; optional
  `--auto-deadline` dead-man timer). Config `autonomy` block, safe defaults; CLI
  `--autonomy` overrides.
- **Deterministic decision ladder** (policy-defined → existing signal → rule →
  bounded budget → human): **R1** converged-final-approve, **R2**
  trajectory-auto-extend (bounded, reuses extend-round mechanics), **R3**
  assumption blast-radius triage, **R4** budget guard (`costCeilingUsd`), **R5**
  reversibility boundary (PR/merge/delete never auto-decided).
- **Never-cut invariants**: open BLOCKER always gates; budget/round-cap
  exceedance always gates; leaving-the-branch actions always human; auto-decided
  gates still write `gate-<n>.md` (grammar gains one optional `decided-by:` line);
  `events.ndjson` gains one L2 `auto_decision` event, stays replay-sufficient.
- **New surfaces**: `sdd-runner audit <runId>` (reconsider list with runnable
  overturn commands via the new `sdd-runner gate reopen <runId> --gate <n>`, which
  re-presents a settled auto-decided gate so the existing veto/abort mechanics
  apply; feeds a policy-debt ledger written at decision time), `report` gains
  block, queued steering via `runs/<id>/steer.md`.
- **Tier 0 output polish** (zero new deps): per-stage wall time/cost, active-stage
  elapsed marker, wide-char-safe slot truncation with retry badges, model id on
  `done` lines, ETA + reasoning tokens, burndown sparkline, terminal title,
  `--verbosity quiet`. **Non-TTY byte contract frozen** except the done-line
  model id.
- **TUI adoption (ladder-ordered)**: `@clack/prompts` (workspace-local) as the
  gate-session front-end — gate-file grammar, flags, hand-edit path untouched;
  **Ink 7** for a new `sdd-runner watch <runId>` verb replaying then tailing
  `events.ndjson`; the hand-rolled block engine stays, consolidated via
  `shared-tui-renderer` (landed as-is, not forked).

## Capabilities

### New Capabilities

- `sdd-runner-autonomy`: autonomy levels and their resolution (CLI > config >
  default), the decision ladder and rules R1–R5, never-cut invariants, gate
  previews and `auto-policy.jsonl`, the `auto_decision` event type, the `audit`
  verb and policy-debt ledger, the report gains block, queued steering.
- `sdd-runner-output`: Tier 0 output details, the frozen non-TTY byte contract,
  the clack gate-session front-end, the `watch` attach verb.

### Modified Capabilities

None — `openspec/specs/` holds no archived capability specs. Requirement-level
interplay with the unarchived `sdd-automation` delta (gate flow, extend-round,
event schema) is recorded inside the new specs; per the `sdd-veto-resolver-pass`
precedent no `openspec/specs/` delta is written against it.

## Impact

- **Code:** `sdd-runner/src/orchestrator.ts`, `gate.ts` / `gate-render.ts` /
  `gate-answers.ts` / `gate-session.ts` / `gate-model.ts`, `gate-digest.ts`,
  `extend-round.ts` (R2), `review-loop.ts` (steering), `run-state.ts`,
  `events.ts` + `replay.ts` (schema + fold), `review-model.ts` + `agent-layer.ts`
  (R3 per-assumption `evidence.files` resolver-output schema), `cli.ts` (verbs +
  verbosity),
  `renderer.ts` / `live-renderer.ts` (Tier 0), `report.ts`, `config.ts` +
  `config.example.json`, new `auto-policy.ts` / `audit.ts` / `watch.ts` /
  `clack-prompter.ts` modules and the `audit` / `watch` / `gate reopen` verbs.
- **Dependencies:** `@clack/prompts` now; `ink` + `react` (+
  `ink-testing-library` devDep) for `watch` — workspace-local to
  `sdd-runner/package.json`.
- **Docs:** `docs/architecture/sdd-pipeline.md` (levels, rules, invariants,
  audit/watch, TUI decision); builds on `openspec/changes/shared-tui-renderer/`,
  the pending `openspec/changes/sdd-runner-extend-round/` (sequencing dependency —
  its Shape-B semantics already live in `extend-round.ts`), archived
  `sdd-runner-cap-hit-fidelity`, and `sdd-runner-gate-change-digest`.
- **Platform/task instances:** none — local developer tooling; no papai runtime,
  per-user, group-shared, or thread-isolated config-context impact.
- **Tests:** `tests/sdd-runner/` — observe byte-identity, assist and R2/R4
  fixtures, grammar self-check, audit/report output, dynamic-block snapshots,
  non-TTY golden bytes, clack/flag/hand-edit parity.

## Non-goals

- No daemon, scheduler, or background service; runs stay CLI-invoked.
- No papai chat integration (`/sdd:auto` remains a future wrapper).
- No PR/merge/delete automation — R5 keeps leaving-the-branch actions human.
- No change to the non-TTY byte contract beyond the done-line model id.
- No replacement of the gate-file protocol; extensions are optional-line additive.
- No renderer unification beyond `shared-tui-renderer`'s existing scope.
