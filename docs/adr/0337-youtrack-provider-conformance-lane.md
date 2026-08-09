<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0337: YouTrack Provider Conformance Lane — Binding the Shared Parity Groups to a Stateful Fake YouTrack Server

## Status

Accepted

## Date

2026-07-25

## Context

The Tier 1 parity lane (ADR-0325) established a frozen, provider-agnostic expectation module (`PARITY_GROUPS` under `tests/stories/harness/parity/`) proven against the `MemoryTaskProvider` fake and the real Kaneo container. The YouTrack provider (`plugins/task-provider-youtrack/`) is the second real `TaskProvider` implementation, but it had no binding to those shared groups — request-building, response-mapping (custom fields, bundle values, relations), and `TaskProvider` contract conformance for YouTrack were asserted only by unit-level fetch mocks, never end-to-end against the shared contract.

Unlike Kaneo, no Dockerized YouTrack image is available in the harness, so a real-container binding was not an option. At the same time, the frozen tree (`tests/stories/**`) cannot be touched without moving the `treeHash`, and the catalog lane does not catalog this suite — it is an uncatalogued conformance lane.

## Decision Drivers

- **Reuse the shared contract, don't fork it.** The lane must run the same `PARITY_GROUPS` assertions, imported outward from the frozen module (`frozen ← candidate`), never editing frozen files.
- **Fully hermetic.** No Docker, no network egress, no new dependencies; `Bun.serve` on an OS-assigned port (`port: 0`) with full teardown.
- **No frozen-tree drift, no catalog record, no CI job.** Everything lives under `tests/plugins/task-provider-youtrack/parity/` and rides along on the default `bun test`.
- **The fake is authored, not a fidelity model.** The lane proves request-building + response-mapping + contract conformance; it explicitly does *not* prove drift against a live YouTrack, since both the fake and the expectations are authored here.
- **Fake drift fails locally.** The fake's projection/custom-field/error shapes are pinned by their own unit tests independent of the provider.
- **Honest exclusions.** Shared groups that cannot map to YouTrack (e.g. `startDate` round-trips — `mapIssueToTask` emits no `startDate`; labels; identity; project-shape divergence) are recorded in `YOUTRACK_PARITY_EXCLUSIONS` with concrete reasons, guarded by integrity tests (ids real, unique, run-set arithmetic), never silently skipped.

## Considered Options

### Option 1 — Stateful in-memory fake YouTrack + outward binding of shared `PARITY_GROUPS` (chosen)

Author a `Bun.serve` fake modeling exactly the `fields=` projection, custom-field/bundle, issue/comment/link shapes `YouTrackProvider` builds and parses; construct the real provider with `baseUrl = fake.url`; run `PARITY_GROUPS` minus a recorded exclusion set, plus YouTrack-only custom-field extension groups (`SCN-youtrack-custom-field-status/priority`).

- **Pros:** hermetic (no Docker); reuses the shared contract so a YouTrack conformance gap is the same failure class as Kaneo's; exclusion integrity tests make the run set auditable (`PARITY_GROUPS − exclusions`, nothing silently dropped); custom-field extension groups prove YouTrack's State/Priority bundle round-trip that the provider-agnostic module cannot assert.
- **Cons:** proves conformance to an authored fake, not to a real YouTrack — a real-API shape change would not be caught here; the fake is a new maintenance surface (~6 files).

### Option 2 — Dockerized real YouTrack binding (rejected)

Mirror the Kaneo Tier 1 lane with a real YouTrack container.

- **Pros:** true fidelity against the live API surface.
- **Cons:** no pinned YouTrack image exists in the harness; adds heavy Docker wall-clock to the gate; licensing/startup complexity of a proprietary product in CI; disproportionate for a conformance (not fidelity) goal.

### Option 3 — Unit-level fetch mocks only (rejected)

Keep asserting YouTrack behavior purely through mocked `fetch` responses per operation.

- **Pros:** zero new infrastructure.
- **Cons:** each mock pins an isolated request/response pair; nothing exercises the provider's full request-building → response-mapping chain against the shared `TaskProvider` contract, so cross-cutting mapping drift (e.g. custom-field payload shapes) is never caught as an integrated failure.

## Decision

Option 1, implemented as:

1. **Fake server.** `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts` — `startFakeYouTrackServer(): { url; stop(); reset() }` over `Bun.serve` (port 0), stateful in-memory store for projects/issues/comments/links, `fields=` projections, State/Enum bundle values, YouTrack query interpretation (project filter, free-text search, `sort by:`, `$top`/`$skip` paging), YouTrack-shaped error bodies. Pinned by `fake-youtrack-server.test.ts`.
2. **Exclusion set.** `youtrack-parity-exclusions.ts` — six groups with reasons (two `startDate` groups, label groups, identity, `SCN-parity-project-crud` normalized-shape divergence), guarded by `youtrack-parity-exclusions.test.ts`.
3. **Extension groups.** `youtrack-custom-field-groups.ts` — status/priority round-trip through YouTrack's custom-field model (values are YouTrack-specific, so these live outside the frozen module).
4. **Binding runner.** `provider-conformance.test.ts` — `new YouTrackProvider({ baseUrl: fake.url, token })` per group over `PARITY_GROUPS − exclusions + extension groups`; genuine structural divergences earn an exclusion with a reason, fixable fake gaps get fixed, never masked.

## Rationale

- The outward-only import direction keeps the frozen tree's `treeHash` untouched while still making YouTrack conformance a falsifiable claim against the same assertions Kaneo and the fake binding run.
- An authored fake is the only hermetic option for YouTrack; scoping the claim honestly to "request-building + response-mapping + contract conformance" (in file headers and here) avoids overpromising fidelity.
- Recording exclusions with reasons + integrity arithmetic keeps the run set honest — a conformance gap is reported, never hidden.

## Consequences

### Positive

- YouTrack provider conformance to the shared `TaskProvider` contract is now a test failure, not a production discovery; `bun test tests/plugins/task-provider-youtrack/` covers it with no new script, catalog record, or CI job.
- The lane is a third binding of the frozen parity module, further validating the ADR-0325 shared-expectation pattern as the repeatable template for new providers.
- YouTrack's distinguishing surface (State/Enum custom-field bundle resolution) has dedicated round-trip proof.

### Negative

- Real-YouTrack API drift is out of scope; if YouTrack changes its REST shapes, only a future real-container lane would catch it.
- The fake (~22 KB) plus its pinning tests are a new maintenance surface that must evolve with provider mapper changes.
- New parity-relevant provider behaviors need both a shared group and an eligibility check against the exclusion set.

### Risks

- Fake/authored-expectation co-drift (both sides wrong in the same way) — mitigated by the fake's independent unit tests pinning its shapes to the provider source, and by the Task 8 iterate-to-green gate forbidding exclusions that mask fixable fake gaps.
- Exclusion set silently growing stale — mitigated by the integrity tests (every id must name a real `PARITY_GROUPS` id, run set = total − exclusions).

## Related Decisions

- ADR-0325: Tier 1 Provider-Real Parity Lane — the frozen expectation module and outward-binding pattern this lane extends to a third binding.
- ADR-0324: Tier-Aware Scenario Catalog Ledger — the tier vocabulary; this lane is deliberately uncatalogued (no ledger mint).
- ADR-0202: YouTrack Dedicated Fields and Teaching Errors — the YouTrack custom-field model the fake seeds and the extension groups exercise.
- ADR-0209: YouTrack Relation Linking — the `issueLinkTypes`/link-id direction-suffix flow the fake's relations handler models.

## References

- Plan: `docs/superpowers/plans/2026-07-25-youtrack-provider-conformance-lane.md`
- Code: `tests/plugins/task-provider-youtrack/parity/`, `plugins/task-provider-youtrack/provider.ts`
