<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: T3 platform-adapter lane (scaffold + Mattermost vertical)

**Status:** proposed

**Date:** 2026-07-25

## Context

The tier-expansion roadmap (`2026-07-23-tier-expansion-roadmap-design.md`,
lines 72, 132) charters **Tier 3** as "real grammY / discord.js / Mattermost
client code exercised against fake platform **servers** (HTTP/WS)" — not
library-level fakes — and declares it a **Nightly** lane, never a PR gate. T2
(this branch) already built the reusable out-of-process machinery T3 was meant
to reuse: a deterministic OpenAI-compatible fake LLM server
(`tests/smoke/harness/fake-llm-server.ts`), a fake Mattermost REST+WS server
(`tests/smoke/harness/fake-mattermost-server.ts`), and a container harness that
boots the real built image against those fakes
(`tests/smoke/harness/container.ts`).

The scenario catalog (`tests/stories/catalog/coverage.ts`) carries five pends
whose `unblockedByTier` is `'3'`. This spec builds the T3 lane **scaffold** plus
the **Mattermost vertical** — the two Mattermost pends
(`SCN-fetch-chat-link`, `SCN-http-mattermost-action`). The three Discord/Telegram
pends (`SCN-interaction-discord-router-wrapped`,
`SCN-interaction-discord-standalone-fallback`, `SCN-interaction-telegram-callback`)
stay `needs-seam@3` and are deferred to later cycles that add fake grammY/Telegram
and discord.js servers.

## Goals

- Stand up `tests/platform/` as a fourth live tier lane, mirroring the T2 smoke
  lane's separate-lane structure (non-discovered suffix, boot-order aggregator,
  catalog crosscheck), and make tier `'3'` live.
- Prove two Mattermost adapter paths against the real built image talking to a
  fake Mattermost server, in-container (extending the T2 harness):
  - `SCN-fetch-chat-link`: the Mattermost permalink/thread REST resolver
    (`resolveChatLink`) resolves a `/pl/<postId>` link through the adapter.
  - `SCN-http-mattermost-action`: the HTTP action-callback route
    (`handleMattermostActionRequest`) verifies a signed context and dispatches.
- Flip the two Mattermost catalog pends from `needs-seam` to
  `executable(provingTier:'3')`, enforced by a catalog crosscheck test.
- Run the lane in CI as a **Nightly** job (never a PR gate), with a measured
  wall-clock budget, mirroring the T2 smoke job.

## Non-goals

- The Discord and Telegram verticals (three remaining `@3` pends) — deferred;
  they require fake discord.js / grammY servers not built here.
- Any change to T0/T1/T2 lanes, or to how catalog coverage is computed.
- A PR-gating T3 job. T3 is Nightly per the roadmap.
- Coverage collection for the T3 lane (Item 2 covers T0; T3 coverage is out of
  scope).
- Production behavior change beyond the single, narrowly-scoped action-secret
  env seam described in §4.

## Design

### 1. Lane scaffold — `tests/platform/`

Mirror the T2 smoke lane structure one-for-one:

```
tests/platform/
  scenarios/
    mattermost-fetch-chat-link.platform.ts
    mattermost-http-action.platform.ts
  run-platform.ts               # boot-order aggregator (mirrors run-smoke.ts)
  catalog-crosscheck.test.ts    # binds @3 executable records <-> scenario invocations
```

No `tests/platform/harness/` directory is created: `fake-llm-server.ts` and
`container.ts` are imported from `tests/smoke/harness/`, and the fake Mattermost
server is **extended in place** in the shared `tests/smoke/harness/` module (§2).

- **Suffix `.platform.ts`** for scenario files — a non-discovered suffix so the
  default `bun test` (and every in-process suite) never boots Docker, exactly as
  `.smoke.ts` keeps the T2 lane out of default discovery.
- **Reuse, don't copy, the shared harness.** `fake-llm-server.ts` and
  `container.ts` are imported across from `tests/smoke/harness/` — no
  duplication. The Mattermost fake gains T3-specific endpoints **in place** in
  the shared `tests/smoke/harness/fake-mattermost-server.ts` (§2), keeping one
  fake Mattermost server for both lanes.
- **`run-platform.ts`** registers every `.platform.ts` scenario in boot order and
  is invoked by the `test:platform` package script, mirroring
  `tests/smoke/run-smoke.ts` + `test:smoke`.
- **Make tier `'3'` live.** `tests/stories/catalog/coverage.ts` line 16 freezes
  `LIVE_STORY_TIERS = Object.freeze(['0','1','2'])`. Add `'3'`. `STORY_TIERS`
  already includes `'3'` and `TIER_SUITE_ROOTS['3']` already maps to
  `tests/platform/`, so no other catalog wiring changes.

### 2. Fake Mattermost server extension

`resolveChatLink` (`src/chat/mattermost/link-resolver.ts`) calls, via `apiFetch`:

- `GET /api/v4/posts/{postId}` — the linked post
- `GET /api/v4/posts/{rootId}/thread` — the thread around it
- `GET /api/v4/channels/{channelId}` — already served by the T2 fake
- `GET /api/v4/channels/{channelId}/members/{requesterUserId}` — already served

The T2 fake (`fake-mattermost-server.ts`) serves the two channel endpoints, a
catch-all `GET /api/v4/*` → `{}`, `POST /api/v4/posts`, `GET /api/v4/users/me`,
and the WebSocket. It does **not** serve the single-post or thread endpoints. Add
two handlers:

- `GET /api/v4/posts/{id}` → a seeded post object.
- `GET /api/v4/posts/{id}/thread` → a Mattermost thread payload
  (`{ order: [...], posts: {...} }`) for the seeded post.

Add a small seeding surface to `FakeMattermostServer` (e.g. `seedPost(post)`) so
a scenario can register the post the permalink points at before driving the turn.
These endpoints and the seeding method are additive and backward-compatible; the
T2 smoke scenarios are unaffected because they never call them. Therefore the
extension lands **in `tests/smoke/harness/fake-mattermost-server.ts`** (shared,
imported by both lanes) rather than as a separate T3 fork — keeping one fake
Mattermost server as the single source of truth.

### 3. Scenario — `SCN-fetch-chat-link` (zero src/ change)

The container is provisioned as a real Mattermost instance from env
(`MATTERMOST_URL` → the fake server; `MATTERMOST_BOT_TOKEN`; `CHAT_PROVIDER=mattermost`),
so `resolveChatLink` loads that instance from the DB and resolves against the
fake. No production change is needed.

`tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts`:

1. Boot: fake LLM + extended fake Mattermost + container
   (`buildContainerEnv({ llmBaseUrl, mattermostUrl })`), mirroring
   `container-p.smoke.ts`.
2. `mm.seedPost(...)` a post in a channel the admin belongs to; the permalink is
   `{MATTERMOST_URL}/pl/<postId>` (host matches the env-provisioned instance
   baseUrl so `parseMattermostPermalink` accepts it).
3. Drive a chat turn over the fake WS whose enqueued LLM tool call invokes the
   chat-link fetch tool with that permalink; assert the reply contains the
   resolved post content, and that the fake observed the
   `GET /api/v4/posts/{id}` (+ `/thread`) calls.

Catalog: re-point the F3 record from
`needs('F3', ['capability-ids','platform-adapter-fakes'], '3', …)` to
`executable({ provingTier: '3', storyIds: ['SCN-fetch-chat-link'] })`.

### 4. Scenario — `SCN-http-mattermost-action` + the action-secret env seam

**The seam.** The action route (`handleMattermostActionRequest`) verifies the
signed context with a secret sourced, in production, from
`getMattermostActionSigningSecret()` — a **random** value generated on first use
and stored in `system_config[mattermost_action_signing_secret]`
(`src/chat/mattermost/action-secret.ts:19,34`), never surfaced outside the
container. The DI override (`mattermostActionSecretForTest`,
`src/debug/server-route-options.ts`) is in-process only and cannot cross the
container boundary. To let an in-container test sign a valid context, the process
must accept a **known** signing secret from the environment.

**Production change (one reviewed seam commit).** Add an idempotent startup seed:

- New `seedMattermostActionSigningSecretFromEnv()` in
  `src/chat/mattermost/action-secret.ts`: if
  `getTrimmedEnv('PAPAI_MATTERMOST_ACTION_SIGNING_SECRET')` is set, insert it
  into `system_config[mattermost_action_signing_secret]` with
  `.onConflictDoNothing({ target: systemConfig.key })` (never overwrites an
  existing operator-chosen or already-generated secret).
- Call it once at startup, **after DB migrations** (so `system_config` exists)
  and **independent** of `bootstrapInstancesFromEnv()`'s "already-bootstrapped"
  early return (the secret is orthogonal to instance seeding). The existing
  `getMattermostActionSigningSecret()` DB read then returns the env-seeded value
  with no further change to `action-callbacks.ts` or the route wiring.

This is a legitimate ops feature (pinning the action signing secret across
restarts / multiple instances), not test-only scaffolding, and realizes the
`mattermost-action-fixture` seam recorded in the catalog.

**Deterministic identity.** `seedInstances` (`src/instances/bootstrap.ts:95`)
assigns `platformInstanceId = '${chatType}-default'`, so the container's
Mattermost instance is `mattermost-default` — known to the test up-front. The
Mattermost adapter registers an action dispatcher keyed by that id at startup
(`src/chat/mattermost/index.ts:263`), so a context signed for `mattermost-default`
routes to a live dispatcher.

`tests/platform/scenarios/mattermost-http-action.platform.ts`:

1. Boot with the same env **plus** `PAPAI_MATTERMOST_ACTION_SIGNING_SECRET=<known>`.
2. Build a signed action context for `platformInstanceId: 'mattermost-default'`
   using the **same** `<known>` secret and the production signer helper
   (`createMattermostActionContext`, the counterpart to
   `verifyMattermostActionContext`), for a `channel_id` the admin belongs to.
3. `POST` the action payload to the container's published web port
   (`container.webBaseUrl` + the Mattermost action path). The action route is
   matched **before** the `debugEnabled` gate (`src/debug/server.ts`), so it is
   reachable regardless of debug flags.
4. Assert a `200` with the dispatched action's JSON result (not
   `'This action is no longer valid.'` and not
   `'Action is no longer available.'`), proving verify + dispatch end to end.

Catalog: re-point the F4 record from
`needs('F4', ['mattermost-action-fixture'], '3', …)` to
`executable({ provingTier: '3', storyIds: ['SCN-http-mattermost-action'] })`.

### 5. Catalog crosscheck

`tests/platform/catalog-crosscheck.test.ts` mirrors the T2 crosscheck: it asserts
every catalog record with `provingTier: '3'` names `storyIds` that a
`.platform.ts` scenario actually invokes (via the shared `title()` helper), and
that no `@3` scenario runs without a matching executable record. This keeps the
ledger honest as the vertical grows.

### 6. CI wiring — Nightly

T3 is a **Nightly** lane, never a PR gate (roadmap line 132). Two parts:

- **`.github/workflows/ci.yml`** is PR/push-triggered; T3 does **not** belong
  there as a gating job. Add the T3 lane to a **nightly** workflow
  (`.github/workflows/nightly.yml`, created if absent, `on: schedule`), as a
  `platform` job mirroring the `smoke` job: `docker build -t papai:e2e .`, then
  `bun run test:platform`, with a measured wall-clock `timeout-minutes` budget
  (two boots; budget set from a first measured run, rounded up to ~2x, matching
  the T2 job's methodology). If a nightly workflow does not yet exist, this spec
  creates it with the single `platform` job; future nightly-only lanes join it.
- Upload `reports/platform/**` as an artifact (`if: always()`), mirroring the
  smoke/story report uploads.

### 7. Docs

Add a `tests/CLAUDE.md` subsection: T3 is the platform-adapter lane in
`tests/platform/`, Nightly-only, in-container against fake platform servers;
`bun run test:platform` runs it locally; the Mattermost vertical is live, Discord
and Telegram are deferred pends.

## Cross-item / cross-tier interactions

- **Shared harness.** `fake-llm-server.ts` and `container.ts` stay in
  `tests/smoke/harness/`; T3 imports them. The Mattermost fake gains additive
  endpoints there, used only by T3 — T2 scenarios are unchanged (they never hit
  the new routes). If a future refactor moves shared harness code to a neutral
  `tests/harness/` root, both lanes update together; not done here (YAGNI).
- **`LIVE_STORY_TIERS` freeze.** Adding `'3'` makes the tier live everywhere the
  aggregators read that constant. Verify no runner assumes `LIVE_STORY_TIERS` has
  exactly three entries.
- **Action-secret seam blast radius.** The env seam is opt-in (absent env → the
  existing random-generate path is unchanged) and `onConflictDoNothing` never
  overwrites an existing secret, so production and all other lanes are unaffected.

## Dependencies

- **T2 harness** (`fake-llm-server.ts`, `container.ts`,
  `fake-mattermost-server.ts`, `container.ts`'s `buildContainerEnv`) — reused
  directly; already on this branch.
- **Item 5 (fix 3 failing tests)** — not a hard blocker for T3 (the failing tests
  are in the in-process suite), but the lane should be validated green after Item
  5 lands to avoid attributing unrelated failures to T3.

## Risks & mitigations

- **Nightly-only means slower feedback on adapter regressions** → accepted per
  roadmap charter; the two scenarios are cheap enough that a future promotion to
  a manually-triggerable PR lane is possible if needed.
- **Signed-context construction drifts from production** → the scenario uses the
  production signer (`createMattermostActionContext`) with the same secret, not a
  hand-rolled payload, so verify/sign stay coupled.
- **`platformInstanceId` convention changes** (`'${chatType}-default'`) → the
  crosscheck and scenario both reference `mattermost-default`; a bootstrap change
  would fail the scenario loudly rather than silently mis-route.
- **Fake-server endpoint drift vs. real Mattermost** → the fake serves only what
  `resolveChatLink` calls; if the resolver gains endpoints, the fake must grow
  with it (documented in `tests/CLAUDE.md`).
- **Wall-clock budget guess** → the CI `timeout-minutes` is set from a measured
  run (two boots), not estimated, matching the T2 methodology.

## Testing / verification

- `bun run test:platform` locally boots both scenarios green against the fakes.
- `SCN-fetch-chat-link`: the reply contains the seeded post content; the fake
  recorded the single-post and thread GETs.
- `SCN-http-mattermost-action`: a context signed with the env-seeded secret
  yields `200` + dispatched result; a context signed with a **wrong** secret
  yields the `'This action is no longer valid.'` error (proves the seam gates,
  not just accepts).
- The env seam is idempotent: a second boot with a different
  `PAPAI_MATTERMOST_ACTION_SIGNING_SECRET` does **not** overwrite the stored
  secret (`onConflictDoNothing`).
- `catalog-crosscheck.test.ts` passes: both `@3` executable records bind to
  invoked scenarios; the default `bun test` still never discovers `.platform.ts`.
- Unit coverage for the fake's new handlers (single-post / thread shapes) and for
  `seedMattermostActionSigningSecretFromEnv` (seeds when env set; no-op when
  absent; never overwrites).
