<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Grant collection eligibility from the settings consent flow

## Why

No production code path grants analytics collection eligibility, so the
pseudonymous lanes can never emit an event. `decideEligibility`
(`src/analytics/governance/eligibility.ts:143`) denies with
`governance_incomplete` whenever `collectionEligibility` is null;
`getEligibilityRef` (`src/analytics/governance/collection-store.ts:75`) only
returns a ref for a row in state `allow`; and `setEligibilityState`, the sole
writer of `allow`, has zero production callers — only tests reach it. The
settings consent handler `handlePutPreferences`
(`src/debug/settings/analytics-routes.ts:158`) records the lane preference and
grants nothing.

The consequence is not theoretical: a user who opts into
`local_pseudonymous` or `external_pseudonymous` in the settings UI gets a
stored preference and zero collected events, with no error surfaced. Stage C of
`docs/operations/analytics-runbook.md` has no shipped mechanism to enable, and
canonical-event story coverage cannot be written because the runtime cannot
reach the emitting path. Revocation, by contrast, is wired
(`revokeInTx` via `src/analytics/governance/subject-service.ts:158`) — the
system can only ever move toward denial.

## What Changes

- Grant a purpose-keyed collection-eligibility ref when a subject consents to
  a pseudonymous lane through the settings preference handler: derive the ref
  key with `deriveCollectionRefKey` and write `allow` via `setEligibilityState`
  in the same transaction as the preference write.
- Deny and clear the ref when the subject leaves a pseudonymous lane, keeping
  the existing revocation path as the single revoke mechanism.
- Fail the preference write as a unit if the grant cannot be written, so a
  stored consent never outlives its ref.
- Add the runbook operator step for Stage C now that a shipped mechanism
  exists.

## Capabilities

### New Capabilities

- `analytics-collection-eligibility-grant` — the production grant path for
  purpose-keyed collection eligibility. Without it every pseudonymous lane
  denies with `governance_incomplete` forever, Stage C cannot be enabled, and
  canonical-event coverage cannot be written at any tier.

### Modified Capabilities

None under `openspec/specs/`; the governance surface has no capability spec
entry yet.

## Non-goals

- Changing the eligibility decision rules in `decideEligibility` — the gate is
  correct; only the grant is missing.
- Adding a second revocation mechanism — `revokeInTx` already covers it.
- Granting eligibility from anywhere except explicit subject consent: no
  bootstrap grant, no admin override, no default-on. A grant with no consent
  record is exactly the failure the gate exists to prevent.
- Backfilling refs for subjects who already stored a pseudonymous preference
  without a ref — declined; those subjects re-consent through the settings UI.
- Story or aggregate coverage of the newly reachable emitting path — follow-on
  work once the grant ships.

## Impact

- **Code:** `src/debug/settings/analytics-routes.ts` (`handlePutPreferences`),
  `src/analytics/governance/collection-store.ts` (transactional grant helper
  alongside the existing `revokeInTx`).
- **Scope model:** the eligibility ref is keyed per subject, matching the
  existing per-user analytics identity; it is not group-shared and not
  thread-scoped.
- **DB:** no schema change — `analyticsCollectionEligibility`
  (`src/db/analytics-governance-schema.ts`) already carries the row shape; no
  backfill (see Non-goals).
- **Credentials:** the ref is a purpose-keyed pseudonym derived through the
  governance keyring; the raw subject identifier is never persisted or logged.
- **Docs:** `docs/operations/analytics-runbook.md` Stage C;
  `docs/architecture/overview.md` `/stats/*` anonymity contract if the grant
  changes what a lane can emit.
- **Legacy:** closes the residual recorded in
  `docs/archive/2026-08-04-analytics-derive-storage-coverage.md`
  (Tasks 2-4, abandoned 2026-08-20).
