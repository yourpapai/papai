<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See `proposal.md` — Why. The eligibility machinery already exists and is
correct on the enforcement side: `insertEligibleCanonicalEvent` re-checks an
`allow` row transactionally (src/analytics/governance/collection-serialization.ts:201),
and `start-analytics.ts:83` reads the ref at decision time. The only missing
piece is a production writer for the `allow` state. The deny side has one
(`revokeEligibilityInTx`, used by withdraw). `setEligibilityState`
(collection-store.ts:135) already implements allow/deny upsert with rekey
dual-write mirroring — it simply has no caller outside tests.

## Goals / Non-Goals

Goals: make the settings preferences PUT the provisioning surface for
collection eligibility; keep enforcement, rekey mirroring, and subject-rights
revocation untouched.

Non-Goals (beyond the proposal's): no change to the eligibility ref
derivation (`deriveCollectionRefKey`, governance keyring domain
`collection-eligibility:v1`); no UI copy changes in the SPA beyond what the
existing Analytics section already renders.

## Decisions

### D1: Provision inside the preferences PUT handler (reuse, not new code)

Extend `handlePutPreferences` (src/debug/settings/analytics-routes.ts:140):
after `setPreference` for the `local_longitudinal` lane, call
`setEligibilityState` with `allow` when the value is `allow`, and
`revokeEligibilityInTx` semantics (via `setEligibilityState` with `deny`)
when `deny`. `deriveCollectionRefKey` needs the governance keyring's active
key + `platformInstanceId`/`platformUserId` from the authenticated principal —
all already available in the handler (`identityOf`, `activeGovernanceKey`).

Alternative considered: provision lazily at event time when the preference
row says `allow`. Rejected: `readPreferences` and `readCollectionRef` are
deliberately read-path functions on the hot per-fact decision path; adding a
write there couples collection to eligibility mutation and races withdrawal.
An explicit actor act in settings also matches the runbook's "explicit test
actors" requirement.

### D2: One route transaction is not added — two writes, order matters

The preference row and the eligibility row are separate writes (preference
store and collection store each own their transaction, and both already
handle rekey dual-write mirroring internally). Order: preference first, then
eligibility. A crash between them leaves preference `allow` with no
eligibility ref — events degrade to aggregate-only, which is the fail-closed
state and self-heals on the next PUT (idempotent upsert). The reverse order
would allow collection while the preference still reads `unknown`, which is
worse. No cross-store transaction is invented.

### D3: `deny` uses `setEligibilityState`, not a raw revoke

`setEligibilityState(..., 'deny')` upserts (creates a denied row if none
exists) and bumps generation monotonically; `revokeEligibilityInTx` alone is
a no-op when no row exists. The upsert form is what the route needs so a
never-allowed actor can still record an explicit deny.

### D4: Key version for the ref

Use the governance keyring's active version — same as `readCollectionRef`
does at decision time (start-analytics.ts:88-93) — so the provisioned ref is
the one the runtime actually resolves. Key rotation re-mirrors eligibility
rows via the existing governance dual-write resolver inside
`setEligibilityState`; nothing new is needed for rekey.

### Scope model and gating impact

New persisted state: none (existing `analytics_collection_eligibility` rows,
keyed by refKey = HMAC over `platformInstanceId|platformUserId` — per-user
identity scope, not storage/config context). No new tools, so no tool_prefs /
capability gating impact. Platform-agnostic: works for actors on any platform
instance because identity comes from the authenticated settings principal.

### DB changes

None. No migration, no backfill. (Rows written while the lane was dark were
correctly aggregate-only at decision time; re-deriving them as canonical would
falsify governance provenance.)

### TDD / hook interactions

The Write/Edit hook pipeline gates every new/changed file under `src/` and
`tests/`: tests land first, watch them fail, then the handler change makes
them pass. Files touched: `src/debug/settings/analytics-routes.ts` and one
test file (extend the existing settings analytics route suite if present,
else `tests/analytics/governance/` route-level tests). `setEligibilityState`
is already covered by `tests/analytics/governance/collection-store.test.ts`;
the new coverage is route-level wiring only. Mutation ratchet will measure
the touched handler file.

## Risks / Trade-offs

- [Crash between preference and eligibility writes] → fail-closed
  (aggregate-only) until the actor re-saves; idempotent upsert heals it.
- [Actor allows but policy mode is `local_aggregate`] → ref exists, unused;
  harmless — decision path checks mode first (eligibility.ts:129).
- [Existing deployments with preference `allow` already set] → ref still
  absent until the actor re-PUTs once; acceptable for a single controlled
  installation (the pilot operator re-saves preferences after deploy).

## Migration Plan

Deploy is code-only. Rollback: revert the handler change; already-provisioned
`allow` rows keep granting eligibility — if full rollback is wanted, the
operator PUTs `deny` (or withdraws) which revokes. No schema rollback needed.

## Open Questions

None.
