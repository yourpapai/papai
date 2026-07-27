<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shadow-funnel dry-run and collection runbook — design

**Date:** 2026-07-27
**Status:** approved, not yet implemented
**Related:** [`2026-07-24-memory-recall-shadow-logging-design.md`](2026-07-24-memory-recall-shadow-logging-design.md) (authoritative for the pre-registered protocol), [`2026-07-26-shadow-log-validity-amendment-design.md`](2026-07-26-shadow-log-validity-amendment-design.md)

## Problem

P1 — the memory-recall shadow-logging instrument — is built, tested, and dormant. No
deployment has set `MEMORY_SHADOW_LOG_ENABLED`, and `memory_recall_shadow_log` holds no
rows. Everything downstream in the injection thread is blocked on data nobody has started
collecting.

Two things stand between here and flipping the switch.

**The read-out has never run against data.** `computeShadowFunnel` has unit coverage, but
`bun run memory:shadow-funnel` has never been executed and its output never read. A wrong
or misleading report discovered after a full collection cycle costs the cycle.

**Enabling has no procedure attached.** Setting one environment variable starts a study
against a protocol frozen on 2026-07-25. Nothing currently tells an operator that the
sample rate is a pre-registered quantity, when to stop collecting, or how to read the
result.

## Goals

- Validate the read-out path end-to-end — fixture rows through the real writer, through
  the real CLI, asserted against real stdout — without waiting on production.
- Make enabling collection a decision rather than an accident.

## Non-goals

- Enabling collection. This design ends with an operator able to make that call, not with
  the call made.
- Exercising the write path under load: sampling, off-hot-path behavior, and large-scope
  cost have their own coverage and are out of scope here.
- Any change to a pre-registered quantity. Nothing in this document moves a threshold,
  a sample rate, or a collection target.

## Design

### 1. Precondition markers in the report

The CLI currently prints M as a bare number followed by a footnote asking the operator to
compare it against 50 by eye. N = 1000 appears only inside that footnote. Both comparisons
are mechanical, and both are re-derived by hand on every run — which is where a misread
creeps in.

**New module `src/long-term-memory/shadow-gate.ts`:**

```
SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS = 1000   // N
SHADOW_GATE_MIN_DISTINCT_SCOPES = 50             // M
formatPreconditionMarker(value, threshold, label): string
```

The formatter returns `(below the pre-registered M >= 50)` or
`(meets the pre-registered M >= 50)`. Descriptive only — never `PASS`, `FAIL`, or any
word that reads as a verdict.

Both preconditions are `>=`, so a value exactly equal to its threshold reads `meets`.

The module carries a doc comment recording that the bucket-3 5% threshold is **deliberately
absent** and must not be added: the spec is explicit that P1 screens while a human
adjudicates, and a threshold constant living in code invites a later edit that is
indistinguishable from goalpost-moving.

Its own module rather than inline constants in the script, for two reasons. The pre-registered
quantities end up in one named, unit-tested place, so "did anyone move a frozen number" is a
one-file question. And `shadow-funnel.ts` stays purely about aggregation: the funnel computes,
the gate module describes, the script prints.

**Modified `scripts/memory-shadow-funnel.ts`:**

```
  memory-bearing turns:      120 (below the pre-registered N = 1000)
  distinct scopes (M):       60 (meets the pre-registered M >= 50)
```

The three existing footnotes stay verbatim, except that the M footnote's instruction to
compare the count against 50 by eye is reworded — the comparison is now rendered, so the
instruction is stale. `underTriggerRate` gains no marker: the 5% branch stays with the
operator, read against the threats-to-validity ledger.

`shadow-funnel.ts` is unchanged. Its SQL and its `GROUP BY reader_model_id` are correct as
they stand.

**Modified `tests/utils/test-helpers.ts`:** export
`createMigratedDbFile(path: string): Promise<void>`, wrapping the existing private
`buildMigratedSnapshot`, so an integration test can hand a real migrated file database to a
subprocess. Test infrastructure only.

### 2. The dry-run

**New `tests/long-term-memory/shadow-funnel-cli.test.ts`.**

Flow: create a temp dir → `createMigratedDbFile()` writes a migrated SQLite file → open it
and seed fixture rows through the real `insertShadowLogRow` → close it → spawn
`bun run scripts/memory-shadow-funnel.ts` with `DB_PATH` pointed at the file → assert on
captured stdout.

Seeding through `insertShadowLogRow` rather than raw SQL means the dry-run exercises the
same write path production will use, so a column the writer sets wrongly surfaces here.
Closing before the spawn keeps WAL sidecar files out of the picture.

**Fixture** — three reader models, roughly 250 rows:

| model     | scopes (M) | memory-bearing turns | under-trigger | reads as                             |
| --------- | ---------- | -------------------- | ------------- | ------------------------------------ |
| `model-a` | 55         | 110                  | 4 → 3.64%     | preconditions met, below 5% → stop   |
| `model-b` | 52         | 104                  | 13 → 12.50%   | preconditions met, ≥ 5% → escalate   |
| `model-c` | 12         | 24                   | 6 → 25.00%    | M short — rate not yet trustworthy   |

Every branch of the read-out appears in a single run, and no pooling bug produces this
output by accident. Each model also carries `model_pulled` rows with and without shadow
overlap, so `overlapWhenPulled` and `overPullTurns` are non-zero and distinguishable.

Two traps are built into the fixture deliberately:

- **Zero-record scopes.** `model-a` gets rows on 5 further scopes that only ever produced
  `activeRecordCount = 0` turns. These must not appear in M — the spec requires that scopes
  contributing nothing to N do not inflate M, and the SQL guards it with a `case when`
  inside `count(distinct ...)`. Untested against the CLI, that guard is a comment.
- **Shared scope hashes across models.** `model-a` and `model-c` reuse the same
  `scope_hash` values. A globally-distinct scope count — the natural shape of a pooling bug
  — yields a visibly different M than the correct per-model count, so the trap springs only
  if counting is genuinely grouped.

Expected values are hardcoded literals in the test, not recomputed from the fixture
builder. Deriving them would re-run the arithmetic under test and assert it equals itself.

**Assertions**, ordered by what they catch:

1. Exactly three per-model blocks, ascending by `readerModelId`, and nothing resembling a
   pooled total or an all-models line. This encodes the never-average-across-reader-models
   rule as a test that fails loudly, rather than as a comment — a refactor that drops the
   `GROUP BY` would otherwise still print plausible-looking output.
2. All seven values per block, exact, including rate strings (`3.64%`, `12.50%`, `25.00%`).
3. Precondition markers on the correct side of each threshold: `model-a` reads `meets` on M
   and `below` on N; `model-c` reads `below` on M.
4. The three footnotes present verbatim, including the over-pull note disclaiming it from
   the gate.
5. A second spawn with `--reader-model-id model-b` yields exactly one block.

### 3. Operator runbook

**New `docs/deployment/memory-shadow-logging.md`**, sectioned in the order an operator
meets the decisions:

1. **What enabling means.** Not a feature toggle — it begins collection against a protocol
   frozen on 2026-07-25. Per-deployment opt-in; the deployment that enables it is the one
   running the study.
2. **What gets recorded.** Hashes, counts, and enum buckets only — no query text, no memory
   content. Includes the cost note from the threats ledger: the shadow reuses an unindexed
   O(N) scan, bounded by sampling and the zero-record precondition, but large-scope
   deployments should watch load.
3. **How to enable.** `MEMORY_SHADOW_LOG_ENABLED=true`, exactly — with the trap spelled
   out: `1`, `TRUE`, and `yes` all silently disable, with no warning logged. The step after
   enabling is therefore verifying rows appear, with the query to do it.
4. **Sample rate.** `0.1` is both the shipped default and the pre-registered rate.
   Overriding `MEMORY_SHADOW_LOG_SAMPLE_RATE` departs from the frozen protocol and must be
   recorded alongside any funnel result the deployment reports.
5. **Reading the output.** `bun run memory:shadow-funnel` line by line, including the
   precondition markers, and the standing rule that results are per reader model and never
   pooled.
6. **Stop conditions.** N = 1000 memory-bearing turns across M ≥ 50 distinct scopes, per
   reader model; then bucket 3 below 5% → shelve the injection work, at or above 5% with
   the overlap signal → escalate to P2.
7. **When to turn it off.** A study instrument, not permanent telemetry — off once the
   models of interest have read out.

Section 6 carries an explicit note that it **restates** the spec, and that the spec is
authoritative: if the two disagree, the spec wins and the runbook is what is wrong. A
runbook that looks editable, sitting next to numbers that are not, is a real hazard.

`docs/architecture/environment.md` gains a link to the runbook from its existing
shadow-logging paragraph.

## Testing

- Unit tests for `formatPreconditionMarker`: both sides of each threshold, plus the exact
  boundary (`M = 50` and `N = 1000` both read `meets`, since both preconditions are `>=`).
- The CLI integration test described in section 2.
- A manual run of `bun run memory:shadow-funnel` against the fixture database, read by a
  human — "the footnote reads right" is a judgment a test can only partly make.

## Risks accepted

- **The pre-registered numbers now live in three places** — spec, `shadow-gate.ts`, and
  runbook. Mitigated by cross-links and the authority note, not eliminated. Preferable to
  an operator eyeballing comparisons on every run.
- **The test asserts footnote text verbatim**, so intentional rewording breaks it.
  Deliberate: the footnotes carry the gate's caveats, and silent deletion should fail.
- **The dry-run proves the read-out, not the write path under load.** Sampling,
  off-hot-path behavior, and real-scope cost are covered elsewhere; the runbook's
  verification step closes the gap on first enable.
