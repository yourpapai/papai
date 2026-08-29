<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The C1–C7 prototype window left two afk-scoped oxlint relaxations in `.oxlintrc.json` — `no-unsafe-*` off for `tests/afk-runner/**` and `no-unsafe-type-assertion` off for `afk-runner/src/kernel/machine.ts` — deliberately re-timed to U9 (sdd-runner retirement). U9 is now next in the ledger, and a measurement with both overrides deleted shows exactly 19 errors (2 in `machine.ts`, 17 unvalidated-`JSON.parse` sites across 7 test files), all fixable with in-repo patterns. Pulling the re-tighten forward removes the last afk-scoped exceptions from the shared lint config before retirement widens the diff.

## What Changes

- `.oxlintrc.json`: delete the two afk-scoped `overrides` blocks, restoring the pre-afk rule surface (the `tests/**/*.ts` block stays; formatting stays oxfmt-clean).
- `afk-runner/src/kernel/machine.ts`: replace the `setup({ types: { context: {} as KernelContext, events: {} as KernelEvent } })` witnesses with explicit type parameters — `setup<KernelContext, KernelEvent>({ guards, actions })` — erasing both assertions with zero runtime code.
- 7 test files under `tests/afk-runner/` (17 errors): parse persisted artifacts through existing exported zod schemas (`PersistedRunStateSchema` for `state.json`, `ResolverOutputSchema` for the veto sidecar) instead of annotated `JSON.parse` assignments; assertions unchanged.

## Capabilities

### New Capabilities

- `lint-default-parity`: the shared oxlint configuration carries no workspace-scoped rule relaxations; `afk-runner/src/**` and `tests/afk-runner/**` pass repo-default lint (type-aware rules included) with no per-path exceptions. Without it, the two overrides persist as permanent config debt past U9, and every future afk-runner file inherits the weaker rule surface silently.

### Modified Capabilities

None — no `openspec/specs/` requirement changes; this is a dev-tooling invariant, not runtime behavior. No platform/task instance is affected; no config-context state is touched (per-user, group-shared, or thread-isolated).

## Non-goals

- The jscpd oracle ignores in `scripts/detect-duplicates.ts` (over `tests/afk-runner/fixtures/**` + ported substrate tests) — those stay U9-timed by design: the duplication **is** the parity oracle and can only die with sdd-runner retirement.
- The deferred C7 findings (F-A1 double `round_open`, F-A2 missing resume-event producer, F-B1/B2 veto unreachability and waiter crash, prescreen over-match).
- sdd-runner retirement itself, any runtime behavior change to afk-runner, and any lint-rule additions beyond restoring the initial surface.

## Impact

- Code: `.oxlintrc.json`, `afk-runner/src/kernel/machine.ts` (types-only edit), 7 files in `tests/afk-runner/` (parse-site typing only).
- Docs: `docs/architecture/afk-runner.md` — the relaxation-window section's documented exception and re-timed entry for the oxlint pair close early.
- Gates: `bun run lint` green at repo defaults; `bun run typecheck`; existing afk-runner suites (fold parity over 26 fixtures is the behavioral oracle for the machine.ts edit); mutation gate unaffected (typing-only source change; test files are not mutation targets).
