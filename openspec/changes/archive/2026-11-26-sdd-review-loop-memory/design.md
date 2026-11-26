# Design — sdd-review-loop-memory

## Context

See proposal.md — the corpus evidence. Current state that constrains the approach: `mergeLensFindings` (`review-model.ts:35`) dedupes on exact `gap|question` text (measured dead in practice); finding ids are per-lens, un-namespaced (`F<n>` from the prompt's JSON shape line); `ResolverOutputSchema` (`review-loop.ts:28`) does not constrain id uniqueness; `readResolutionsLedger` flattens prior rounds' sidecars and `ledgerLines` renders them round-untagged; `materialize.ts` renders review.md/assumptions.md from the round's sidecars; `evaluateConvergence` counts resolution entries by class (duplicates included). The `replay.ts` fold is the established place for cross-round state (`ReplayState.children` precedent).

## Goals / Non-Goals

**Goals:** merge and convergence invariant to lens duplication; a ledger a fresh reviewer can recognize concerns from; a mechanical exit for thrashing concerns; cross-artifact disagreement surfaced as a finding. Old event logs replay unchanged (additive fields only).

**Non-Goals:** prompt-lens redesign, model changes, gate grammar changes, artifact snapshot retention (declined in proposal), the R4/budget and oversize-routing changes (sibling changes).

## Decisions

### D1 — Fingerprint = normalized token multiset, not embedding similarity

`fingerprintOf(gap)` = case-folded, punctuation-stripped, stopword-pruned token set (the same normalization the corpus analysis used, where re-raised concerns measured at 1.0 Jaccard while distinct findings sat far below). Dedup/cluster identity = fingerprint equality on the token *set* (not sequence), which caught every corpus re-raise and no false pair. Corpus measurement (134 skeptic findings, 31 rounds): only 16 (12%) re-quote the reviewer — 88% of skeptic output is unique discovery, ~69% of it material-or-worse — so the lens earns its ~29% loop-token share and namespacing (not removal) is the right treatment; the fingerprint dedup fixes a 12% tax, while most id collisions are distinct concerns sharing ids, which is what makes namespacing load-bearing. Alternative rejected: fuzzy thresholds (0.45 Jaccard) — needed only when linking *paraphrased* concerns; the spec's recognition duty is met by exact-fingerprint matching plus the digest, and thresholds invite tuning debt. Paraphrase-linked concerns remain a reviewer job via the digest.

### D2 — Skeptic namespacing via prompt + schema, merge severity by class rank

The reviewer/resolver prompt JSON-shape lines change to name the skeptic's id contract (`"id": "S<n>"`); `FindingSchema` stays string-keyed (no regex — reviewer ids keep `F`), but `FindingsSidecarSchema` for the skeptic spawn is wrapped with a `.refine` asserting the `S` prefix, so a mis-namespaced skeptic sidecar fails validation and retries. `mergeLensFindings` keeps first-wins ordering for the finding *content* but the merged class is `max` by severity rank (BLOCKER > MATERIAL > NITPICK). Alternatives rejected: renaming ids at merge time (`F7` → `F7a`) — breaks the resolver's ability to echo ids and the ledger's readability; a global run-scoped id allocator — changes the reviewer contract for no measured need.

### D3 — Uniqueness at the resolver schema, dedup before convergence

`ResolverOutputSchema` gains `.refine` (id uniqueness within `resolutions`). The retry-with-error path already exists (`agent-layer.ts` validation retry). `runRound` computes convergence over the merged distinct list joined to resolutions (id → single entry), which is what "Convergence counts distinct findings" pins. Alternative rejected: repairing duplicates in code silently — the resolver must learn the contract; silent repair hides the failure the corpus exposed.

### D4 — Ledger digest replaces the flat list, capped by concern not by line count

`ledgerLines` is replaced by `concernDigest(ledger)`: group resolutions by fingerprint, render one line per concern — `r<last> [<id>] <class> <resolution> — <note> (seen r<first>..r<last>)` — ordered by last-seen round, capped at the compiled `LEDGER_DIGEST_MAX` concerns (older concerns collapse into a one-line overflow note). The full flat ledger is not embedded anywhere; the digest is the prompt surface. Alternative rejected: keeping flat lines with round tags only — measured failure mode (97 lines) is a *volume* failure, tags alone do not fix volume.

### D5 — Concern tracking lives in a sidecar + replay fold, detection in the orchestrator

`sidecars/concerns.json` (additive, run-scoped) records per-fingerprint history: `{ fingerprint, firstRound, lastRound, entries: [{round, id, class, resolution, outcome}] }`, maintained by the review loop at each round close. `ReplayState` gains `concerns` seeded by the first `finding` events carrying an additive `fingerprint` field (old logs fold to empty concerns). Detection rule (compiled, not config): fingerprint with ≥2 prior resolved/dismissed entries raised again → present the concern-history gate (early-gate variant; existing grammar, rows are the recurring findings, plus a rendered history block in the digest). Class oscillation (resolved at class X, re-raised at class Y ≠ X) triggers the same gate. The gate is the orchestrator's `runPostReviewToGate` sibling branch — no new gate mode enum value. Alternative rejected: a new `'thrash'` gate mode — ripples every `mode` mirror (the decomposition D8 lesson) for zero grammar benefit.

### D6 — Consistency check is a deterministic pre-review pass, not an agent

At round close (after resolver, before materialize), a pure function scans proposal/design/specs for shared decision terms whose renderings disagree. Seed vocabulary compiled (migration strategy, interval/ms values, table/column names, file paths referenced by ≥2 artifacts); a disagreement becomes a synthesized MATERIAL finding injected into the next round's findings with both quotes and file paths. Deterministic — no spawn, no tokens. Alternative rejected: a dedicated checker agent — the corpus cases (drizzle vs hand-written) are mechanically detectable; agents are for judgment, and a checker spawn per round is spend the corpus shows is unnecessary. Seeded-term approach acknowledged as incomplete (generality declined; analyzer measures false-negative rate before any widening).

### D7 — Gate finding rows carry gap text via id→gap join

`findingsOf` (`gate-digest.ts`) today hardcodes `gap: entry.id` for every finding row — the gap text is lost when the resolver sidecar replaces the findings sidecar, so every gate file renders `- [x] F13 F13` (corpus fixture: the trilogy run's `gate-6.md`; the defect is universal, the waiter merely made it visible). With 1.3's unique resolution ids, the digest joins each resolution back to its finding's gap excerpt by id — unambiguous by construction. Alternative rejected: carrying gap text inside the resolution schema — widens the resolver's sidecar contract to re-echo input it was given.

## Hook / TDD interaction

`sdd-runner/src/*.ts` files map to `tests/sdd-runner/<file>.test.ts` (TDD hook pipeline). Red-first order: `review-model.test.ts` (fingerprint, merge severity, digest) → `agent-layer`/`review-loop` tests (schema uniqueness, namespaced skeptic refine) → `materialize` tests (consistency check) → `events`/`replay` tests (additive fields, old-log pins) → gate digest/render tests (concern-history block). Old-sidecar and old-log fixtures from the corpus (kb run paths, fix-command r3 sidecars) pin the measured defects as failing-first tests.

## Risks / Trade-offs

- [Fingerprint equality misses paraphrased re-raises] → the digest still exposes them to the reviewer; the analyzer measures the miss rate before any threshold work.
- [Concern-history gate adds a new human interrupt] → it fires only on measured-thrash signatures (≥2 prior resolutions), which the corpus shows are pathological, not normal tails.
- [Seeded consistency vocabulary too narrow] → declined generality is explicit (D6); widening is data-driven via the analyzer.
- [Skeptic prefix refine rejects a misbehaving model repeatedly] → bounded by the existing two-attempt validation retry, then loud failure, exactly like any sidecar contract violation.

## Migration Plan

No DB, no config keys, no event removals: additive sidecar (`concerns.json`), additive event fields (`finding.fingerprint`), schema refines that only reject shapes the corpus shows are defects. Old runs resume unchanged (their logs have no fingerprints; folds seed empty concerns). Rollback = revert; no on-disk state written by this change blocks an older checkout.
