<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Pin plugin-manifest rejection identity

## Why

The mutation ratchet fails this branch: `src/plugins/types.ts` scores 0.5594
against a 0.5725 floor, and because the file did not change on the last push
the score carries over — every future push keeps failing until it is fixed.
It is one of two red CI jobs blocking PR #201.

The score is a symptom. A paired run reports 63 surviving mutants, and 40 of
them are the `message` and `path` of the nine `.refine()` calls on
`pluginManifestSchema`. Existing tests assert that a bad manifest is rejected;
none assert *which* rejection a plugin author gets. Every rejection message can
be replaced with `""` and every `path` emptied without a single test failing —
so the manifest validator's entire diagnostic surface, which is the only thing
telling an author what is wrong with their plugin, is unverified.

The newest refine is the one this branch added:
`providerAllowedInstanceHostsFromConfig`. Its values become operator-trusted
hosts that bypass the https and public-IP checks in the provider runtime
(`src/plugins/dynamic-hosts.ts`), so a manifest field that silently validated
against the wrong config schema would widen a security boundary. That refine is
currently pinned only by the predicate's own unit tests, not by the schema
wiring.

## What Changes

- Assert rejection identity — the exact `message` and `path` — for each of the
  nine `pluginManifestSchema` refines, including the two host-allowlist ones.
- Assert the schema's declared defaults survive an omitted field:
  `storageScope` defaults to `'context'`, `sensitive` defaults to `false`, and
  each `.optional().default([])` array field parses to `[]` rather than
  `undefined`.
- Assert the `version` field's semver regex accepts a prerelease and a build
  identifier and rejects a partial version, pinning the pattern that nine
  mutants currently survive.
- Assert both arms of the `providerConfigValidator` refine — declared without
  `contributes.taskProviderTypes` rejects; declared with it passes.

## Capabilities

### New Capabilities

- `plugin-manifest-validation` — the plugin manifest's parse contract as
  observed by a plugin author: which manifests are rejected, the identity of
  each rejection, and what an omitted optional field parses to. Without it the
  diagnostic surface is unspecified and unverified, and the instance-host
  allowlist — a security boundary — is pinned only one layer below the schema
  that gates it.

### Modified Capabilities

None. `openspec/specs/` has no entry for the plugin manifest surface.

## Non-goals

- Changing any validation rule, message, or path. This change pins current
  behavior; a message that reads badly is a separate change.
- Re-testing the predicates in `src/plugins/manifest-validation.ts` — they have
  their own passing tests at 0.6838, and duplicating them would not touch the
  surviving mutants, which are all in the schema wiring.
- Raising `src/plugins/types.ts` to a target score. The floor is met as a
  consequence of pinning real behavior; adding assertions chosen to kill
  mutants rather than to state a contract is declined.
- The other red CI job (the Tier 0 coverage floor) — already tracked as
  `story-coverage-floor-qualification`.
- Adding a manifest field, or changing how `deriveInstanceHosts` resolves hosts.

## Impact

- **Tests:** `tests/plugins/manifest-schema.test.ts` primarily; adjacent
  manifest suites (`manifest-mcp.test.ts`, `types.test.ts`) if a rejection is
  already exercised there without its identity asserted.
- **Production code:** none. No plugin, provider, or schema behavior changes.
- **Platform/task instances, scope model, DB, dependencies:** none.
- **Security:** pins the schema gate on
  `providerAllowedInstanceHostsFromConfig`, whose values bypass https and
  public-IP checks for operator-set task-instance config.
- **CI:** clears the `Mutation Testing (paired, changed files)` job; the
  `src/plugins/types.ts` entry in `scripts/mutation/baseline.json` ratchets up
  on the next master seed.
- **Docs:** `docs/plugins/developer-guide.md` if a pinned message turns out to
  contradict what the guide documents.
