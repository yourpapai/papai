<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0165: Command Retirement — Parity Gate Verification

## Status

Implemented

## Date

2026-05-30

## Context

papai retired several chat-based configuration commands (`/plugin`, `/set`,
and their callback flows: `gsel:`, `cfg:`, `wizard_`, `plg:`, `tgl:`) in favor
of the settings web UI. The `interaction-router.ts` was reduced to a near-empty
safe sink. Before any retired-flow production code can be deleted, a parity
gate must confirm that every capability previously accessible through removed
chat flows has an equivalent in the settings web UI with adequate test
coverage.

Without this gate, removing retired command code risks silently dropping user
capabilities — a regression that would be invisible until a user attempts the
missing flow.

## Decision Drivers

- **No silent regressions**: Every retired chat flow must have a verified
  web-UI equivalent before its production code is removed.
- **Test evidence**: Parity must be backed by existing passing test suites,
  not manual verification.
- **Completion criterion**: All parity rows must be fully green (no partial
  entries) before Phase 2 code deletion begins.

## Considered Options

### Option A: Ad-hoc manual verification

Check each retired command against the settings UI by hand.

- **Pros**: Quick to produce.
- **Cons**: Not repeatable; no evidence trail; easy to miss edge cases.

### Option B: Parity gate table with test-file references (chosen)

Create a structured table mapping each removed chat capability to its UI
equivalent and the test files that cover it. All rows must reach verified
status before code deletion proceeds.

- **Pros**: Auditable; repeatable; directly tied to test suites.
- **Cons**: Requires upfront effort to audit all test files.

### Option C: Require integration/E2E tests for every parity path

Write end-to-end tests that exercise each retired chat flow's UI replacement.

- **Pros**: Highest confidence.
- **Cons**: E2E coverage for all settings routes would take significant
  additional effort; existing unit/client tests already cover the logic.

## Decision

**Option B**: a parity gate table verified against both test suites (server
5,942 tests; client 470 tests — all green).

| #   | Capability (removed flow)                                | UI equivalent                                    | Status |
| --- | -------------------------------------------------------- | ------------------------------------------------ | ------ |
| 1   | `getConfigFieldsForContext` field editing                | `/settings/api/config` GET/PATCH                 | ✅     |
| 2   | Tool toggles (domain + per-tool)                         | `/settings/api/tools` + `/tools/toggle`          | ✅     |
| 3   | MCP add/edit/remove/enable + tool filters                | `/settings/api/mcp`                              | ✅     |
| 4   | Plugin per-context enable/disable; admin approve         | `/settings/api/plugins*`, plugin-approval        | ✅     |
| 5   | Group members, auth, admins, system, instances, announce | `/settings/api/group/*`, `/settings/api/admin/*` | ✅     |
| 6   | Identity link/clear                                      | `/settings/api/identity`                         | ✅     |
| 7   | Kaneo group auto-provision                               | `/settings/api/provision/kaneo`                  | ✅     |
| 8   | Authorization parity (`requireScope` + admin guards)     | Same scope/guard paths in settings API           | ✅     |

Rows 1 and 8 were initially partial (pending `config-parity.test.ts`);
completed once that file landed. All eight rows are now fully verified.

**Sign-off condition**: all rows must be ✅ before Phase 2 code deletion
begins. This condition is now met.

## Consequences

### Positive

- No capability regression when retired-command production code is deleted.
- Every removed chat flow has an auditable mapping to its web-UI replacement.
- Both test suites (5,942 + 470) remain green, confirming no breakage from
  the retirement changes already landed.
- `interaction-router.ts` is safely inert — no active callback flows remain.

### Negative

- The parity table is a point-in-time snapshot; new settings features must
  be checked against it when additional commands are retired in the future.
- Some parity coverage relies on forward-looking test files that were created
  specifically to close the gap (e.g. `config-parity.test.ts`).

### Risks

- If a settings UI route is later removed or refactored without updating the
  parity table, a false-green status could mask a regression.
- Mitigation: the parity table is archived in this ADR and the archived plan;
  future retirement work should produce an updated gate table.

## Implementation Notes

The parity audit covered eight capability categories across the settings API
surface. Key test files providing coverage:

- `tests/debug/settings/config-routes.test.ts` + `config-parity.test.ts`
- `tests/debug/settings/tools-routes.test.ts`
- `tests/debug/settings/mcp-routes.test.ts`
- `tests/debug/settings/plugins-routes.test.ts`
- `tests/debug/settings/admin/roster-plugins-routes.test.ts`
- `tests/debug/settings/group-routes.test.ts`
- `tests/debug/settings/identity-routes.test.ts`
- `tests/debug/settings/provision-routes.test.ts`
- `tests/settings/scope-guard.test.ts`
- `tests/debug/settings/admin/admin-guard.test.ts`
- Corresponding client-side tests in `tests/client/settings/sections/`

`interaction-router.ts` is now a near-empty safe sink with no active callback
routing. All former `gsel:`/`cfg:`/`wizard_`/`plg:`/`tgl:` flows are handled
through the settings web UI.

Archived plan: `docs/archive/2026-05-30-command-retirement-parity-gate.md`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin approval/config flows that
  moved from `/plugin` chat command to the settings UI.
- ADR-0014: Multi-Chat Provider Abstraction — the provider model whose
  instance management moved to `/admin#instances`.
