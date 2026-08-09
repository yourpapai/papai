<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/providers/config-validation.ts` Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Raise the mutation score of `src/providers/config-validation.ts` from `0.6224` to
`>= 0.9` by adding a dedicated companion test file. Test-only; no `src/` edits.

**Companion file (new):** `tests/providers/config-validation.test.ts`
(auto-discovered; additive to the existing `tests/providers/resolver.test.ts` override).

## Global constraints

- Test-only. Touch ONLY `tests/providers/config-validation.test.ts` and these docs.
- Do NOT edit `src/`, `client/`, `plugins/`, `scripts/`, or `scripts/mutation/baseline.json`.
- Every new assertion uses exact equality `toBe(...)` (or `toHaveBeenCalledTimes` /
  `toBeNull` / `Object.keys(...).length` `toBe`). Never `startsWith` / `endsWith` /
  `toContain` / partial matchers.
- Each test injects `deps` (a `TaskInstanceConfigValidationDescriptor` + optional mocked
  `TaskProviderConfigValidator`) — pure DI, no DB, no plugin registration.
- SPDX header on the new file: `// SPDX-License-Identifier: BUSL-1.1` + copyright lines.

## Tasks (one per mutant class)

- [ ] T1 (G1, ids 7/9/10) — whitespace-only required value is reported in `missing`.
- [ ] T2 (G2+G3, ids 11/12/13/40/41/43/50/54) — non-http URL value (`ftp://`) reported in `invalidUrls`.
- [ ] T3 (G4, ids 49/51/52) — blank optional URL value is *not* flagged → result `null`.
- [ ] T4 (G5, id 18) — `http://` value is valid → result `null`.
- [ ] T5 (G6, id 21) — throwing URL value reported in `invalidUrls`.
- [ ] T6 (G7, ids 22/95/96/98/99/100/101/102) — validator throws → `task_provider_config_validator_failed` with exact `reason`.
- [ ] T7 (G8, ids 103/105/106) — validator rejects → `task_provider_config_validator_rejected` with exact `reason`.
- [ ] T8 (G9, ids 59/61) — absent optional field is dropped from the validator's config argument.
- [ ] T9 (G10, id 65) — `instance` scope → validator receives instance fields only.
- [ ] T10 (G11, ids 66/67/68/69) — `resolved` scope → validator receives instance+context fields.
- [ ] T11 (G12, ids 74/76/77) — `validateTaskInstanceConfigResult` unknown type → `unknown_task_provider` + `type`.
- [ ] T12 (G14, ids 110/112/113) — `validateEffectiveTaskProviderConfigResult` unknown type → `unknown_task_provider` + `type`.
- [ ] T13 (G13+G15, ids 85/121) — missing required field short-circuits to `invalid_task_instance_config` before the validator.
- [ ] T14 (G16, ids 132/134/135/136/137/138) — effective validator throws → `validator_failed` with exact `reason`.
- [ ] T15 (G17, ids 141/142) — effective validator rejects → `validator_rejected` with exact `reason`.
- [ ] T16 (G18, id 107) — effective default `mode='logical'` resolves a `storageKey`-bearing field by its logical key → `null`.

## Residuals to declare (equivalent, test-only unkillable)

- [ ] R1 — id 20 (`isHttpUrl` catch block → `{}`; sole consumer is `!isHttpUrl`, both falsy).
- [ ] R2 — id 70 (default `mode='storage'` → `''`; `configKeyForField` only branches on `'logical'`).
- [ ] R3 — id 71 (default `validatorScope='instance'` → `''`; `validatorConfigFields` only branches on `'resolved'`).

## Verification gates

- [ ] `bun test tests/providers/config-validation.test.ts` green.
- [ ] `bun test tests/providers/resolver.test.ts` green.
- [ ] `bun test:mutate:file src/providers/config-validation.ts` survivors == {20, 70, 71} and score `>= 0.9`.
- [ ] Write `.review-loop/result.json` with `residuals` mutantIds exactly {20, 70, 71}.
