<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Climb the Tier 0 floor to 0.71/0.70

## 1. Establish the budget

- [ ] 1.1 Re-measure the current mean and restate the deficit in file-units
      against the gate's own scope (`scopeLcov` + `discoverScopedSourceFiles`),
      and list the zero-function files in the D2 target order.
      Verify: `bun test:stories:coverage` exits 0 at the current floor and the
      file-unit deficit is recorded

## 2. Provider operations

- [ ] 2.1 Stories covering the zero-function files in
      `plugins/task-provider-kaneo/` (column and label operations, provisioning
      requests and messages, validation errors), two oracles each.
      Verify: `bun test:stories` and `bun test:stories:coverage` (functions
      strictly above the previous run)
- [ ] 2.2 Stories covering `plugins/task-provider-youtrack/operations/`
      (collaboration, team, work items, activities, attachments, count,
      project fields, saved queries, commands) and the derived-field helpers.
      Verify: `bun test:stories:coverage`

## 3. Analytics stores and jobs

- [ ] 3.1 Stories for the zero-function files in
      `src/analytics/governance/` reachable without a granted eligibility ref,
      including the denial branches. Do not seed `setEligibilityState`.
      Verify: `bun test:stories:coverage`
- [ ] 3.2 Stories for `src/analytics/derive/` and `src/analytics/delivery/`.
      Verify: `bun test:stories:coverage`

## 4. Chat and settings surfaces

- [ ] 4.1 Stories for the zero-function files under `src/chat/` and
      `src/debug/`, continuing only until the gate reports at or above lines
      71.00% and functions 70.00%.
      Verify: `bun test:stories:coverage` exits 0 at the raised floor

## 5. Catalog and ledger records

- [ ] 5.1 Register each new story in `tests/stories/catalog/coverage.ts` and add
      its behavior-ledger entry in `tests/stories/catalog/behaviors.ts`; no
      `blocked:missing-implementation` or `retired` entry is used as evidence.
      Verify: `bun test:stories:contracts`

## 6. Raise the floor

- [ ] 6.1 Raise the floor from the green run and confirm it lands at 0.71/0.70.
      Verify: `bun coverage:ratchet:stories` writes the new values and
      `bun test:stories:coverage` exits 0 against them

## 7. Re-record the qualification baseline

- [ ] 7.1 Verify the foundation (`test:stories:contracts`,
      `test:stories:coverage`, `test:stories:manifest`) and commit the frozen
      input set with nothing unrelated staged. That commit is the baseline
      candidate.
      Verify: all three commands exit 0
- [ ] 7.2 Replace the `## Foundation baseline` section in
      `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
      with the new literal SHA and tree hash, marking the previous baseline
      superseded. No shell variable names remain.
      Verify: the section contains no `$` and names the new SHA
- [ ] 7.3 Prove compatibility:
      `BASE_REF=<baselineSha> bun test:stories:compat --manifest-only` then
      `BASE_REF=<baselineSha> bun test:stories:compat`.
      Verify: both exit 0

## 8. Close out

- [ ] 8.1 Run `bun test`, `bun run typecheck`, `bun run lint`, and
      `bun run check:full`.
      Verify: all commands exit 0
