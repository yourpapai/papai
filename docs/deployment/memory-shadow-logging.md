<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory-recall shadow logging — operator runbook

## What enabling means

`MEMORY_SHADOW_LOG_ENABLED` is not a feature toggle. Setting it starts **collecting data
against a study protocol that was pre-registered on 2026-07-25 and is frozen**
([design doc](../superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md)).

The study measures one thing: when a user's stored memory *would* have been relevant to a
turn, does the model actually go looking for it? On a sampled fraction of turns it runs a
shadow memory search alongside the real turn, records what that search would have found,
and records whether the model itself pulled memory. The gap between the two is the
**under-trigger rate**, and a pre-registered rule decides what happens next.

Enabling is a **per-deployment opt-in**. The deployment that turns it on is the one running
the study and reporting its result.

## What gets recorded

Hashes, counts, and enum buckets only — no query text, no memory content, no record bodies.
The schema is `memory_recall_shadow_log`
(`src/db/long-term-memory-schema.ts`); a schema test asserts the row carries nothing
free-form.

**Cost note.** The shadow search reuses an unindexed O(N) scan. Sampling and the
zero-active-record precondition bound it, but deployments with large memory scopes should
watch load after enabling.

## How to enable

```bash
MEMORY_SHADOW_LOG_ENABLED=true
```

**The value must be exactly `true`.** `1`, `TRUE`, `True`, and `yes` all leave the study
**disabled**, and nothing is logged to tell you so (`isShadowLoggingEnabled`,
`src/long-term-memory/shadow-log-config.ts`).

So the step after enabling is verifying rows actually arrive:

```bash
sqlite3 "$DB_PATH" 'select count(*) from memory_recall_shadow_log'
```

Expect a non-zero count after enough traffic to clear the sample rate. A count stuck at
zero means either the variable is not exactly `true`, or no sampled turn has had active
memory records yet.

## Sample rate

`MEMORY_SHADOW_LOG_SAMPLE_RATE` defaults to `0.1` — and `0.1` is also the **pre-registered
rate**. The shipped default and the frozen protocol are the same number by design, so the
correct action is to leave this variable unset.

Overriding it is a **departure from the pre-registered protocol**. A deployment that does so
must record the departure explicitly alongside any funnel result it reports.

Sampling is deterministic — derived from a keyed hash of `(storage-context-id, turn-ordinal)`,
not `Math.random` — so the same turn always makes the same in/out decision across restarts.

## Reading the funnel

```bash
bun run memory:shadow-funnel                          # all reader models
bun run memory:shadow-funnel --reader-model-id <id>   # one model
```

Output is **one block per reader model, never pooled**. Pull propensity is model-dependent,
so a cross-model average would look authoritative while hiding the exact variance the
decision depends on.

Before any rows exist (or while shadow logging is disabled), the script prints exactly this
and nothing else:

```
No shadow-log rows found (shadow logging may be disabled, or no turns sampled yet).
```

Once rows exist, each reader model gets a block shaped like this (the numbers below are
illustrative, not real collection data):

```
reader_model_id: model-x
  memory-bearing turns:      1024 (meets the pre-registered N = 1000)
  shadow_hit turns (rank>=1): 402
  under-trigger turns:       71
  under-trigger rate:        6.93%
  overlap-when-pulled turns: 240
  over-pull turns:           62
  distinct scopes (M):       58 (meets the pre-registered M >= 50)
```

- **memory-bearing turns** — sampled turns where the scope had at least one active record.
  The denominator, and the **N** of the gate. Rendered with an inline marker —
  `(meets the pre-registered N = 1000)` or `(below the pre-registered N = 1000)` —
  computed by `formatTurnsMarker` (`src/long-term-memory/shadow-gate.ts`).
- **shadow_hit turns** — turns where the shadow surfaced anything within the cascade's own
  top-8 window. A rank cutoff, not a relevance score.
- **under-trigger turns / rate** — the shadow had something and the model never looked.
  **This rate is the headline.** Deliberately printed with no marker; see the stop
  conditions below.
- **overlap-when-pulled** — the model pulled and found some of what the shadow found. High
  overlap means the records are genuinely valuable.
- **over-pull turns** — the model pulled and found none of what the shadow found. A
  companion signal only; **not part of the gate**. This count is not a pre-registered or
  spec-numeric threshold — it is this repo's own operationalization of a signal the design
  doc describes only qualitatively.
- **distinct scopes (M)** — distinct scopes among memory-bearing turns, so no single chatty
  user or group decides the outcome. Rendered with an inline marker —
  `(meets the pre-registered M >= 50)` or `(below the pre-registered M >= 50)` —
  computed by `formatScopesMarker`. Scopes that only ever produced zero-record turns are
  excluded.

The script also prints three footnotes after the per-model blocks, restating: that
`shadow_hit` is a rank cutoff and not a relevance-score threshold; that over-pull turns sit
outside the frozen gate; and that the two preconditions (N, M) are mechanical and marked
inline while the under-trigger rate is deliberately left for the operator to read against
the design doc's threats-to-validity ledger.

### Why the under-trigger rate carries no marker

Every other gate quantity above gets a `meets`/`below` marker because those are plain `>=`
comparisons a script can render safely. The under-trigger rate does not, on purpose: P1
*screens* for the gap between what a shadow search would have found and what the model
actually pulled; a human *adjudicates* the resulting go/no-go call against the recorded
threats to validity. Printing `PASS`/`FAIL` — or any marker at all — next to the 5% branch
would hand that judgment to a script and make a later change to the threshold
indistinguishable from post-hoc goalpost-moving. Read that branch yourself, against the
design doc, every time.

## Stop conditions

> These restate the frozen protocol. **The design doc is authoritative** — if this section
> and the design doc ever disagree, the design doc is right and this page is what needs
> fixing. Do not edit the numbers here.

**Collect until**, per reader model: **N = 1000** sampled memory-bearing turns across
**M >= 50** distinct scopes. Both are rendered inline in the report. Until both read
`meets`, the under-trigger rate for that model is not yet trustworthy and no branch below
applies to it.

**Then, on the under-trigger rate:**

- **Below 5%** — the model's own pulling covers the ground. Shelve `deriveInjectionQuery`;
  **do not build P2 or Tier 3.** Tier 2 stands.
- **At or above 5%**, *and* the overlap signal shows those records are the ones the model
  values when it does look — a real gap of valuable records exists. Build the abstention
  harness (P2) to test whether auto-injecting them is *safe* before any Tier 3 ship.

**The gate is a screen, not a proof, and the call is yours to make.** The report renders the
two mechanical preconditions but never the 5% branch, because reading that branch requires
the recorded threats to validity: the raw-turn shadow query pushes the measured rate **down**,
while the loose hit criterion and the "profile already answered it" confound push it **up**.
The net bias is indeterminate. Read the threats-to-validity section of the design doc before
acting on either branch.

## When to turn it off

This is a study instrument, not permanent telemetry. Once the reader models you care about
have reached N and M and you have recorded their rates, unset
`MEMORY_SHADOW_LOG_ENABLED` and reclaim the sampling cost.
