<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/providers/config-validation.ts` Design

**Date:** 2026-08-08
**Status:** Accepted
**Target file:** `src/providers/config-validation.ts`
**Measured score:** `0.6224` (killed=89 survived=40 noCoverage=14 / 143 total)
**Goal:** `>= 0.9`

## Summary

Add a dedicated, pure-DI companion test file `tests/providers/config-validation.test.ts`
that drives both exported validators (`validateTaskInstanceConfigResult` and
`validateEffectiveTaskProviderConfigResult`) through dependency-injected descriptors and
validators. Every surviving mutant class is pinned with a focused test that asserts the
exact returned failure shape (`kind`, `reason`, `missing[i]`, `invalidUrls[i]`) or the exact
config handed to the injected validator — using exact-equality `toBe(...)` only.

## Why this file

`config-validation.ts` is the single gatekeeper that decides whether a task instance
config / effective provider config is acceptable before a provider is constructed. It
encodes five distinct outcomes (`unknown_task_provider`, `invalid_task_instance_config`,
`task_provider_config_validator_failed`, `task_provider_config_validator_rejected`, and
`null`) across two near-duplicate exported functions plus four private helpers
(`isBlank`, `isUrlField`, `isHttpUrl`, `errorMessage`, `normalizeDescriptorConfig`,
`validatorConfigFields`). Today the only covering test (`tests/providers/resolver.test.ts`,
attached via `scripts/mutation/overrides.json`) exercises these paths indirectly through
`TaskProviderResolver`, so many branches are reached but their *exact return values* are
never asserted — exactly the gap mutation testing rewards.

## Non-goals

- Editing `src/` (test-only iteration).
- Touching `scripts/mutation/baseline.json` or `overrides.json` (runner-owned / forbidden).
- Rewriting the existing `resolver.test.ts` (it stays as the resolver's contract test).
- Reaching `1.0`: three mutants are genuinely equivalent (see Accepted residuals).

## Gap analysis

Runner-measured surviving/non-covered mutants grouped by class (Stryker `id`s from
`reports/paired/src__providers__config-validation.ts.stryker-report.json`).

| # | Class (loc) | Mutant ids | Behavior the tests never pin | Test to add |
| --- | --- | --- | --- | --- |
| G1 | `isBlank` whitespace branch (`L41`) | 7, 9, 10 | A *defined* whitespace-only value must count as blank/missing. Today only `undefined` values hit `missing`. | whitespace required value → `missing[i]` |
| G2 | `isUrlField` key matching (`L44`) | 11, 12, 13 | No test asserts a field whose `key` ends in `url` is recognized as a URL field. | non-http URL value → `invalidUrls[i]` |
| G3 | invalid-URL filter (`L82–87`) | 40, 41, 43, 50, 54 | The "value present, non-blank, not http → flag" pipeline is never asserted. | non-http URL value → `invalidUrls[i]` |
| G4 | blank-URL short-circuit (`L85`) | 49, 51, 52 | A *blank* URL value must NOT be flagged; mutants flip this to flagged. | blank optional URL value → `null` |
| G5 | `isHttpUrl` `http:` protocol (`L49`) | 18 | Only `https://` values are used; the `http:` arm of the protocol allow-list is dead. | `http://` value → `null` |
| G6 | `isHttpUrl` throw branch (`L50–51`) | 21 | A value that throws in `new URL` is never fed in. | throwing URL value → `invalidUrls[i]` |
| G7 | `errorMessage` / validator-throws (`L55`, `L132–141`) | 22, 95, 96, 98, 99, 100, 101, 102 | A throwing validator's `reason` (the thrown `Error.message`) is never asserted. | validator throws → `kind`/`reason` |
| G8 | validator-rejects (`L140–141`) | 103, 105, 106 | A rejecting validator's `task_provider_config_validator_rejected` shape is never asserted directly. | validator rejects → `kind`/`reason` |
| G9 | `normalizeDescriptorConfig` drops undefined (`L99`) | 59, 61 | A config with an absent optional field is never checked for "validator sees only present keys". | assert validator arg keys |
| G10 | `validatorConfigFields` instance scope (`L108`) | 65 | The `scope === 'instance'` (default) arm — validator gets instance fields only — is unproven. | instance scope → validator arg keys |
| G11 | `validatorConfigFields` resolved scope (`L108`) | 66, 67, 68, 69 | The `scope === 'resolved'` arm — validator gets instance+context — is uncovered. | resolved scope → validator arg keys |
| G12 | unknown provider (`L120`) | 74, 76, 77 | `validateTaskInstanceConfigResult` never called with a missing descriptor. | unknown type → `kind`/`type` |
| G13 | invalid-config early return (`L123`) | 85 | The `missing.length>0 \|\| invalidUrls.length>0` guard survives because covering tests lack a present validator to diverge. | whitespace missing + no validator → `invalid` |
| G14 | effective unknown provider (`L151`) | 110, 112, 113 | `validateEffectiveTaskProviderConfigResult` never called with a missing descriptor. | unknown type → `kind`/`type` |
| G15 | effective invalid-config guard (`L155`) | 121 | Same gap as G13 on the effective function. | effective missing context → `invalid` |
| G16 | effective validator-throws (`L164–173`) | 132, 134, 135, 136, 137, 138 | Effective function's failure/reason path uncovered. | effective validator throws → `kind`/`reason` |
| G17 | effective validator-rejects (`L172–173`) | 141, 142 | Effective function's rejected path uncovered. | effective validator rejects → `kind`/`reason` |
| G18 | effective default `mode='logical'` (`L148`) | 107 | Default mode resolves config by logical key; never exercised with a `storageKey`-bearing field. | storageKey field + default mode → `null` |

## Design — tests to add

A new `describe('config-validation')` block in a **new** companion file
`tests/providers/config-validation.test.ts`. It is auto-discovered as the companion for
`src/providers/config-validation.ts` by the TDD resolver (`src/x → tests/x.test.ts`) and is
*additive* to the existing override target. Both validators accept a `deps` parameter, so
every test injects a hand-built `TaskProviderTypeDescriptor` and (optionally) a mocked
`TaskProviderConfigValidator` — no DB, no plugin registration, no global state.

One test per gap class, each mapped 1:1 to a row above. Assertion discipline: every
assertion uses exact equality (`toBe`), including array contents (assert `length` then
`[i]`) and validator arguments (assert `Object.keys(arg).length` then each value). No
`startsWith` / `endsWith` / `toContain` / partial matchers.

Shared builders: `makeField`, `makeDescriptor`, `makeDeps` keep each test to its
distinguishing inputs + one exact-shape assertion.

## Verification

1. `bun test tests/providers/config-validation.test.ts` — green.
2. `bun test tests/providers/resolver.test.ts` — green (companion unchanged behavior).
3. `bun test:mutate:file src/providers/config-validation.ts` — re-measure; the only
   survivors must be the three declared equivalents (see Accepted residuals).
4. Confirm the new score `>= 0.9` (expected ≈ `0.979`, killed=140/143).

## Accepted residuals

Three mutants are genuinely unkillable from tests (they change an internal value to a
distinct-but-observationally-identical one because the only consumer branches on a
different predicate). Each is listed with per-loc reasoning in the iteration `result.json`.

- **id 20** — `isHttpUrl` `catch {}` block body → `{}`. The catch returns `false` (real) vs
  `undefined` (mutant); both falsy, and the sole call site is `!isHttpUrl(value)`, so
  `!false === !undefined === true`. The function is not exported, so its direct return value
  cannot be asserted.
- **id 70** — `validateTaskInstanceConfigResult` default `mode = 'storage'` → `''`.
  `mode` is consumed only by `configKeyForField`, which branches on `mode === 'logical'`;
  both `'storage'` and `''` take the `storageKey ?? key` else-branch, so behavior is identical.
- **id 71** — `validateTaskInstanceConfigResult` default `validatorScope = 'instance'` → `''`.
  `validatorScope` is consumed only by `validatorConfigFields`, which branches on
  `scope === 'resolved'`; both `'instance'` and `''` take the instance-only else-branch.
