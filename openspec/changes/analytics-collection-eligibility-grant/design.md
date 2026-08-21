<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Collection-eligibility grant

## D1 — Evidence for the gap

The gap was confirmed by probe, not inference. `decideEligibility` returns
`denied('governance_incomplete')` when `input.collectionEligibility === null`
(`src/analytics/governance/eligibility.ts:143`). `buildDecide`
(`src/analytics/start-analytics.ts:96-142`) supplies that field from
`readCollectionRef`, which resolves through `getEligibilityRef`
(`collection-store.ts:75`) and requires a row in state `allow`.
`setEligibilityState` (`collection-store.ts:135`) is the only writer of `allow`
and is called from no file under `src/`. A runtime probe on a subject with a
stored `external_pseudonymous` preference emitted zero canonical events and the
denial reason `governance_incomplete`.

## D2 — Grant belongs at the consent boundary, not at runtime start

The alternative placements were rejected:

- **At analytics runtime start**, deriving the ref from the stored preference.
  Rejected: it manufactures consent from a preference row. The gate exists
  precisely to require a separate, recorded consent artifact; deriving one from
  the other collapses the two into one and makes the gate decorative.
- **In `start-analytics.ts`'s `buildDecide`**, treating a null ref as
  permissive. Rejected for the same reason, and it would silently widen every
  existing deployment.

`handlePutPreferences` (`src/debug/settings/analytics-routes.ts:158`) is the
one place a subject's explicit choice arrives. The grant goes there.

## D3 — Existing module covers the write

`collection-store.ts` already owns the eligibility table, the ref derivation
(`deriveCollectionRefKey`, `COLLECTION_ELIGIBILITY_DOMAIN =
'collection-eligibility:v1'`), and a transactional revoke
(`revokeCollectionEligibilityInTx`). The grant is its symmetric twin and lives
in the same module — a new module would split one table's writers across two
files. `setEligibilityState` stays as the non-transactional primitive the
transactional helper wraps.

## D4 — Atomicity

The preference write and the grant share one drizzle transaction. This is what
makes "a stored pseudonymous preference always has a ref" an invariant rather
than an eventual-consistency hope, and it is the reason the grant helper is
`...InTx`-shaped like the existing revoke rather than a standalone call after
the preference commits.

## D5 — Scope model

The eligibility row is keyed per subject, matching the existing per-user
analytics identity — not the config context id (group-shared) and not the
storage context id (thread-isolated). A group-shared grant would let one
member's consent enable collection for everyone in the group, which the
governance model does not permit.

## D6 — No migration, no backfill

`analyticsCollectionEligibility` in `src/db/analytics-governance-schema.ts`
already has the row shape; nothing changes in the schema. Subjects who stored a
pseudonymous preference before this change have no ref and keep collecting
nothing until they re-consent — backfilling would grant eligibility no subject
ever gave, the exact failure D2 rejects.

## D7 — Capability / tool-prefs gating

None. This is a settings HTTP surface, not a tool; no capability id and no
`tool_prefs` entry.

## D8 — Hook / TDD order

Both touched files are existing production modules the Write/Edit TDD hook
gates, so tests come first: the transactional grant helper's unit tests in
`tests/analytics/`, then the settings-handler tests covering grant on opt-in,
clear on opt-out, and rollback on grant failure, then the implementations. The
"no grant without consent" requirement is proven by a runtime-start test that
asserts a denial, which must be written before the grant lands so it cannot
pass vacuously.

## D9 — Logging

The grant logs at `info` with the lane and the derived ref key only. The raw
subject identifier and any keyring material are excluded, consistent with the
project rule against logging sensitive data and with the `/stats/*` anonymity
contract in `docs/architecture/overview.md`.
