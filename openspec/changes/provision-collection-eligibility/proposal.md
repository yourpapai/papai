<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

Since the Stage C flip to `local_pseudonymous` (2026-08-15), the pseudonymous
lane has collected **zero** canonical events: no production caller ever writes
the `allow` row into `analytics_collection_eligibility`
(`setEligibilityState` in `src/analytics/governance/collection-store.ts` has
only test callers), so `decideEligibility` denies every non-guest actor with
`governance_incomplete` and all events degrade to aggregate-only. The deny side
is wired (`revokeEligibilityInTx` via subject withdraw); the allow side is
missing. Without this fix the Stage C pilot cannot accrue data, and the
export/withdraw/delete and hand-calculation drills have nothing to exercise.

## What Changes

- `PUT /settings/api/analytics/preferences` with
  `localLongitudinal: "allow"` also provisions the actor's collection
  eligibility ref (`state=allow`) in the same logical operation as the
  preference write.
- The same route with `localLongitudinal: "deny"` revokes the ref
  (`state=deny`, generation bump), so subsequent canonical inserts fail closed.
- Withdraw/delete paths keep their existing independent revocation (no behavior
  change there, but the preference deny path no longer leaves a dangling
  `allow` ref).

## Capabilities

### New Capabilities

- `analytics-subject-eligibility`: an authenticated actor can grant and revoke
  their own local-pseudonymous collection eligibility through the settings
  preferences surface; eligibility is the gate that canonical event insertion
  re-checks transactionally.

  Without it: opting in via preferences is a silent no-op — the preference row
  says `allow` while every event keeps landing aggregate-only, and the actor
  has no working way to enter the pseudonymous lane at all.

### Modified Capabilities

(none — no existing OpenSpec capability covers analytics governance; the
telemetry-metrics capability is OTel operational metrics, unrelated. The
eligibility machinery itself already exists in
`src/analytics/governance/collection-store.ts`; this change wires its allow
side to the settings route in `src/debug/settings/analytics-routes.ts`.)

## Impact

- Code: `src/debug/settings/analytics-routes.ts` (preferences PUT handler);
  no schema changes (`analytics_collection_eligibility` already exists with
  rekey dual-write mirroring inside `setEligibilityState`).
- Scope: identity is per-user (governance actor key derived from
  platformInstanceId + platformUserId) — platform-agnostic, applies to actors
  of any platform instance; no group/thread-scoped state touched.
- Docs: `docs/operations/analytics-runbook.md` (Stage C operate — the
  "explicit test actors" opt-in now happens via the settings UI);
  `docs/research/analytics-metrics/11-stage-c-evidence.md` records the
  incident and unblocks the drills.
- Tests: settings route tests for allow→ref provisioned, deny→ref revoked,
  idempotency, and the interaction with `readCollectionRef` at event time.

## Non-goals

- No external-lane (`external_pseudonymous`) eligibility provisioning — Stage E
  stays closed; its delivery-grant provisioning is declined until a sink
  passes the Stage E gate.
- No admin bulk-provisioning surface for pilot actors — per-actor opt-in via
  settings is sufficient for the single controlled installation.
- No change to eligibility derivation/recheck semantics, epoch counters, or
  reconciliation — the fail-closed insert path is correct as-is.
- No backfill of events lost while the lane was dark; they were correctly
  classified aggregate-only at write time.
