<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Climb the Tier 0 story coverage floor back to 0.71/0.70

## Why

`story-coverage-floor-qualification` re-recorded the Tier 0 floor at what the
tree measures — lines 0.68, functions 0.65 — because the previous 0.71/0.70 was
a measurement of a 23%-smaller scope (895 source files at `a20e59c06` against
1104 today) and no achievable version of its task list closed the gap. That
change deliberately deferred the climb rather than pretending a twelve-file
plan could deliver it. This change is that climb.

The deficit is best stated in file-units, because `meanMetric` is an unweighted
mean of per-file ratios: one fully covered file is worth 1/1048 = 0.095pp.
Restoring 0.71/0.70 from the re-recorded floor costs **23.5 line-units and 43.3
function-units**.

The headroom exists. **220 scoped files have zero covered functions**, so the
metric is not the constraint — 43.3 of those 220 need real story coverage. They
concentrate where a chat-driven story naturally reaches:

| files at 0 functions | area |
| --- | --- |
| 59 | `src/analytics/` (excluding rekey) |
| 52 | `src/chat/` |
| 22 | `src/debug/` |
| 19 | `src/analytics/rekey/` — operator CLI |
| 11 | `plugins/task-provider-kaneo/` |
| 11 | `plugins/task-provider-youtrack/` |
| 46 | everything else |

## What Changes

- Add durable Tier 0 stories, each asserting one user-visible oracle and one
  durable system oracle, until `bun test:stories:coverage` measures at or above
  lines 71.00% and functions 70.00%.
- Work the provider-operation and analytics-governance clusters first: they hold
  the densest reachable headroom (`plugins/task-provider-*/operations/` and
  `src/analytics/governance/` alone are 30 zero-function files) and are driven
  through seams the harness already exposes. The analytics cluster got cheaper
  since this was written: `analytics-collection-eligibility-grant` has landed, so
  a story can grant collection eligibility through the settings preference
  handler and reach the canonical-event surfaces, not only the denial branches
  (design D4).
- Raise the floor from the green run with `bun coverage:ratchet:stories` and
  commit the `scripts/story/coverage-floor.json` change.
- Re-record the qualification baseline afterwards: raising the floor edits a
  frozen input, which retires the baseline recorded by the predecessor change.

## Capabilities

### Modified Capabilities

- `story-coverage-floor-qualification` — this change moves the recorded floor
  the predecessor established and re-records the baseline that depends on it.
  It declares no new capability: the gate, the metric, the scope rule, and the
  two-oracle requirement are all already specified there, and this change only
  satisfies them at a higher number.

## Non-goals

- Reweighting `meanMetric` or narrowing `story-scope.ts` — already declined by
  the predecessor and restated here: both move the number by redefining the
  measurement.
- Load-only stories that import a module so it stops counting as 0% without
  asserting a behavior — forbidden by the predecessor's
  "Coverage is bought with contracts, not with loads" requirement.
- Covering `src/analytics/rekey/**` and the other operator CLI entrypoints.
  Nineteen zero-function files sit there, but no hermetic chat-driven story
  reaches a rekey CLI naturally, and the remaining 201 files are more than
  enough headroom. If Tier 0 should ever cover operator tooling, that is a
  scope decision, not a coverage task.
- Tier 1-4 lanes — `tier3-chat-adapter-coverage` covers the Tier 3 slice.
- Any production behavior change. A story that cannot pass without one is a
  finding, not a fix.

## Impact

- **Tests:** new `tests/stories/**/*.story.test.ts` plus additive records in
  `tests/stories/catalog/coverage.ts` and `tests/stories/catalog/behaviors.ts`.
- **Gate:** `scripts/story/coverage-floor.json` returns to 0.71/0.70.
- **Docs:** the recorded baseline in
  `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
  is superseded and re-recorded.
- **Production code / DB / deps / scope model:** none.
