<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Route-level tests (fail first)

- [x] 1.1 Add failing tests to the settings analytics route suite: PUT
  `localLongitudinal: "allow"` provisions an `allow` row in
  `analytics_collection_eligibility` for the authenticated principal's derived
  ref (assert via `getEligibilityRef`), and the response still returns the
  updated preference. Verify: `bun test tests/analytics/governance/` (new
  cases red)
- [x] 1.2 Add failing tests: PUT `localLongitudinal: "deny"` transitions an
  existing `allow` ref to `deny` with a generation bump; second deny PUT is
  idempotent (200, state stays `deny`); PUT without `localLongitudinal` (only
  `externalPseudonymous`) does not touch eligibility. Verify:
  `bun test tests/analytics/governance/` (red)
- [x] 1.3 Add failing end-to-end wiring test: with an `allow` ref provisioned
  via the route and policy `local_pseudonymous`, `insertEligibleCanonicalEvent`
  stores a canonical event; after deny, the same insert path returns
  `not_eligible` and bumps `governance_ineligible` counters. Verify:
  `bun test tests/analytics/governance/` (red)

## 2. Handler implementation

- [x] 2.1 In `src/debug/settings/analytics-routes.ts` `handlePutPreferences`:
  when `localLongitudinal` is present, derive the collection ref key from the
  governance keyring active key/version + authenticated identity and call
  `setEligibilityState` with the matching state (design D1–D3: preference
  write first, then eligibility). No new module. Verify:
  `bun test tests/analytics/governance/` (green)

## 3. Gates and docs

- [x] 3.1 Run the full gates: `bun run test`, then `bun run typecheck`,
  `bun run lint`, `bun security` (route touches identity-derived keys).
  Inspect failures via `bun run test:failures` / `test:show`.
- [x] 3.2 Update docs: one line in `docs/operations/analytics-runbook.md`
  Stage C Operate (opt-in for pilot actors happens via settings preferences);
  append the fix note to the 2026-08-20 incident in
  `docs/research/analytics-metrics/11-stage-c-evidence.md` once shipped.
