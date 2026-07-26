<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shadow-log P1 Validity Argument Amendment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct a directional error in the frozen shadow-logging decision gate's validity argument — the doc claims a loose hit criterion reinforces a conservative lower bound when it actually inflates the headline metric — without moving any pre-registered number.

**Architecture:** Prose-only edits to one Markdown file, replacing "conservative lower bound" framing with a signed threat ledger (each threat labelled with the direction it pushes bucket 3) and a screen-and-adjudicate reading of the gate. A dated amendment note records that the edit happened before any data collection, which is the only thing that makes amending a pre-registered protocol legitimate.

**Tech Stack:** Markdown. No source code, no tests, no build step.

**Spec:** `docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md`

## Global Constraints

- **Target file:** `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`. No other file is modified except in Task 5, which touches only the 2026-07-26 spec.
- **No source or test file is edited.** If a task appears to require an edit under `src/` or `scripts/`, stop — that is out of scope and signals a misread.
- **Frozen quantities — must appear unchanged in the final document.** Sample rate `0.1` · `shadow_hit_count ≥ 1` · rank cutoff k = `RECALL_DEFAULT_LIMIT` = 8 · bucket-3 stop threshold `< 5%` · N = 1000 · M ≥ 50 distinct scopes · `overPullTurns` excluded from the gate.
- **Do not "improve" a threshold.** If the corrected ledger makes a threshold look wrong to you, that is a separate decision for the user, not part of this plan. Raise it; do not act on it.
- **Line numbers are anchors, not addresses.** They were accurate when this plan was written. Tasks 1–4 change line counts, so later tasks' numbers drift. Always locate edit sites by exact string match on the quoted "current text", never by line number alone.
- **Unicode is intentional.** The target doc uses `≥`, `≤`, `—`, and `_italics_`. Match the surrounding style; do not ASCII-fold.
- **No TDD in the usual sense.** There is no code under change, so there is no test to fail. The substitute red/green cycle is a grep that asserts the defective text is *present* before the edit and *absent* after. Run both halves — an edit that silently no-ops (wrong quoting, smart quotes, stale anchor) is the main failure mode here and the "red" grep is what catches it.
- **Commit after each task.** The repo runs a pre-commit hook (lint, typecheck, format:check, license-headers). Markdown under `docs/` passes all four provided the BUSL header is intact — do not remove it from either file.

---

### Task 1: Correct the inflating-threat sign

The reported defect. The claim that the loose hit criterion reinforces the lower bound appears in two places, stated independently. They must move together: correcting one leaves the document asserting both a claim and its negation.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md:214-219` (decision-gate "Consequence for validity")
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md:250-255` (threats-to-validity list, first two entries)

**Interfaces:**
- Consumes: nothing.
- Produces: the phrase `pushes bucket 3` as the ledger's direction marker (values: `**up**`, `**down**`, `**neutral**`), and the section name `Threats to validity`, both cross-referenced by Tasks 2 and 3.

- [ ] **Step 1: Confirm the defect is present (red)**

```bash
grep -n "reinforcing (not" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -n "now for two independent reasons" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: one match each (lines ~254 and ~218). If either returns nothing, the file has already been edited — stop and report.

- [ ] **Step 2: Replace the decision-gate "Consequence for validity" block**

Find this exact text (lines ~214–219):

```markdown
  **Consequence for validity:** this is a **looser** criterion than a top-3-per-channel filter
  would have been, so it makes bucket 3 (the under-trigger headline) **more inclusive** — more
  turns qualify as a "hit" than a stricter rank filter would allow. This is consistent with the
  doc's existing framing that P1 measures a conservative floor: an at/above-threshold bucket-3
  result remains a lower bound on the real gap, now for two independent reasons (the floor query,
  and this looser hit criterion) rather than one.
```

Replace with:

```markdown
  **Consequence for validity:** this is a **looser** criterion than a top-3-per-channel filter
  would have been, so it makes bucket 3 (the under-trigger headline) **more inclusive** — more
  turns qualify as a "hit" than a stricter rank filter would allow. That **inflates** bucket 3:
  it pushes the measured under-trigger rate **up**, toward the at/above-5% escalate branch. It
  therefore works **against** the conservative-floor framing in "Load-bearing consequence" above
  rather than reinforcing it — the floor query (a matter of query quality) and this hit criterion
  (a matter of rank looseness) push the measured rate in opposite directions. See "Threats to
  validity" below for the full signed ledger.
```

- [ ] **Step 3: Replace the first two threats-to-validity entries**

Find this exact text (lines ~250–255):

```markdown
- **Floor underestimate.** Raw-turn shadow < derived-query shadow. Conservative by design; noted so
  an at-threshold result is read as a lower bound.
- **Looser hit criterion.** `shadow_hit` is `shadow_hit_count ≥ 1` (any record within the cascade's
  top-`RECALL_DEFAULT_LIMIT` window), not a per-channel rank filter — see the decision-gate note
  above. This makes bucket 3 more inclusive than a stricter filter would, reinforcing (not
  undermining) the floor/lower-bound reading above.
```

Replace with:

```markdown
Each threat is labelled with the direction it pushes **bucket 3**, the headline under-trigger rate.
Two push it up and one pushes it down, so the net bias is **indeterminate a priori** and the
measured rate is not a one-sided bound on the real gap in either direction.

- **Floor underestimate** — pushes bucket 3 **down**. Raw-turn shadow < derived-query shadow: a
  smarter `deriveInjectionQuery` could only surface more, so some genuinely under-triggered turns
  never register as shadow hits at all and are lost from the numerator.
- **Looser hit criterion** — pushes bucket 3 **up**. `shadow_hit` is `shadow_hit_count ≥ 1` (any
  record within the cascade's top-`RECALL_DEFAULT_LIMIT` window), not a per-channel rank filter —
  see the decision-gate note above. More turns qualify as a hit than a stricter filter would admit,
  inflating the numerator relative to what a top-3-per-channel criterion would have produced. This
  works **against** the floor reading, not with it.
```

- [ ] **Step 4: Add direction markers to the two remaining signed entries**

Find:

```markdown
- **Profile already covers it.** The model may skip `search_memory` because layer A/B (summary /
```

Replace with:

```markdown
- **Profile already covers it** — pushes bucket 3 **up**. The model may skip `search_memory` because layer A/B (summary /
```

Find:

```markdown
- **Selection bias.** Deterministic hash sampling avoids time-of-day skew; the ≥ M-distinct-scopes
```

Replace with:

```markdown
- **Selection bias** — **neutral**. Deterministic hash sampling avoids time-of-day skew; the ≥ M-distinct-scopes
```

Leave the remaining entries ("Cost on large scopes", "Reader dependence") unchanged — they are operational notes, not bias directions on bucket 3.

- [ ] **Step 5: Verify the defect is gone (green)**

```bash
grep -c "reinforcing (not\|now for two independent reasons" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -c "pushes bucket 3" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -c "^- \*\*Selection bias\*\* — \*\*neutral\*\*" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: `0`, then `3`, then `1`. Three entries carry a directional push (down, up, up); the fourth is marked neutral and deliberately does not use the `pushes bucket 3` phrasing.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
git commit -m "docs(memory): sign the shadow-log threat ledger by direction on bucket 3

The loose shadow_hit_count >= 1 criterion was documented as reinforcing a
conservative lower-bound reading. It does the opposite: admitting more turns as
shadow hits inflates bucket 3's numerator and pushes the measured under-trigger
rate toward the escalate branch. Label each threat with the direction it pushes
bucket 3 and state that the net is indeterminate.

No pre-registered quantity changes."
```

---

### Task 2: Correct the gate reading

The summary paragraph is backwards in both halves: it credits the stop signal to the raw-turn floor, but the floor argument yields `measured ≤ real` and so cannot bound the real gap from above. Only the inflating threats support the reading it asserts.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md:236-239` (summary paragraph)
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md:234` (the "P1 proves the gap" clause, inside the "Proceed to P2" bullet)

**Interfaces:**
- Consumes: the `Threats to validity` ledger and its `pushes bucket 3` markers from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the defect is present (red)**

```bash
grep -n "the real gap is ≤ the measured floor" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -n "P1 proves the gap" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: one match each. The second is inside the "Proceed to P2" bullet, near line 234 — **not** line 244, which is the unrelated `overPullTurns` paragraph.

- [ ] **Step 2: Replace the summary paragraph**

Find this exact text (lines ~236–239):

```markdown
Because the shadow query is the raw-turn floor **and** `shadow_hit` is the looser
`shadow_hit_count ≥ 1` criterion (not a stricter per-channel rank filter), a below-threshold
bucket 3 is a strong stop signal (the real gap is ≤ the measured floor); an at/above bucket 3 is a
_lower bound_ worth escalating.
```

Replace with:

```markdown
The threats below push bucket 3 in **both** directions — the raw-turn floor query pushes it down,
while the looser `shadow_hit_count ≥ 1` criterion and the profile-already-covers-it confound push
it up — so the measured rate is **not** a one-sided bound on the real gap in either direction. The
gate is therefore a **screen, not a proof**, and each branch reads accordingly: a below-threshold
bucket 3 is a stop signal because the rate came in low **despite** two threats inflating it; an
at/above bucket 3 is a signal to **escalate**, because P1 is content-free and cannot by itself tell
a real gap from a turn the profile already answered. Separating those two is exactly what P2's
offline judged corpus does.
```

- [ ] **Step 3: Replace the over-claiming clause in the "Proceed to P2" bullet**

Find this exact text (line ~234):

```markdown
  ship. P1 proves the gap; P2 proves closing it does not fabricate.
```

Replace with:

```markdown
  ship. P1 **screens** for the gap; P2 adjudicates it and proves closing it does not fabricate.
```

- [ ] **Step 4: Verify the defect is gone (green)**

```bash
grep -c "the real gap is ≤ the measured floor\|P1 proves the gap" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -n "screen, not a proof\|P1 \*\*screens\*\*" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: `0` from the first command; two matches from the second.

- [ ] **Step 5: Confirm both frozen branch thresholds survived the edit**

```bash
grep -n "Bucket-3 stop threshold: < 5%" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -n "at/above 5%" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: one match each. Both must still read `5%`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
git commit -m "docs(memory): recast the P1 gate as a screen rather than a bound

The summary paragraph credited the stop signal to the raw-turn floor, but the
floor argument gives measured <= real and cannot bound the real gap from above.
State both branches in terms of the signed ledger instead: below-threshold stops
because the rate read low despite inflating threats, at/above escalates because
P1 cannot separate a real gap from a profile-answered turn -- which is what P2
adjudicates.

Both 5% branch thresholds unchanged."
```

---

### Task 3: Scope the premise's lower-bound claim

The premise section states the floor bound unconditionally. It is the sentence the corrected sites inherited the error from, and leaving it bare makes the new ledger contradict the design's own premise.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md:67-70` ("Load-bearing consequence")

**Interfaces:**
- Consumes: the `Threats to validity` section name from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the unqualified claim is present (red)**

```bash
grep -n "is a lower bound on the real gap" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: one match, at line ~69.

- [ ] **Step 2: Add the scoping clause**

Find this exact text (lines ~67–70):

```markdown
**Load-bearing consequence:** the shadow must be a **conservative floor**. If it uses the raw
user turn as its query (no derived query, no extra LLM call), a smarter `deriveInjectionQuery`
could only surface _more_. So a gap measured by the floor is a lower bound on the real gap — if
even the floor is small, Tier 3 is not worth building.
```

Replace with:

```markdown
**Load-bearing consequence:** the shadow must be a **conservative floor**. If it uses the raw
user turn as its query (no derived query, no extra LLM call), a smarter `deriveInjectionQuery`
could only surface _more_. So a gap measured by the floor is a lower bound on the real gap **with
respect to query quality** — if even the floor is small, Tier 3 is not worth building. This bound
is one-directional and is partly offset by inflating threats elsewhere in the instrument; it does
**not** make the measured under-trigger rate a lower bound overall. See "Threats to validity" for
the full signed ledger.
```

- [ ] **Step 3: Verify the qualification landed (green)**

```bash
grep -n "with respect to query quality" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
git commit -m "docs(memory): scope the floor bound to query quality

The premise stated the lower-bound claim unconditionally, which is where the
downstream over-claims came from. Qualify it and point at the signed ledger."
```

---

### Task 4: Add the dated amendment note

Without this, a reader holding only the spec cannot distinguish this edit from post-hoc goalpost-moving. It goes last because it asserts what the preceding three tasks did.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md:188-189` (insert immediately after the frozen-protocol paragraph in "Decision gate (pre-registered)")

**Interfaces:**
- Consumes: all preceding tasks — the note asserts their scope and outcome.
- Produces: nothing.

- [ ] **Step 1: Re-verify the empty-collection precondition the note will assert**

```bash
grep -n "MEMORY_SHADOW_LOG_ENABLED" src/long-term-memory/shadow-log-config.ts
```

Expected: the flag is compared against an exact `'true'`. This is a read-only check — do not edit the file.

If you have access to a deployed database, also confirm `memory_recall_shadow_log` holds zero rows. **If any row exists anywhere, stop and report it**: the amendment's entire justification is that no data was collected against the protocol yet, and the note must not claim otherwise.

- [ ] **Step 2: Insert the amendment note**

Find this exact text (lines ~188–189):

```markdown
**Pre-registered on 2026-07-25, before any collection.** Frozen-protocol discipline: these numbers
are fixed now and must not move once collection starts (no post-hoc goalpost-moving).
```

Replace with:

```markdown
**Pre-registered on 2026-07-25, before any collection.** Frozen-protocol discipline: these numbers
are fixed now and must not move once collection starts (no post-hoc goalpost-moving).

> **Amended 2026-07-26 — rationale text only, before any collection.** The validity argument
> originally claimed the looser `shadow_hit_count ≥ 1` hit criterion reinforced a conservative
> lower-bound reading of bucket 3. That was directionally wrong: a looser hit criterion admits more
> turns as shadow hits and so **inflates** bucket 3's numerator. The argument was replaced with the
> signed threat ledger under "Threats to validity" and the screen-and-adjudicate reading below.
>
> **No pre-registered quantity moved.** Sample rate `0.1`; `shadow_hit` criterion
> `shadow_hit_count ≥ 1`; rank cutoff k = `RECALL_DEFAULT_LIMIT` = 8; bucket-3 stop threshold
> `< 5%`; N = 1000; M ≥ 50 distinct scopes; `overPullTurns` excluded from the gate — all unchanged.
>
> **Precondition.** No data had been collected against this protocol at amendment time. Collection
> is gated on `MEMORY_SHADOW_LOG_ENABLED`, which requires an exact `'true'`
> (`src/long-term-memory/shadow-log-config.ts`) and had not been set;
> `memory_recall_shadow_log` held no rows. Correcting a pre-registered rationale is legitimate only
> before collection begins — after the first row lands, an edit to the validity argument is
> indistinguishable from goalpost-moving regardless of intent.
```

- [ ] **Step 3: Verify the note landed and every frozen number survived**

```bash
grep -n "Amended 2026-07-26" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
grep -c "0\.1\|shadow_hit_count ≥ 1\|RECALL_DEFAULT_LIMIT\|< 5%\|N = 1000\|≥ 50" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: one match from the first command; a non-zero count from the second.

- [ ] **Step 4: Full-document verification**

```bash
grep -n -i "lower bound\|lower-bound\|conservative floor" docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
```

Expected: every surviving occurrence is either (a) qualified by "with respect to query quality", (b) inside the amendment note describing the *former* claim, or (c) explicitly negated. **No occurrence may assert an unqualified lower bound on the measured under-trigger rate.** Read each hit and confirm.

- [ ] **Step 5: Confirm the prose still matches the code**

```bash
grep -n "shadowHitCount} >= 1" src/long-term-memory/shadow-funnel.ts
grep -n "RECALL_DEFAULT_LIMIT = 8" src/long-term-memory/recall-cascade.ts
grep -n "limit:" src/long-term-memory/shadow-log.ts
```

Expected: the funnel computes the literal `shadow_hit_count >= 1` criterion; `RECALL_DEFAULT_LIMIT` is `8`; `shadow-log.ts` passes **no** `limit` to `runShadowRecall`, so the cutoff is k = 8. All three read-only — the doc must describe these, not the reverse.

- [ ] **Step 6: Confirm no source file was touched**

```bash
git status --short
git diff --stat HEAD~3
```

Expected: a clean tree apart from the target doc, and a diff touching **only** `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`. Any `src/` or `scripts/` path in that diff is a scope violation — stop and report.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md
git commit -m "docs(memory): record the 2026-07-26 pre-collection amendment

Dated note in the decision-gate section: what changed (rationale only), what did
not (every pre-registered quantity, enumerated), and the precondition that makes
the amendment legitimate -- zero rows collected, flag never enabled.

A reader holding only this spec can now verify the gate did not move without
consulting git history."
```

---

### Task 5: Correct the stale line reference in the amendment spec

The 2026-07-26 spec's defect table points site D at line 244. The actual "P1 proves the gap" clause is at line 234; 244 is the unrelated `overPullTurns` paragraph. The spec is this amendment's audit artifact, so a wrong pointer in it is worth one commit.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md` (defect table row D, and the "Edits" section heading for D)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm the stale reference (red)**

```bash
grep -n "244" docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md
```

Expected: two matches — the table row `| D | 244 |` and the edit heading `**D — line 244.**`.

- [ ] **Step 2: Fix both references**

Find `| D | 244 | "P1 proves the gap" |` and replace `244` with `234`.

Find `**D — line 244.**` and replace with `**D — line 234.**`.

- [ ] **Step 3: Verify (green)**

```bash
grep -n "| D | 234 |" docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md
grep -n "D — line 234" docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md
grep -c "244" docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md
```

Expected: one match each from the first two; `0` from the third.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-26-shadow-log-validity-amendment-design.md
git commit -m "docs(memory): fix stale line pointer in the amendment spec

Site D is line 234 (the 'Proceed to P2' bullet), not 244 (the overPullTurns
paragraph)."
```

---

## Definition of done

- Every occurrence of lower-bound / conservative-floor language in the target doc is qualified, negated, or historical.
- The `Threats to validity` list carries three directional markers (down, up, up) plus one neutral, and an explicit statement that the net is indeterminate.
- Both gate branches read as screen-and-adjudicate, with `5%` intact on each.
- A dated amendment note enumerates every frozen quantity as unchanged and states the empty-collection precondition.
- `git diff --stat` across all five commits touches exactly two files, both under `docs/superpowers/specs/`.
