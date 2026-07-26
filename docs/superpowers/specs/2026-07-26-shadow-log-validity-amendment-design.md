<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shadow-log P1 validity argument — pre-collection amendment

**Date:** 2026-07-26
**Target:** `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`
**Scope:** rationale prose only. No frozen number moves. No file under `src/` or `scripts/` changes.

## Problem

The shadow-logging design pre-registers a decision gate (frozen 2026-07-25) whose headline metric is
**bucket 3** — `shadow_hit && !model_pulled`, the under-trigger rate — with a stop threshold of
`< 5%` of memory-bearing turns.

The doc justifies that gate by claiming the measurement is a **conservative lower bound** on the real
gap, and claims the loose `shadow_hit_count >= 1` hit criterion *reinforces* that reading. That is
directionally wrong. A looser hit criterion admits more turns into bucket 3's numerator, which pushes
the measured rate **up**, toward the `>= 5%` escalate branch. It is an inflating threat, not a
floor-reinforcing one.

Tracing the claim, the error appears at four sites and is seeded by a fifth:

| Site | Lines | Claim | Status |
| --- | --- | --- | --- |
| A | 67–70 | raw-turn query means measured <= real | correct, but stated unconditionally — seeds the rest |
| B | 214–219 | loose hit criterion "reinforces" the lower bound | **wrong — inflating** |
| C | 236–239 | "below-threshold → the real gap is <= the measured floor" | **wrong — attributes the stop signal to the floor half, which pushes the other way** |
| D | 244 | "P1 proves the gap" | over-claims given the inflating threats |
| E | 250–255 | threats list repeats site B verbatim | **wrong — same defect** |

Site C is the most consequential: it credits the strength of the stop branch to the raw-turn floor,
but the floor argument yields `measured <= real`, so it cannot bound the real gap from above. Only
the inflating threats support the reading that paragraph asserts.

## Why now

`MEMORY_SHADOW_LOG_ENABLED` gates all collection and requires an exact `'true'`
(`src/long-term-memory/shadow-log-config.ts:24`); it has not been set, and no rows exist in
`memory_recall_shadow_log`. Correcting a pre-registered protocol's rationale is legitimate **only**
before collection begins. After the first row lands, an edit to the validity argument is
indistinguishable from post-hoc goalpost-moving, regardless of intent.

## What the code actually measures (verified, unchanged)

The prose's operative definition is accurate; only its interpretation was wrong.

- `src/long-term-memory/shadow-funnel.ts:104` — `underTriggerTurns` is literally
  `shadow_hit_count >= 1 AND model_pulled = 0`. No rank-position filter, no per-channel logic.
- `src/long-term-memory/shadow-log.ts:99` — the shadow call passes no `limit`, so
  `runShadowRecall` falls through to `RECALL_DEFAULT_LIMIT` = 8 (`src/long-term-memory/recall-cascade.ts:14`).
  The rank cutoff is therefore k = 8, as the doc states.
- `src/long-term-memory/shadow-recall.ts` — the `ShadowRecallHit.score` doc comment already records
  that the score is rank-derived from the hit's **global** index across the concatenated
  `current` → `group` → `other-thread` list, and is not comparable across provenance values. This
  amendment keeps that consistent; nothing about it changes.

## Invariants — frozen, asserted unchanged

Sample rate `0.1` · `shadow_hit_count >= 1` · rank cutoff k = `RECALL_DEFAULT_LIMIT` = 8 ·
bucket-3 stop threshold `< 5%` · N = 1000 · M >= 50 distinct scopes · `overPullTurns` excluded from
the gate.

If review of the corrected ledger changes anyone's judgement about whether 5% is the right line, that
is a **separate decision** and must be taken before collection starts. It must not be folded into
this edit.

## Design

Replace the lower-bound framing with a **signed threat ledger** — each threat labelled with the
direction it pushes bucket 3 — and recast the gate as **screen-and-adjudicate**.

The ledger has one deflating threat and two inflating ones, so no one-sided bound survives:

| Threat | Direction on bucket 3 |
| --- | --- |
| Floor underestimate (raw-turn query < derived query) | down |
| Looser hit criterion (`>= 1` within top-8, no per-channel filter) | up |
| Profile already covers it (layer A/B answered; a non-gap) | up |
| Selection bias (hash sampling + M-distinct-scopes floor) | neutral |

The net is indeterminate a priori. The gate readings follow from that, not from a bound:

- **`< 5%` → stop.** The measured rate read low *despite two threats lifting it*. Shelve
  `deriveInjectionQuery`; do not build P2 or Tier 3. Tier 2 stands.
- **`>= 5%` → escalate to P2.** P1 is content-free and therefore structurally cannot separate a real
  gap from a turn the profile already answered. That separation is exactly what P2's offline judged
  corpus performs. P1 screens; P2 adjudicates.

This preserves the two-phase structure's logic rather than merely disclosing a flaw: the dominant
inflating confound is the specific reason P2 exists.

## Edits

**A — line 67–70, scoping clause.** Append to the existing "lower bound on the real gap" sentence:
the bound holds *with respect to query quality*, cross-referenced to the threat ledger for the
offsetting inflating threats. The premise section is otherwise untouched.

**B — lines 214–219, the reported defect.** Replace the "reinforces … now for two independent
reasons" passage with its actual sign: the looser criterion admits more turns as shadow hits, which
**inflates** bucket 3 and pushes the measured rate toward the escalate branch; it works against the
floor reading rather than reinforcing it.

**C — lines 236–239, summary paragraph.** Replace with the screen-and-adjudicate reading above,
dropping the claim that the real gap is `<=` the measured floor.

**D — line 244.** "P1 proves the gap; P2 proves closing it does not fabricate" → "P1 **screens** for
the gap; P2 adjudicates it and proves closing it does not fabricate."

**E — lines 250–255, threats to validity.** Restructure the existing entries into the signed ledger:
same threats, each gaining an explicit direction marker, with the "looser hit criterion" text
corrected from "reinforcing" to "inflating". Add one line stating the net is indeterminate. The
"profile already covers it" entry is already correctly signed and keeps its wording.

**F — new amendment note, decision-gate section.** Dated block recording: amended 2026-07-26; zero
rows collected at amendment time, with the `shadow-log-config.ts:24` flag citation; every frozen
number enumerated and asserted unchanged; scope limited to rationale text. The note exists so a
reader holding only the spec — six weeks from now, evaluating a funnel result — can verify the gate
did not move without consulting `git log`.

## Verification

- Re-grep the target doc for surviving unqualified "lower bound" / "conservative floor" claims.
- Confirm the prose criterion still matches `shadow-funnel.ts:104`, and k = 8 via
  `shadow-log.ts:99` → `recall-cascade.ts:14`.
- Confirm no file outside the target doc is modified. No source or test file is touched, so no
  behavioural suite is implicated.

## Out of scope

Changing any threshold or the hit criterion; per-channel rank filtering (unrecoverable after the
fact — the persisted row keeps only the single global-top hit); folding `overPullTurns` into the
gate; any change to shadow-recall or funnel behaviour.
