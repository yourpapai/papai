<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

C8's metered ceiling-refusal branch never armed: the priced `synthetic/hf:zai-org/GLM-5.3-Flash` route went
hard-down mid-cycle, and the fallback `zai-coding-plan/glm-5.3` reports `costUsd: 0` with tokens > 0 —
`costKnown: false` — so spend projections can never cross a numeric ceiling
(`openspec/changes/v2-live-proof/notes.md` §model switch; the not-arisen record in the reflection). The
priced-route capability is exactly what the next live cycle's refusal drill needs.

## What Changes

- Update the **machine-global** opencode config (`~/.config/opencode/opencode.json`) so the model route the
  SDD cycles use carries a `cost` block at **official API prices** — the same shape the
  `synthetic/hf:zai-org/GLM-5.3-Flash` entry already declares (`input: 0.075`, `output: 0.25`,
  `cache_read: 0.015`, `cache_write: 0` per million tokens — re-verify against the official pricing page at
  execution time). Either add the cost block to the existing coding-plan route (shadow pricing: the
  subscription doesn't bill per-token, but the runner's budget guard and `analyze` then see real-rate spend)
  or register a new stable route with the cost block.
- Verify end to end: a probe spawn's `done` event carries `costUsd > 0`, and the runner's
  `costSummaryOf`/`usageTotalsOf` read `costKnown: true` (the `costUsd === 0 && tokens > 0 → costKnown
  false` predicate in `afk-runner/src/work/gate-signals.ts` is the acceptance oracle).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- None — machine-local tool configuration; no repository behavior changes (`skip_specs: true` set).

## Impact

- Code: none. Config: `~/.config/opencode/opencode.json` (machine-global, not committed — this change is
  the operator runbook and verification record for the edit).
- Downstream: re-arms the C9 live-cycle drill "needs-review refusal by numeric ceiling" (a priced run with a
  tight calibrated ceiling), listed in `docs/architecture/afk-runner.md`'s C9 scope seed.

## Non-goals

- Any runner-side cost logic change (metered semantics are mirror-ported and fixture-proven).
- Making the synthetic endpoint reliable (provider-side; if it stabilizes, both routes coexist).
- Committing secrets or the machine config into the repository.

## Fresh-session pointers

The synthetic entry with its cost block is the template (`~/.config/opencode/opencode.json`, provider
`synthetic`, model `hf:zai-org/GLM-5.3-Flash`); C8 spend shapes per route are in
`openspec/changes/v2-live-proof/corpus-report.json` (`usage.costKnown: false` everywhere after the switch).
