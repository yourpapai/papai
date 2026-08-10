<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0335: Tier 3 Platform-Adapter Lane — Real Mattermost Adapter Paths In-Container Against Host Fakes, Nightly-Only

## Status

Accepted

## Date

2026-07-25

## Context

The Tier 2 process-real smoke lane (ADR-0332) proved the shipped `papai` image boots, migrates, gates surfaces, completes a chat turn, and drains — all through a fake Mattermost server. But the **real adapter code** remained unproven at the platform boundary: the Mattermost permalink resolver (`fetch_chat_link` → `/api/v4/posts/{id}` + `/api/v4/posts/{id}/thread` REST calls) and the HTTP action-callback route (`POST /mattermost/actions`, signed-context verify + dispatch) had never been exercised end to end against a running adapter. Two Mattermost catalog records (`SCN-fetch-chat-link`, `SCN-http-mattermost-action`) sat pending as `needs-seam@3`, and `LIVE_STORY_TIERS` stopped at `'2'`. The tier-expansion roadmap defines Tier 3 as **platform-adapter**: real adapter code in-container against fake platform servers.

The action-callback scenario needs a seam the T2 lane deliberately avoided: the container verifies action contexts against a secret stored in `system_config`, which is random-generated on first read — a test cannot sign a context it will accept without a way to pin that secret.

## Decision Drivers

- **Prove real adapter paths, not re-prove boot.** The lane's value is the adapter's REST/HTTP behavior (permalink resolution, signed-action verify+dispatch), which T2's handshake-level fake never reached.
- **Reuse, don't copy, the T2 harness.** `fake-llm-server.ts` and `container.ts` are imported verbatim; only `fake-mattermost-server.ts` is extended (single-post + thread GET endpoints, `seedPost`, `observedGets`). No duplicate harness under `tests/platform/`.
- **One narrow, opt-in production seam.** `seedMattermostActionSigningSecretFromEnv()` seeds `system_config[mattermost_action_signing_secret]` only when `PAPAI_MATTERMOST_ACTION_SIGNING_SECRET` is set, via `.onConflictDoNothing` — absent env leaves the random-generate path untouched and an already-stored secret is never overwritten.
- **Nightly only, never a PR gate.** T3 adds Docker wall-clock on top of T2; it lands in a scheduled `nightly.yml` workflow and must never appear in `ci.yml`.
- **Separate-lane structure mirroring T2.** `.platform.ts` non-discovered scenario suffix, a boot-order aggregator (`run-platform.ts`), a candidate-side `PLATFORM_STORIES` registry with byte-stable titles, and a catalog crosscheck tying `@3` records to real `title('SCN-…')` invocations.
- **Minimal frozen-tree change.** The only `tests/stories/` edits are catalog metadata: two records flipped pending → executable with `provingTier: '3'`, `LIVE_STORY_TIERS` gaining `'3'`, and the audit-count expectations that follow.

## Considered Options

### Option 1 — Nightly T3 lane reusing the T2 harness plus one env-secret seam (chosen)

Extend the shared fake Mattermost server with the two GET endpoints the resolver consumes, add the opt-in env-seeded signing-secret seam to `src/chat/mattermost/action-secret.ts` wired into startup, stand up `tests/platform/` with two scenarios (permalink resolver; signed action-callback POST with a wrong-secret control), flip the two catalog pends to `executable@3`, and gate the lane via a scheduled nightly workflow.

- **Pros:** proves the exact adapter behaviors the pends describe; near-zero new harness code; the seam is a few lines, opt-in, and non-overwriting, so production behavior is unchanged when unset; the wrong-secret control proves the seam actually gates verification.
- **Cons:** introduces the first test-only production seam of the tier program (a deliberate exception to T2's zero-`src/`-change rule); nightly cadence means regressions surface up to a day late.

### Option 2 — Mock the signing secret via dependency injection in the test (rejected)

Inject a test secret into the container's DI container from the scenario.

- **Pros:** no production-code change.
- **Cons:** the container is a black box booted from the shipped image — there is no in-process hook to reach; this is indistinguishable from not testing the artifact, the same argument that ruled out in-process boot assertions for T2.

### Option 3 — Fake the Mattermost action UI round-trip instead of signing directly (rejected)

Drive the full interactive-message flow through the fake server so the container mints the context itself.

- **Pros:** no seam at all.
- **Cons:** requires the fake to implement Mattermost interactive-dialog semantics far beyond the two REST endpoints, and still cannot assert the verify+dispatch path for a context the test controls; cost and flakiness outweigh the seam's narrow footprint.

## Decision

Option 1, implemented as:

1. **Fake-server extension.** `tests/smoke/harness/fake-mattermost-server.ts` gains `SeededPost`, `seedPost`, `observedGets`, and `GET /api/v4/posts/{id}` + `GET /api/v4/posts/{id}/thread` handlers placed before the catch-all; unit-tested in the existing harness suite.
2. **Production seam.** `seedMattermostActionSigningSecretFromEnv()` in `src/chat/mattermost/action-secret.ts`, called in `startDatabase()` after `bootstrapInstancesFromEnv()`; `.onConflictDoNothing({ target: systemConfig.key })`; no-op on unset/blank env.
3. **Lane scaffold.** `tests/platform/scenarios/catalog.ts` (`PLATFORM_STORIES`, `PLATFORM_STORY_IDS`, `platformStoryId`), `tests/platform/run-platform.ts` aggregator, and the `test:platform` package script; `.platform.ts` suffix keeps the lane out of default `bun test` discovery.
4. **Two scenarios.** `mattermost-fetch-chat-link.platform.ts` drives a chat turn whose tool loop calls `fetch_chat_link` with a `/pl/<postId>` permalink and asserts the fake observed the single-post and thread GETs; `mattermost-http-action.platform.ts` boots with `PAPAI_MATTERMOST_ACTION_SIGNING_SECRET` set, POSTs a context signed with that secret to `/mattermost/actions` asserting verify+dispatch (no `error`, not "no longer available"), and asserts a wrong-secret control returns the rejection body.
5. **Catalog flip + crosscheck.** `LIVE_STORY_TIERS` becomes `['0', '1', '2', '3']`; both records move from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS` with `provingTier: '3'` and story ids byte-identical to `PLATFORM_STORY_IDS`; `tests/platform/catalog-crosscheck.test.ts` proves the one-to-one mapping and that each scenario file invokes its scenario id; catalog-audit counts updated (140 executable / 25 pending / 3 `needs-seam`).
6. **Nightly CI + docs.** `.github/workflows/nightly.yml` schedules the lane (cron + `workflow_dispatch`, measured `timeout-minutes`, report artifacts); `tests/CLAUDE.md` documents the tier; `ci.yml` carries no T3 reference.

## Rationale

- The two scenarios are the narrowest proofs of the two pending behaviors: permalink resolution is observable purely through the fake's recorded GETs, and action dispatch is observable purely through the HTTP response body — no in-container hooks.
- The env seam satisfies the seam discipline the catalog ledger requires (`needs-seam@3` → a named, minimal seam unblocks it) while being safe in production: unset env is a strict no-op, and `onConflictDoNothing` protects an operator-chosen secret.
- Byte-identical titles across `PLATFORM_STORIES`, the flipped `storyIds`, and `title('SCN-…')` calls, enforced by the crosscheck reading scenario file bytes, keep the minted `@3` records machine-honest — the same ledger discipline as T1/T2.
- Nightly-only placement follows the tier roadmap: Docker lanes that exceed the PR-gate budget graduate to scheduled runs rather than weakening the gate.

## Consequences

### Positive

- Both Mattermost adapter paths (permalink resolver, signed action-callback route) are proven end to end against the real built image.
- The catalog carries its first `@3` records (2); tier 3 is live in `LIVE_STORY_TIERS`; pending `needs-seam` count drops to 3 (the Discord/Telegram interaction pends, deferred until fake discord.js/grammY servers exist).
- The T2 harness investment pays off: the lane adds no harness duplication, only one fake-server extension.
- The seam is reusable by any future test needing a deterministic action-signing secret.

### Negative

- The tier program's zero-`src/`-change streak ends: one production seam exists solely to enable testing (mitigated by opt-in, non-overwriting semantics and unit coverage).
- Nightly cadence means T3 regressions are caught up to ~24h late, not at PR time.
- The nightly workflow's `timeout-minutes` is a backstop estimate until the first green run measures the lane.

### Risks

- Fake Mattermost REST-shape drift from the real API — mitigated by asserting only the fields the resolver consumes and by the crosscheck tying records to invocations.
- Hung container or unreachable host fake in a scheduled job with no human watching — mitigated by readiness timeouts, the job-level `timeout-minutes` backstop, and always-uploaded report artifacts.
- The seam could mask a real secret-rotation bug if misused — mitigated by `onConflictDoNothing` and by the wrong-secret control proving verification still discriminates.

## Related Decisions

- ADR-0324: Tier-Aware Scenario Catalog Ledger — the proving-tier vocabulary and frozen-tree exception this lane uses.
- ADR-0332: Tier 2 Process-Real Smoke Lane — the harness (fakes, container lifecycle, lane structure) this lane reuses and the nightly-graduation precedent.
- ADR-0325: Tier 1 Provider-Real Parity Lane — the tier-lane template (registry + ledger mint + crosscheck).
- ADR-0212: Follow Mattermost Chat Links — the `fetch_chat_link` feature whose resolver path `SCN-fetch-chat-link` proves.

## References

- Plan: `docs/superpowers/plans/2026-07-25-t3-platform-adapter-lane.md`
- Spec: `docs/superpowers/specs/2026-07-25-t3-platform-adapter-lane-design.md`
- Code: `tests/platform/`, `tests/smoke/harness/fake-mattermost-server.ts`, `src/chat/mattermost/action-secret.ts`, `src/runtime/production-deps.ts`, `tests/stories/catalog/coverage.ts`, `.github/workflows/nightly.yml`, `package.json` (`test:platform`)
