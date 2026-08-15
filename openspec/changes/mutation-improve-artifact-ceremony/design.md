<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Removing two mandated documents without losing what they were meant to carry

## Context

See `proposal.md` — Why. What has to be preserved, and where each piece actually lives:

```
  buildImprovePrompt's five steps          where the content is verified
  ─────────────────────────────────        ────────────────────────────────
  1. MEASURE  reports/paired/…      ──▶    the runner re-measures itself
  2. SPEC     design.md (7 sections)       ✗ nothing verifies it
       ├ Gap analysis               ──▶    duplicate of the measured report
       ├ Design – tests to add      ──▶    duplicate of the tests themselves
       ├ Verification               ──▶    duplicate of the runner's gates
       └ Accepted residuals         ──▶    duplicate of result.residuals
  3. PLAN     tasks.md checkboxes          ✗ nothing walks them
  4. TESTS    tests/…test.ts        ──▶    diff-guard, build check, score
  5. RESIDUALS result.residuals     ──▶    set-matched against measured ids
```

Steps 2 and 3 are the only two whose output no gate reads. Every section of the document
they produce has a verified counterpart elsewhere.

The consumers of the two paths: `result-schema.ts:18-19` requires them
(`z.string().min(1)`), `run-state.ts:20-21` already stores them optionally,
`pipeline.ts:194` threads them through, and `finalize.ts:52` renders them as two cells of
the pull-request table. That is the whole graph.

## Goals / Non-Goals

**Goals.** Remove the two mandated documents. Keep every verified fact. Keep a reviewer able
to see what residuals were accepted and why. Break no resumable run.

**Non-Goals.** Any change to the gates, the capped path, the baseline ratchet, the select
phase, or the test-quality rules. Removing `openspec/changes/` from the diff-guard whitelist.

## Decisions

### D1: Remove both, rather than slimming one

*Alternative considered: keep a single short note replacing both.* Rejected. The note's only
non-duplicate content is residual reasoning, and `result.residuals[].why` is a field that
already exists, is already required, and is already validated per residual. A file that
holds the same reasoning unvalidated beside a validated field is the weaker of two copies —
and this change exists because unvalidated copies are what the ceremony was.

*Alternative considered: keep `design.md`, drop `tasks.md`.* The checkbox list is the more
obviously inert of the two, so this is the tempting half-step. But the gap-analysis table
is the section most likely to drift from the measured report — the agent writes it from the
same report the runner re-reads, and only the runner's read is authoritative. Keeping the
document keeps the drift.

### D2: `finalize.ts` reports residuals inline instead of linking files

The table loses two path cells and gains the residual count with reasoning. This is the one
place where removing the documents would otherwise cost a reviewer something real: the
links were how a pull-request reader saw why a file was accepted below target.

Reading it from `result.residuals` is strictly better than a link, because that array is
the thing the runner set-matched — the reviewer sees the checked answer rather than the
prose next to it.

### D3: `specPath` / `planPath` become optional, not removed

Removing the fields outright would reject a stored result from a run started before this
change, which `--resume-run` reads. Optional accepts both shapes, matching what
`run-state.ts` already does with the same two fields — the asymmetry between the two
schemas today is itself a small sign that the required-ness was never load-bearing.

This is the same narrow-envelope reasoning the review loop relies on for older
`metrics.json` files, pinned there by `cli.test.ts:602`.

*Why not keep them required and have the agent emit empty strings.* `z.string().min(1)`
would reject them, and relaxing to `z.string()` to permit `""` encodes "absent" as a
sentinel, which every later reader has to know.

### D4: `improveChangePaths` is deleted, not left unused

It exists only to compute the two paths. `knip` runs `--strict` in this repository and an
unused non-exported helper is a lint failure rather than dead weight left lying around.

## Risks / Trade-offs

**The documents were serving a human review purpose nobody recorded** → The real risk, and
D2 is the mitigation: the residual reasoning reaches the pull-request body directly rather
than through a link. If a reviewer wants more than that, the gap is visible immediately on
the first run and the remedy is to enrich the report, not to restore a document the agent
pays for per file.

**Shortening the procedure from five steps to three changes how the agent behaves on the
steps that remain** → Plausible in either direction and worth watching. MEASURE is the step
whose skipping would be most damaging, and it is now first of three rather than first of
five, which is if anything a better position. The gates are unchanged, so a regression
surfaces as a failed iteration rather than as a silently worse one.

**A run in flight when this ships** → Covered by D3: stored results with paths still load.

## Open Questions

- **Why no `mutation-coverage-*` folder appears in this repository's history.** The
  diff-guard whitelists `openspec/changes/`, and iteration branches merge into the
  integration branch, so a completed run should have left one. Either no run has been
  merged, or the folders do not survive the flow. It is worth one look before implementing,
  because "the runner has never merged a run here" would change how much weight to put on
  every other signal in this proposal — but not what this change does, since the documents
  are redundant whether or not they ever landed.
