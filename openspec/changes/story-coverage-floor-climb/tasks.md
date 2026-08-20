<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Climb the Tier 0 floor to 0.71/0.70

## 1. Establish the budget

- [x] 1.1 Re-measure the current mean and restate the deficit in file-units
      against the gate's own scope (`scopeLcov` + `discoverScopedSourceFiles`),
      and list the zero-function files in the D2 target order.
      Verify: `bun test:stories:coverage` exits 0 at the current floor and the
      file-unit deficit is recorded
- [x] 1.2 Record the per-section function-unit targets from 1.1's measurement,
      replacing the provisional numbers in sections 2-4 if the deficit has
      moved. The targets sum to the deficit plus a two-unit margin.
      Verify: the section targets sum to at least the measured deficit

### Measured budget (2026-08-20, from `reports/stories/coverage/lcov.info`)

Measured with the gate's own scope (`discoverScopedSourceFiles` + `scopeLcov`
+ `parseLcovTotals`): **1050 files** (1022 measured, 28 unloaded seeded as 0%),
lines **68.66%**, functions **65.75%**. Deficit to 0.71/0.70: **24.6 line-units,
44.6 function-units**. Functions binds, as D1 predicted.

222 files have `FNH:0`. Reachable headroom in D2 order:

| target | files | uncovered fns | section |
| --- | --- | --- | --- |
| `plugins/task-provider-kaneo/` | 11 | 22 | 2.1 |
| `plugins/task-provider-youtrack/` | 11 | 44 | 2.2 |
| `src/analytics/governance/` | 14 | 100 | 3.1 |
| `src/analytics/derive/` + `delivery/` | 10 | 64 | 3.2 |
| `src/chat/` | 52 | 275 | 4.1 |
| `src/debug/` | 23 | 112 | 4.2 |
| excluded: `src/analytics/rekey/` | 19 | 57 | — (D3) |
| not targeted | 82 | 366 | — |

Section targets sum to 47 against a 44.6-unit deficit — a 2.4-unit margin.

## 2. Provider operations (target: 16 function-units)

- [x] 2.1 Stories covering the zero-function files in
      `plugins/task-provider-kaneo/` (column and label operations, provisioning
      requests and messages, validation errors), two oracles each.
      Verify: `bun test:stories` and `bun test:stories:coverage` reports at
      least 8 function-units above the section's starting measurement
      Result: +9.3 function-units (65.75% -> 66.64%), 7 of the 11 files closed
      by three column/label scenarios. Four files stay at zero and are left
      there on purpose: `remove-label.ts` is unreachable, because Kaneo does
      not declare `labels.delete` (its REST delete only accepts an attached
      label), so `remove_label` is never registered; `provision-requests.ts`,
      `provision-messages.ts` and `validation-error.ts` sit behind the
      self-service account-provisioning flow, which needs a registration seam
      the fake Kaneo does not model. Section target already met without them.
- [x] 2.2 Stories covering `plugins/task-provider-youtrack/operations/`
      (collaboration, team, work items, activities, attachments, count,
      project fields, saved queries, commands) and the derived-field helpers.
      Verify: `bun test:stories:coverage` reports at least 8 further
      function-units

## 3. Analytics stores and jobs (target: 14 function-units)

- [x] 3.1 Stories for the zero-function files in `src/analytics/governance/`,
      granting collection eligibility the way production does — by storing a
      pseudonymous preference through the settings preference handler, never by
      calling `setEligibilityState` from the story. Cover both sides: a
      consenting subject reaching a decision that admits, and a non-consenting
      one denied with `governance_incomplete`.
      Verify: `bun test:stories:coverage` reports at least 8 further
      function-units
- [x] 3.2 Stories for `src/analytics/derive/` and `src/analytics/delivery/`,
      reachable now that a granted ref exists.
      Verify: `bun test:stories:coverage` reports at least 6 further
      function-units

## 4. Chat and settings surfaces (target: 17 function-units)

4.1 was **not needed**; 4.2 was. After section 3.2 the gate measured lines
72.11% and functions 70.44%, which clears both target floors but not the
ratchet: `nextFloor` subtracts `EPSILON = 0.005` before flooring to two
decimals, so a measured 70.44% writes a 0.69 functions floor, not 0.70. 4.3's
stop rule reads against the floor 6.1 has to write, so section 4 stayed open
until the measurement carried that margin. 4.2 supplied it and `src/chat/`
stays as headroom for the next ratchet.

- [ ] 4.1 Stories for the zero-function files under `src/chat/` (51 candidates:
      adapter helpers reachable from the existing Telegram and Discord story
      lanes).
      Verify: `bun test:stories:coverage` reports at least 11 further
      function-units
- [x] 4.2 Stories for the zero-function files under `src/debug/` (22
      candidates: settings routes reachable through the settings story
      surface).
      Verify: `bun test:stories:coverage` reports at least 6 further
      function-units
      Result: +6.1 function-units (70.44% -> 71.02%, lines 72.11% -> 72.52%)
      from three admin-operations stories covering the LLM provider and role
      routes, the user/open-access/authorized-group routes, and the MCP
      catalog, plugin-server and super-admin message-history purge routes.
- [x] 4.3 If the gate still measures below lines 71.00% or functions 70.00%,
      continue through the D2 order until it clears both. If it clears earlier,
      stop: the remaining files are headroom for the next ratchet.
      Verify: `bun test:stories:coverage` measures at or above both floors

## 5. Catalog and ledger records

- [x] 5.1 Register each new story in `tests/stories/catalog/coverage.ts` and add
      its behavior-ledger entry in `tests/stories/catalog/behaviors.ts`; no
      `blocked:missing-implementation` or `retired` entry is used as evidence.
      Verify: `bun test:stories:contracts`

## 6. Raise the floor

- [x] 6.1 Raise the floor from the green run and confirm it lands at 0.71/0.70.
      Verify: `bun coverage:ratchet:stories` writes the new values and
      `bun test:stories:coverage` exits 0 against them
      Result: the ratchet wrote lines **0.72**, functions **0.70** — the lines
      floor lands one hundredth above the change's target because the sections
      that bought the functions margin carried lines with them. The gate reruns
      green against both.

## 7. Re-record the qualification baseline

- [x] 7.1 Verify the foundation (`test:stories:contracts`,
      `test:stories:coverage`, `test:stories:manifest`) and commit the frozen
      input set with nothing unrelated staged. That commit is the baseline
      candidate. This section is owed regardless of the climb's outcome: the
      recorded baseline was already retired by `tier3-chat-adapter-coverage`
      (see design D5).
      Verify: all three commands exit 0
- [x] 7.2 Replace the `## Foundation baseline` section in
      `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
      with the new literal SHA and tree hash, marking the previous baseline
      superseded. No shell variable names remain.
      Verify: the section contains no `$` and names the new SHA
- [x] 7.3 Prove compatibility:
      `BASE_REF=<baselineSha> bun test:stories:compat --manifest-only` then
      `BASE_REF=<baselineSha> bun test:stories:compat`.
      Verify: both exit 0

## 8. Close out

- [ ] 8.1 Run `bun test`, `bun run typecheck`, `bun run lint`, and
      `bun run check:full`.
      Verify: all commands exit 0
