<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `client/shared/helpers.ts`

Target file: `client/shared/helpers.ts`. Spec:
`docs/superpowers/specs/2026-08-08-mutation-coverage-helpers-design.md`.

Measured baseline: **0.8712** (141 killed / 162 total, 21 survived). Target:
**>= 0.9**. Tests-only ceiling after killing the 12 killable classes:
**153/162 ≈ 0.9444**.

## Global constraints

- Test-only. Touch nothing under `src/`, `client/`, `plugins/`, `scripts/`.
  Do not edit `scripts/mutation/baseline.json`.
- Edit only the companion `tests/client/shared/helpers.test.ts` (plus this
  plan/spec). Do not touch `tests/client/debug/helpers.test.ts`.
- Every new assertion is exact `toBe(...)`. No `startsWith`/`endsWith`/
  `toContain`/regex where a full string is knowable.
- One test per mutant class. Each new test must isolate a single class —
  verify the chosen input does not cross-kill another class (see spec table).
- All expected `toBe` values were computed from the real function under
  `TZ=UTC` Bun and recorded verbatim; do not re-derive by eye.
- SPDX header on any new file (already on the edited test file; no new file).

## Tasks (one per killable mutant class)

- [ ] **Class 4 — `escapeHtml` `&` entity (id 66).** Add a test asserting
      `escapeHtml('x&y')` is exactly `'x&amp;y'`.
- [ ] **Class 5 — `fmtNum` honors explicit `dp` (id 95).** Add a test asserting
      `fmtNum(1.123456, 5)` is exactly `'1.12346'`.
- [ ] **Class 6 — `fmtBytes` `< 1024` boundary (id 107).** Add a test asserting
      `fmtBytes(1024)` is exactly `'1.0 KB'`.
- [ ] **Class 7 — `fmtBytes` GB/TB unit literals (ids 113, 114).** Add a
      `fmtBytes unit tiers` group with one test for GB
      (`fmtBytes(50 * 1024 ** 3)` === `'50 GB'`) and one for TB
      (`fmtBytes(2 * 1024 ** 4)` === `'2.0 TB'`).
- [ ] **Class 8 — `fmtBytes` loop `v >= 1024` boundary (id 122).** Add a test
      asserting `fmtBytes(1048576)` is exactly `'1.0 MB'`.
- [ ] **Class 9 — `fmtBytes` loop `i` cap / petabyte overflow (ids 124, 125,
      127).** Add a test asserting `fmtBytes(1024 ** 5)` is exactly `'1024 TB'`.
- [ ] **Class 10 — `fmtBytes` `v < 10` decimal boundary (id 131).** Add a test
      asserting `fmtBytes(10240)` is exactly `'10 KB'`.
- [ ] **Class 11 — `formatDuration` `ms < 0` zero boundary (id 139).** Add a
      test asserting `formatDuration(0)` is exactly `'0ms'`.
- [ ] **Class 12 — `formatDuration` `ms < 1000` exact-1000 boundary (id 144).**
      Add a test asserting `formatDuration(1000)` is exactly `'1s'`.

## Residual declaration (equivalent — do NOT try to kill)

Declare exactly these 9 ids in `result.json` residuals, grouped per loc:

- [ ] `formatTime` L27 (ids 28, 29, 30, 31) — identical ternary branches.
- [ ] `formatTime` L28–L33 (id 33) — locale options redundant under Bun ICU.
- [ ] `fmtNum` L66 (ids 74, 75, 76, 78) — null/undefined masked by L68
      `!Number.isFinite`.

## Verification gates

- [ ] `bun test tests/client/shared/helpers.test.ts` green.
- [ ] Re-run `bun test:mutate:file client/shared/helpers.ts`; confirm score
      >= 0.9 and the surviving set is exactly the 9 declared residual ids.
- [ ] Write `result.json` with `specPath`, `planPath`, `testPaths`,
      `residuals[]` (loc + why + `mutantIds`), and `notes`.

## Risks / isolation notes

- The petabyte input `1024 ** 5` is an exact integer (< 2^53); do not replace
  with a floating expression.
- `fmtBytes(1048576)` is `1024 ** 2`; it lands `v` on exactly 1024 to target
  id 122 only — it must NOT also be the petabyte test.
- The GB value `50 * 1024 ** 3` keeps `v = 50 >= 10` so it does not interact
  with the id-131 (`v < 10`) boundary; the TB value `2 * 1024 ** 4` keeps
  `v = 2 < 10`, which is the original behavior and does not kill id 131.
- `formatDuration(1000)` internally calls `fmtNum(1, 1)`; that does not reach
  the `fmtNum` L66 guard (n is finite) nor expose `dp > 3`, so it does not
  cross-kill residual classes 3 or mutant 95.
