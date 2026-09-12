# Design — sdd-run-artifact-analysis

## Context

See proposal.md. Current constraints: `replay.ts` already folds `events.ndjson` to `ReplayState` (the analyzer is another consumer, not a new fold engine); `usage-aggregate.ts`/`pricing.ts` provide the reprice seam; `report.ts` is the per-run presentation precedent (DI: `readEvents`/`readChangeDir`/`execGit` injected); run dirs live per-worktree (`.sdd-runner/runs/*`), corpora span worktrees; `cli-routing.ts` owns the start-script argument table; the repo's duplicates gate means the analyzer's folds must not re-implement replay logic.

## Goals / Non-Goals

**Goals:** one module answering the corpus questions as pinned queries; read-only by construction; multi-workdir; degraded-graceful over old runs; JSON + human output.

**Non-Goals:** fixes (sibling changes), monitoring/scheduling, LLM-response analytics, writing anything.

## Decisions

### D1 — Layer: pure query functions over `ReplayState` + sidecar joins; no second event fold

`analyze.ts` composes: (1) `readEvents` → `ReplayState` per run (existing fold), (2) sidecar joins (`findings-*.json` ⇄ `resolutions-*.json` ⇄ `depth.json` ⇄ `auto-policy.jsonl`), (3) artifact/git joins per change folder. Each metric is a pure function `(replay, sidecars) → metric`; the corpus aggregate is a reduce over per-run results. The loop-memory change's `concerns` fold and fingerprint field arrive as additive inputs the same metrics consume. Alternative rejected: a dedicated analysis event schema — duplicates `replay.ts`, trips the duplicates gate, and breaks on old logs the fold already handles.

### D2 — Read-only enforced by seam shape, not discipline

The injected fs is `{ readFile, readdir, stat }` — no write functions exist on the type, so the no-write contract is a typecheck, pinned by a test asserting the seam type lacks write members (and a corpus smoke run under a tmpdir copy). `execGit` is limited to `log`/`ls-tree` invocations by a wrapper that rejects other subcommands. Alternative rejected: chmod/RO-mount tricks — nonportable theater; types + pins are the repo's DI idiom.

### D3 — Metrics named after the forensics they replace

Each corpus query from this exploration becomes a metric with its evidence pedigree: `duplicateIdRate`, `lensOverlapRate`, `concernPersistence` (clusters ≥2 rounds / findings), `classChurn`, `resolverActionMix`, `gateLatency` (incl. never-answered with age), `extendOrigin` (human vs R2 vs waiter), `retryTaxonomy`, `r2EligibilityRate`, `routingRates` (post oversize change), `strandedComplete` / `mergedUnimplemented` (ground-truth join), plus `decisionConsistency` and `eraContamination` from the round-3 forensics: the trilogy's parent run answered gates 2–5 without presented ancestors, completed after two ABORTs, and left `.bak` residue — the exact signatures the consistency audit exists to catch, so that run (and its dogfooding siblings) become the fixture set and get excluded from corpus aggregates rather than silently skewing them. Pre-change runs report `unknown` per metric where the needed events/fields don't exist — the graceful-degradation requirement. Alternative rejected: generic "metrics framework" — the value is the specific questions; the module grows by adding named pure functions.

### D4 — CLI: `analyze` subcommand on the start script, JSON via `--json`

`cli-routing.ts` treats a first argument of `analyze` as a distinct route (spec delta in `sdd-runner-cli`), remaining args are workdir paths (default: the config's workDir), `--json` switches output. Human output is plain sections per metric (no ANSI — the LineRenderer TTY lesson inverted: analysis output is piped by nature). Alternative rejected: a separate `sdd-runner:analyze` package script — fragments the single-entry contract the subcommand cutover established.

### D5 — No new dependencies

Stdlib fs/path, existing `replay.ts`/`pricing.ts` seams, plain console rendering. Fingerprinting for `concernPersistence` reuses the loop-memory change's `fingerprintOf` once it lands (import, not copy — duplicates gate); until then the metric reports unknown. JSON via `JSON.stringify` — no table/chart libraries.

## Hook / TDD interaction

New files gate through the TDD pipeline: `tests/sdd-runner/analyze.test.ts` (metric functions over fixture runs — corpus-derived: the fix-command r3 dup sidecars, kb trajectory events, the trilogy's waiter-settled final gate), `analyze-io.test.ts` (seam type pins, degraded parsing, multi-workdir), `cli-routing.test.ts` extension (`analyze` route). Fixtures are committed synthetic minimal logs shaped from the corpus, not copies of real run dirs.

## Risks / Trade-offs

- [Corpus contains secrets in transcripts?] → the analyzer reads events/sidecars/state/gate files and git metadata only; transcripts are summarized by their L0 events, not re-parsed content. Report output inherits run-ids and change names (public repo data), never token/session ids.
- [Cross-workdir paths rot] → workdirs are explicit arguments; the default covers the common single-worktree case.
- [Metric sprawl] → D3's named-question rule caps growth; a metric without a decision it informs gets deleted.

## Migration Plan

Additive module + one CLI route. No run-state, event, or config changes. Deploy = merge; rollback = revert, nothing persisted. The first real corpus report (the 14 runs across 8 worktrees) is the acceptance run, compared against this exploration's hand-measured numbers.
