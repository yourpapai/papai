## Context

The repo runs OpenSpec (CLI v1.8.0, `spec-driven` schema) and already contains two orchestrator sub-projects: `review-loop/` (spawns reviewer/fixer `opencode run` subprocesses, file-based JSON exchange, durable issue ledger, multi-round loops) and `mutation-improve/` (sequential select→improve→gate iterations, worktrees, `--resume-run`, "agent suggests, runner measures" philosophy, reuses `review-loop/src/*` by relative import). Their output stack: `event-stream.ts` parses opencode NDJSON → `line-handler.ts` tracks per-agent tool/elapsed/usage → `LiveRenderer` renders scrolling event lines + a live slot block; end-of-run burndown from `trace-log.ts` RoundMetrics.

That output is per-agent telemetry — right for mutation-improve (one number per iteration), wrong for SDD, where the run's outcomes are semantic: findings classified, assumptions logged, convergence verdicts, artifact transitions, a gate. See proposal.md — Why.

## Goals / Non-Goals

**Goals:**

- Collapse human attention from N rounds × M questions to one gate digest
- Objective, machine-evaluated review-loop convergence — code reads JSON, never the reviewer's say-so
- Fresh-eyes review via structurally enforced context isolation (fresh spawn per round, runner-constructed prompts)
- Progress output at pipeline altitude: stage position, semantic event stream, live convergence burndown, gate screen
- Crash-safe resume; stock `/opsx:apply`, `/opsx:verify`, `/opsx:archive` untouched
- Adaptive depth (S/M/L), escalation-only
- Preserve the manual flow's hand-edit affordance at the one moment the human is engaged: the gate

**Non-Goals:**

- No full-screen TUI library; no changes to review-loop/mutation-improve behavior
- Removing the human gate; auto-archive; orchestrating apply (stock `/opsx:apply` stays human-driven); any papai runtime change
- No new tool surfaces → `tool_prefs`/capability gating unaffected. No runtime persisted state → nothing keyed by storage-context/config-context/instance/user ids. No DB changes. New dependencies: none beyond workspace-shared `zod` (Bun subprocess spawning, openspec CLI, zod cover the need).
- Hook/TDD interactions: `sdd-runner/src/**` becomes gateable implementation code mapped to `tests/sdd-runner/**` (requires extending `.hooks/tdd/test-resolver.mjs` and `scripts/mutation/coverage-map.ts`); all runner work is test-first.

## Decisions

### D1: Fork the schema, don't modify stock

`openspec schema fork spec-driven auto-sdd` into `openspec/schemas/auto-sdd/`, adding `assumptions` (requires `[proposal]`) and `review` (requires `[specs, design]`). `apply.requires: [tasks]` unchanged. The forked templates are the **materializer's output contract** (D13). Verify during implementation: (a) validate accepts extra artifacts; (b) whether `config.yaml` `rules.<custom-id>` applies — else constraints live in schema `instruction:` fields; (c) whether `.openspec.yaml` tolerates a custom `depth:` key — else profile lives in run state.

### D2: Convergence as a predicate over structured findings

Findings are JSON records (class, verbatim `gap` quote, question, `code_evidence_attempted`, resolution). Converged := round k ≥ 1 with 0 BLOCKER ∧ 0 MATERIAL ∧ ≤ 3 NITPICK, evaluated **by runner code over the round's findings.json** — never from markdown, never by reviewer declaration. Cap per profile; cap-hit with open BLOCKERs halts to the gate as escalation. Anti-gaming: reviewer proposes, resolver (separate agent) assigns final class and dismisses with justification; dismissals land in a ledger fed to later rounds ("do not re-raise without new evidence"); findings lacking a `gap` quote or answered verbatim elsewhere are nitpick-eligible.

### D3: Answer-before-ask

Reviewer has read-only repo access and must record a code-evidence attempt before classifying anything BLOCKER. Repo-answerable questions become consistency checks, not questions. Survivors are genuine product judgment → assumptions (D5).

### D4: Fresh eyes via structural isolation

One fresh agent spawn per review round. The runner constructs the prompt: artifacts read from disk + project conventions + rubric + dismissed-findings ledger. Never: original task description, drafter reasoning, conversation history, assumptions log, superseded drafts. Isolation is enforced by process boundaries, not prompt pleas — the runner physically cannot leak what it doesn't include. L profile adds a **skeptic lens** (ops, migration, security, what-breaks-if) concurrent with the implementer lens.

### D5: Assumptions replace questions; the gate replaces conversation

Unknowns unanswerable from the repo become assumption records (text, basis, confidence, blast radius, status); the resolver proceeds on least-surprise defaults. The human's judgment is batched into one gate digest ranked by blast radius; veto → exactly one resolver pass → re-gate once.

### D6: Two-store state model

- **Change folder** (`openspec/changes/<name>/`): OpenSpec artifacts — git truth, rides the PR branch.
- **Run dir** (`<workDir>/runs/<runId>/`, gitignored, review-loop pattern): `state.json` (stage machine position, depth, round), `events.ndjson` (D10), JSON sidecars, agent transcripts, `gate-<n>.md` versions.

Resume = `openspec status` (artifact truth) + `state.json` (loop position) + event replay (renderer state). The split keeps git-visible deliverables clean of telemetry.

### D7: Runner-first; judgment stays in prompts

The deliverable is the `sdd-runner/` sub-project, not a skill. Following the mutation-improve precedent: **runner code owns** control flow, stage sequencing, round caps, convergence evaluation, context isolation, validation, retries, rendering, resume — everything countable; **agents own** judgment — drafting, reviewing, scope estimation, resolving findings, atomicity. A thin `/sdd:auto` wrapper command invokes the runner (no logic). Alternative rejected: skill-only orchestration — it leaves counting, isolation, resume, and rich rendering to prompt discipline, and cannot drive an event model.

### D8: Opt-in schema, dogfood before default

`auto-sdd` selected explicitly (`--schema auto-sdd`, passed by the runner at scaffold time); `spec-driven` stays default until clean dogfood runs.

### D9: Stage prompts embed `openspec instructions` output

The runner shells `openspec instructions <artifact> --json` and injects template+instruction+rules into drafter/decomposer prompts, so `openspec/config.yaml` stays the single source for project conventions. Runner prompts encode only pipeline mechanics.

### D10: Three-altitude event model, file-backed

```
L0 agent telemetry   tool_use · step_finish(tokens/cost)     (exists: event-stream)
L1 agent lifecycle   spawned · retrying · killed · done+usage
L2 pipeline semantic stage_enter/exit · round_open/close · finding(file/classify/resolve/dismiss)
                     assumption(log/veto/apply) · convergence(verdict) · artifact(materialized)
                     depth(classified+rationale) · gate(presented/answered) · human_edits(detected)
```

Runner appends every event to `<runDir>/events.ndjson`. One log gives: resume replay, post-hoc reports, CI machine-readable output, and the audit trail. Generalizes review-loop's `trace-log.ts` from round metrics to the whole pipeline.

### D11: Semantic renderer, three regions + verbosity

New module in `sdd-runner/` (review-loop's LiveRenderer untouched):

```
┌ live block:  pipeline map — one line per stage: ✓ done · ▶ active (+round k/cap) · pending · skipped
│              agent slots (existing mechanism, relabeled reviewer-r2 / resolver-r2)
├ round close: compact burndown row — findings by class, resolved, dismissed, verdict
└ scroll:      semantic one-liners (L2) + step footers (L1) + tool lines (L0, debug only)
```

Verbosity: `brief` (L2 + gate), `normal` (+L1 footers, default), `debug` (all). Non-TTY: line-mode + `events.ndjson` as machine output. Rendering extends the proven cursor-up/erase block approach; no TUI dependency.

### D12: Gate as a run state, with a real input protocol

At the gate the runner: records content hashes of agent-authored artifacts, writes `gate-1.md` (assumptions blast-ranked, cap-hit blockers, change summary, cost/duration), prints it, sets `gate-pending`, exits with a distinct code and a printed `gate resume <runId>` command (`--wait` blocks on stdin instead).

**Input protocol** — four payload types, one file convention:

```
approve          check every assumption box (or --confirm-all)
veto + redirect  leave the box unchecked; optional "→ <redirect>" line beneath
answer BLOCKER   "→ <answer>" line beneath a cap-hit blocker entry
abort            abort marker / --abort
```

Resume parses `gate-<n>.md` into a schema-validated `gate-response.json`; ambiguous input fails naming the exact line, state unchanged. CLI flags are sugar that edit the file — the file stays the single record; each presentation is versioned and logged.

**Hand edits are detected, not ignored**: resume compares artifact hashes recorded at gate entry. Edits to agent-authored files (proposal/specs/design/tasks) are re-validated, logged as `human_edits` events, and summarized in the re-gate digest; edits touching specs or design additionally trigger one **drift-check resolver pass** reconciling tasks.md before re-presentation. Alternative rejected: flag-only (no drift pass) — the gate is the last moment spec↔task drift is cheap to catch; the pass costs one agent run only when edits actually happened.

### D13: Materialization inversion, with an explicit editability split

Agents never hand-write `review.md` / `assumptions.md`. Reviewer emits `findings-<k>.json`; resolver emits `resolutions-<k>.json`; both zod-validated. The runner materializes the markdown into the change folder per the forked templates (D1). Materialized files carry a **GENERATED header** ("regenerated from sidecars — change via gate.md / sidecars") and are regenerated wholesale, never merged — direct edits are discarded by construction. The editability split:

```
human-editable at gate:  proposal.md · specs/ · design.md · tasks.md   (agent-authored)
read-only views:         review.md · assumptions.md                     (runner-materialized)
```

Payoffs: no format-drift retries; convergence reads JSON; templates are the output contract; `openspec validate` still checks final md. Creative artifacts (proposal/specs/design/tasks) stay agent-authored and human-editable — inversion applies only to loop-internal bookkeeping.

### D14: Reuse via relative imports

Import from `review-loop/src/`: agent-runner, spawn, event-stream, line-handler, live-format, worktree helpers — the mutation-improve precedent. No edits to review-loop behavior. Coupling risk accepted (same repo; a breaking refactor fails both test suites loudly).

### D15: Agent lifecycle control

Fresh spawn per stage/round (D4). Kill on timeout (existing spawn `killGraceMs`). Per-stage retry: validator error appended, ≤ 2 attempts, then halt resumable. Concurrent lenses in L via the worker-pool pattern. Runner never trusts agent-declared outcomes: convergence from findings.json, artifact existence from disk, atomicity from a checker pass.

### D16: Intake split — estimation is agent judgment, profiling is code

Depth classification decomposes into scope estimation (task description → implicated files/modules; needs repo search — an agent with read-only/codeindex access) and profile mapping (signals → S/M/L; **deterministic runner code**, testable, no agent). `--depth` skips the estimator entirely — it is the expected path for obviously-small changes, not an escape hatch; paying an agent round-trip to confirm "typo fix = S" is the kind of overhead that trains users to bypass automation. The estimator's rationale is recorded as a `depth classified` event and shown in the gate digest (depth controls scrutiny, so it's visible where the human approves). A naive keyword pre-screen cross-checks the estimator; a two-level disagreement surfaces in the digest rather than resolving silently. Escalation-only dynamics bound residual misclassification.

### D17: `report` synthesizes from three sources — no apply orchestration

The run ends at the gate; the PR exists only after the stock apply/verify flow. Rather than extending the runner into apply, `report <runId>` reads at report time: `events.ndjson` (planning transcript), the change folder (artifacts, tasks.md checkbox state), and the branch git log (per-section commits, verify presence). `report --pr` emits an evidence-backed PR body stating what scrutiny did and did not happen — depth profile + rationale, rounds and findings, gate trajectory, lenses run. Honesty-by-construction: the body shows the scrutiny envelope (e.g. "skeptic lens: not run — M profile") instead of implying blanket coverage, countering review-dilution risk.

## Risks / Trade-offs

- Reviewer self-leniency (same base model) → resolver separation + evidence quoting + ledger; skeptic lens in L. Residual risk accepted.
- Gate automation bias → one-screen digest cap, blast-ranked; cannot be engineered away.
- Gate input ambiguity → checkbox protocol + validated `gate-response.json` with line-naming errors; never guess.
- Depth misclassification → `--depth` expected path; estimator rationale + disagreement surfacing at the gate; escalation-only.
- Sidecar/spec drift → zod schemas + contract tests pinning finding/resolution/assumption/event/gate-response shapes.
- Reuse coupling (D14) → same-repo; loud failure via both test suites.
- Renderer complexity (live-block height with 6-stage map + slots) → cap slot lines, fold completed stages; worst case matches today's renderer.
- Cost/latency: ~2 agent runs per round + stage runs; bounded by caps; S skips estimation and most review.
- Fast convergence on the wrong thing → intake restates scope in proposal.md; gate shows it.

## Migration Plan

Purely additive: new workspace + forked schema + wrapper commands + doc rows. Rollback = delete them; stock workflow untouched. Dogfood ladder: first real run at S profile (via `--depth`), then M, before any L. Register `sdd-runner` in root `package.json` workspaces/scripts and extend TDD mappings before the first src file lands (test-first from task 1).

## Open Questions

None blocking. D1's three CLI-tolerance probes have pre-chosen fallbacks; answers slot into schema layout without changing specs, approach, or task breakdown.
