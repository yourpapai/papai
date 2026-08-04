<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `plugins/task-provider-youtrack/validate-config.ts`

Date: 2026-08-04
Status: approved

## Goal

Raise the mutation score of
`plugins/task-provider-youtrack/validate-config.ts` — paired score **0**
(0 killed / 0 survived / 32 no-coverage, 32 mutants), tied-worst genuine gap in
`scripts/mutation/baseline.json` — to **≥ 0.94** with pure unit tests. No
source changes.

## Background and findings

### Target selection (baseline triage, 2026-08-04)

Same triage method as the previous cycle
(`2026-08-04-youtrack-custom-field-values-mutation-design.md`): low-baseline
entries probed with the official paired runner (`bun test:mutate:file`),
cross-checked against cached reports in `reports/paired/`, split into stale
seeds and genuine gaps. Value criterion this cycle (user-confirmed):
**ratchet economics** — biggest floor raise per effort.

| File | Baseline | Paired (K/S/NC) | Verdict |
| --- | --- | --- | --- |
| **`youtrack/validate-config.ts`** | 0 | 0/0/**32** → **0** | **Genuine gap — selected target.** No covering test; pure function; kaneo twin pattern proven at 0.969. |
| `youtrack/phase-five-provider.ts` | 0 | 0/0/9 → 0 | Tiny delegation layer, 9 mutants; low value. Deferred. |
| `src/tools/search-memos.ts` | 0.175 | 17/28/51 → 0.177 | Largest pool (96 mutants) but needs memo-store + embedding harness; weaker oracles. Strong next-cycle candidate. |
| `src/tools/instructions.ts` | 0.256 | 10/29/0 → 0.256 | 29 survivors, all covered — pure oracle strengthening on thin delegation wrappers. Lower mutation value. Deferred. |
| `youtrack/custom-field-values.ts` | 0 | 90/5/0 → 0.947 | Stale seed; previous cycle's work already landed. Floor self-heals on next master seed. |

### Why this file

- **Worst genuine measurement:** 32 mutants, zero executed — no test file
  references the module (companion path
  `tests/plugins/task-provider-youtrack/validate-config.test.ts` does not
  exist; the paired runner's coverage map found no covering test).
- **Cheapest full kill available:** 24 lines, one pure exported function — no
  fetch, no store, no DI, no clock. Every mutant is killable with plain
  input/output assertions.
- **Proven mirror:** the kaneo twin
  (`plugins/task-provider-kaneo/validate-config.ts`, baseline 0.969) has an
  established companion test
  (`tests/plugins/task-provider-kaneo/validate-config.test.ts`) whose shape
  transfers directly; the validators share the same baseUrl contract.
- **Real consumer impact:** the validator gates both task-instance config
  validation and resolver-time
  `validateEffectiveTaskProviderConfigResult`; surviving mutants would accept
  `ftp:` URLs or reject valid configs silently.

### Mutant inventory (paired probe 2026-08-04, cached report)

32 mutants: **0 killed, 0 survived, 32 no-coverage**. All five clusters map to
source lines:

- **L11 — function body: 1 BlockStatement** (`{}`). Killed by any assertion.
- **L12 — `config['baseUrl']?.trim() ?? ''`: 5 mutants.** OptionalChaining
  (`?.` → `.`), MethodExpression (`.trim()` removed), LogicalOperator (`??` →
  `&&`), StringLiteral ×2 (the `'baseUrl'` key and the `''` fallback). The
  `.trim()`-removal mutant is the one the kaneo twin leaves alive — killed
  here by a whitespace-only input (see Design, case ⑤).
- **L13 — empty check + first return: 6 mutants.** EqualityOperator
  (`===` → `!==`), ConditionalExpression ×2 (condition → `true`/`false`),
  ObjectLiteral / BooleanLiteral / StringLiteral on
  `{ ok: false, reason: 'baseUrl is required' }`.
- **L15–L18 — try/catch + URL-parse return: 5 mutants.** BlockStatement on
  the try body and the catch body; ObjectLiteral / BooleanLiteral /
  StringLiteral on `{ ok: false, reason: 'baseUrl must be a valid URL' }`.
- **L20–L21 — protocol gate + return: 13 mutants.** LogicalOperator
  (`&&` → `||` — always rejects), EqualityOperator ×2 (`!==` → `===` on
  `'http:'` and `'https:'`), ConditionalExpression ×4 (condition variants),
  StringLiteral ×2 (the protocol literals), BlockStatement (if-body removed —
  never rejects), and the ObjectLiteral / BooleanLiteral / StringLiteral on
  `{ ok: false, reason: 'baseUrl must use http or https' }`.
- **L23 — success return: 2 mutants.** ObjectLiteral (`{}`) and
  BooleanLiteral (`ok: false`) on `{ ok: true }`.

## Design

New companion test file
`tests/plugins/task-provider-youtrack/validate-config.test.ts` (mirror path →
the paired runner's companion resolver discovers it automatically; no
`overrides.json` edit). Plain `bun:test` unit tests, no harness. All
assertions use `toEqual` on the full result object, which kills every
ObjectLiteral / BooleanLiteral / StringLiteral return mutant outright.

Structure mirrors the kaneo twin (same describe name, same test ordering) so
the two validators stay diffable as they evolve. Seven cases:

1. **Valid `https://youtrack.example` → `{ ok: true }`.** Kills L23 both
   mutants; L13 condition→`true`; L20 `&&`→`||` and `'https:'` literal/flip;
   L12 key-literal and `??`→`&&` mutants (both reroute to a required-error or
   a throw); L11 body removal.
2. **Valid `http://localhost:3000` → `{ ok: true }`.** Kills the `'http:'`
   StringLiteral and its `!==`→`===` flip (an https-only case cannot
   distinguish them).
3. **Missing key (`{}`) → `{ ok: false, reason: 'baseUrl is required' }`.**
   Kills L12 OptionalChaining (`.trim()` on `undefined` throws) and the `''`
   fallback literal; L13 return-shape mutants.
4. **Empty string → required reason.** Kills L13 `===`→`!==` (mutant falls
   through to `new URL('')` → throws → wrong reason) and condition→`false`.
5. **Whitespace-only `'   '` → required reason.** Kills the L12
   MethodExpression trim-removal: without `.trim()`, length is 3, falls
   through to `new URL('   ')` → throws → `'baseUrl must be a valid URL'`
   instead of the required reason. This is the case the kaneo twin lacks.
6. **`'not a url'` → `{ ok: false, reason: 'baseUrl must be a valid URL' }`.**
   Kills L15/L17 BlockStatements (emptied try leaves `parsed` undefined →
   L20 throws; emptied catch falls through) and the L18 return-shape mutants.
7. **`ftp://host` → `{ ok: false, reason: 'baseUrl must use http or https' }`.**
   Kills the L20 if-body BlockStatement (never rejects) and the L21
   return-shape mutants.

### Expected outcome

Predicted killed: 32/32. Every mutant in the inventory is reached by at least
one case above with a discriminating oracle; no equivalent-mutant class was
identified in pre-analysis (the `?? ''` fallback, the trim, and both protocol
literals are all behaviorally observable through the return value). Forecast
floor: **≥ 0.94** allows for one unforeseen accepted survivor, matching the
kaneo twin's 0.969.

## Measurement and ratchet

1. `bun test tests/plugins/task-provider-youtrack/validate-config.test.ts` —
   new tests pass.
2. `bun test:mutate:file plugins/task-provider-youtrack/validate-config.ts` —
   confirm killed/survivor counts match the prediction; kill or justify any
   unexpected survivor.
3. No `baseline.json` edit in the PR: the CI `mutation-baseline` job re-seeds
   the floor on master (per-key max) from the changed-files run. The PR gate
   is regression-only, so the improved score can only raise the floor.
4. Regression checks: repo lint/typecheck per `package.json` scripts. No
   existing suite is touched (new file, no shared mocks).

## Trade-offs and risks

- **Mirror coupling to the kaneo test.** Deliberate: the validators share a
  contract, and keeping the suites parallel makes future divergence a
  conscious diff. Accepted.
- **`toEqual` on reason strings couples tests to message text.** Accepted —
  the reason strings are the module's documented error contract (consumed by
  config-validation UI), and the coupling is exactly what kills the
  StringLiteral return mutants.
- **Probe vs future paired divergence.** The recorded floor comes from the
  official paired runner on master; the numbers here are the prediction
  baseline, not the guarantee.

## Alternatives considered

- **`src/tools/search-memos.ts` (0.177, 96 mutants).** Largest surviving pool
  in `src/`; rejected this cycle because it needs the memo-store + embedding
  harness (`loadEmbeddingsForUser`, `getEmbeddingForContext`,
  `keywordSearchMemos`) and half its gap is error/formatting paths with
  weaker oracles — higher effort, lower kill certainty. Strong next-cycle
  candidate.
- **`src/tools/instructions.ts` (0.256, 39 mutants, 29 survivors, 0
  no-coverage).** Cheapest possible harness (existing test, only oracle
  strengthening), but the file is three thin store-delegation wrappers;
  rejected on lower mutation value per the ratchet-economics criterion.
- **Table-driven `test.each` matrix instead of the mirrored twin shape.**
  Same kills with fewer lines; rejected because it abandons the
  twin-mirroring that keeps kaneo/youtrack validator drift visible.
- **Integration test through `validateEffectiveTaskProviderConfigResult`.**
  Higher fidelity; rejected — needs the provider-registry/store harness to
  kill the same 32 pure-function mutants, and the direct unit path is the
  documented entry contract.
