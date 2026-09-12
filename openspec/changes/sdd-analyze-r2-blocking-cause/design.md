# Design — sdd-analyze-r2-blocking-cause

## Context

See proposal.md — the gap investigation's decomposition (9 cost-unknown, 2 preview, 0 fired across 11 eligible states) was derived entirely from data the analyzer already loads: `convergence` pairs, `round_open` caps, `gate` presented events, `auto_decision` records, and the usage join's `costKnown`. Current constraints: `r2EligibilityRate` (`analyze-findings.ts:117`) computes the trajectory predicate over convergence pairs; `analyze-report.ts:85` renders `eligible/gateStates`; `analyze-corpus.ts` aggregates; the `sdd-run-artifact-analysis` capability spec (unarchived change) owns the report contract; the auto-policy ladder (`auto-policy.ts:272` `evaluateCapHit`) defines the cause semantics being attributed.

## Goals / Non-Goals

**Goals:** one read of the report answers "why didn't R2 fire"; classification is deterministic from already-loaded events; old runs degrade to unknown, not error.

**Non-Goals:** policy/ladder changes (investigation verdict: correct by design, 11/11 human agreement); emit-time branch disambiguation in R4 events (digest is a hash — classification joins `costKnown` instead); human-latency forensics (already covered by gate forensics).

## Decisions

### D1 — Cause classification = per-state join of gate events to costKnown

For each cap-hit state (the same convergence-pair enumeration `r2EligibilityRate` walks today), find the first early-mode `gate` presented event after the convergence, then its `auto_decision` records for that gate version. Attribution order:

1. an auto_decision with `decision: 'extend'` naming R2 → `r2-fired`
2. a presented auto_decision naming R4 → `costKnown ? 'over-ceiling' : 'cost-unknown'`
3. any auto_decision with `decision: 'preview'` → `preview` (rule named, not permitted to act)
4. trajectory predicate fails → `trajectory-blocked` (existing non-eligible bucket, now explicit)
5. no presentable records for the state → contributes to the run's reduced-coverage unknown

Alternative rejected: hashing branch detail into future `evidenceDigest` values — changes the policy surface to fix an analyzer question; the `costKnown` join answers it without touching the ladder.

### D2 — Metric shape: extend `R2Eligibility` additively

`r2Eligibility` keeps `{eligible, gateStates}` and adds `byCause: Record<Cause, number>` (only nonzero causes serialized in JSON; the report line prints causes in a fixed order). Corpus aggregate sums per-cause counts across runs that have a known metric. `Metric<unknown>` semantics unchanged: a run with zero attributable states keeps today's unknown reasons verbatim. Alternative rejected: a separate top-level `r2Causes` metric — two metrics reporting one phenomenon invite divergence between ratio and causes.

### D3 — Report rendering: one line, parenthesized breakdown

Per run: `r2 eligibility: 2/5 (cost-unknown ×3)` — causes only when the run has any. Corpus: extend the existing `r2 eligible:` aggregate line with the same parenthesized mix. No new section: the breakdown is the answer to "why not more", which is the question the line already raises.

## Hook / TDD interaction

`tests/sdd-runner/analyze.test.ts` red first: cause classification over synthetic event sequences covering each branch (extend-fires, R4-on-cost-unknown, R4-on-cost-known, preview, trajectory-blocked, era run with no records → unknown), then report/JSON shape pins, then corpus aggregation. Fixtures mirror the investigation's real runs (kiss-help preview pair; cost-unknown extend-by-human rows).

## Risks / Trade-offs

- [Gate-version pairing by event order] — the state→gate join uses presentation order (first early gate presented at/after the convergence), the same pairing the hand investigation used and the forensics' presented/answered maps already encode; a mismatched pairing shows as a cause that disagrees with the eligibility ratio, visible in the same line.
- [Cause names drift from ladder vocabulary] — `cost-unknown`/`over-ceiling` name R4's two branches verbatim (`auto-policy.ts` comments); if the ladder renames a branch, the analyzer follows in the same change (one-file coupling, called out in tasks).

## Migration Plan

Read-only surface; no state, no events, no sidecars. Old reports' ratio semantics unchanged — the breakdown is additive. Rollback = revert.
