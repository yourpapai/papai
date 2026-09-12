<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Collection-eligibility grant

## 1. Pin the current behavior

- [x] 1.1 Failing-first regression test: a subject with a stored
      `external_pseudonymous` preference and no eligibility row produces a
      decision denied with `governance_incomplete` at runtime start, and no
      row is created. This must pass before and after the change.
      Verify: `bun test tests/analytics/`

## 2. Transactional grant helper

- [x] 2.1 Failing tests for a `grantCollectionEligibilityInTx` helper in
      `src/analytics/governance/collection-store.ts`: derives the ref key via
      `deriveCollectionRefKey` under `collection-eligibility:v1`, writes state
      `allow`, is idempotent for a repeated grant, and persists no raw subject
      identifier. Then implement it alongside the existing revoke helper.
      Verify: `bun test tests/analytics/governance/`

## 3. Wire the consent boundary

- [x] 3.1 Failing tests for `handlePutPreferences`
      (`src/debug/settings/analytics-routes.ts`): opting into
      `local_pseudonymous` or `external_pseudonymous` grants the ref in the
      same transaction as the preference write; aggregate lanes and `off`
      grant nothing. Then implement.
      Verify: `bun test tests/debug/settings/`
- [x] 3.2 Failing tests for the clear path: switching from a pseudonymous
      lane to an aggregate lane or to `off` clears the ref through the
      existing revocation path in the same transaction. Then implement.
      Verify: `bun test tests/debug/settings/`
- [x] 3.3 Failing test for atomicity: when the grant write raises, the
      preference write rolls back, the handler returns an error, and the
      stored lane is unchanged. Then implement.
      Verify: `bun test tests/debug/settings/`

## 4. Prove the path is now reachable

- [x] 4.1 Test that after a granted consent the pseudonymous decision admits
      and the derive job writes at least one canonical event.
      Verify: `bun test tests/analytics/`
- [x] 4.2 Assert the grant's log record carries the lane and derived ref key
      and no raw subject identifier or keyring material.
      Verify: `bun test tests/analytics/governance/`

## 5. Docs and close out

- [x] 5.1 Add the Stage C operator step to
      `docs/operations/analytics-runbook.md` now that a shipped grant
      mechanism exists; review the `/stats/*` anonymity contract in
      `docs/architecture/overview.md` for changes.
      Verify: docs updated in the same commit as the wiring
- [x] 5.2 Run `bun test`, `bun run typecheck`, `bun run lint`, and
      `bun security` (credential/consent surface).
      Verify: all commands exit 0
