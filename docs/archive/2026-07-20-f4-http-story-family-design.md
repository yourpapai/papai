<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F4 HTTP-surfaces story family

**Status:** approved

**Date:** 2026-07-20

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F4 (`http-*`) after F1–F3. Every F4 scenario drives the app's HTTP
ingress: the single `routeRequest` function (`src/debug/server.ts:219-259`) that the
compatibility proof consumes through the frozen harness's `web.route` DI point
(`tests/CLAUDE.md`; `src/runtime/create-runtime.ts:198-202`). `plugin-core-separation`
rewires runtime composition (`createProductionRuntimeDeps`, the `web.route` seam); if it
breaks route dispatch or any of the three server trust domains, these stories are the
behavioral tripwire.

Unlike the chat/tool-call families before it, F4 exercises raw HTTP request→response
**in-process** — no socket is bound (`startNetworkServer: false`,
`tests/stories/harness/world.ts:463-467`); `PapaiRuntime.request()` calls the same
`routeRequest` production uses. The catalog audit classified the 8 `SCN-http-*` records as
1 `executable-as-is` (`auth-claim`) plus 7 `needs-seam`. This spec lands **6 executable
scenarios**, **reclassifies `http-mcp-plugin` F4→F7** (Reclassification below), and leaves
`http-mattermost-action` forward-only — moving the ledger from **81 to 87 executable**.

F4 is the program's first **zero-production-`src/`-change** family (contrast F1/F2/F3, each
of which added capability ids). The refactor risk it covers is route dispatch and the
server's three independent trust domains:

1. **Settings sessions** — `papai_settings_session`, the auth-code exchange
   (`src/debug/settings-routes.ts:55-92`); already proven as scaffolding by the settings
   family.
2. **Dashboard domain** — `dashboard_session`, a separate cookie/table/principal
   (`src/dashboard-auth/index.ts:85-92`), gated by `isAuthorizedRequest`
   (`src/debug/server.ts:248-250`); covers admin, billing/stats, and (with `debugEnabled`)
   the debug panels.
3. **Token/secret domains** — the notify bearer (`src/notify-token.ts:35-49`) and the
   transcript-viewer magi-proxy capability token (`src/debug/transcript-viewer.ts:114-135`).

Research basis: the production route map (`routeRequest` dispatch order and
`WebServerRouteOptions` at `src/debug/server-route-options.ts:22-27`; dashboard-auth
`issueClaim`/`consumeClaim`/`mintSession` at `src/dashboard-auth/index.ts:48-77` and
`POST /auth/claim` at `src/debug/auth-routes.ts:85-109`; `notify-route.ts:137-160`;
`transcript-viewer.ts:17-56`; billing/stats at `src/debug/billing-routes.ts`,
`stats-routes.ts`) and the harness surface (`when.request`/`when.settingsRequest` and
`then.responseStatus` at `tests/stories/harness/scenario.ts:684-691,762-764`;
`ScenarioWorldOptions` at `world.ts:96-100`; the hardcoded `debugEnabled: false` at
`world.ts:449`; the strict dispatcher at `strict-http.ts`; fake-magi at `fake-magi.ts`;
proactive capture at `chat.ts:244-249`).

## No production seam (deliberate)

F1/F2/F3 each began with a production seam (capability ids). F4 has **none**, and this is
by construction, not omission:

- `debugEnabled` and `mattermostActionSecretForTest` are already fields on
  `WebServerRouteOptions` (`server-route-options.ts:22-27`); the harness simply hardcodes
  `debugEnabled: false` and never sets the secret.
- `notify-token` already exports `resetNotifyTokenCacheForTesting()`
  (`src/notify-token.ts:51-53`); the fixture calls it.
- Dashboard-auth, the Mattermost signing secret, and the acp magi config are all DB-backed
  with no module cache — they reset with the per-scenario database.

Consequently the compat baseline re-records only for the frozen **harness** byte changes
below (expected, not a regression); no `src/` shape the compat proof depends on changes.

## Harness seams

Five seams, all under `tests/stories/harness/`, each with its own contract test. Per rule
2 they land first in the plan and are reviewed independently before any story consumes
them.

### 1. `debug-enabled-world-option`

The route option exists; the harness discards it. Threading it back is new plumbing at
three layers, because no story passes world options today
(`scenario.ts:778-819` calls `createScenarioWorld(name)` with none):

1. Add `debugEnabled?: boolean` to `ScenarioWorldOptions` (`world.ts:96-100`).
2. Replace the unconditional `debugEnabled: false` in the `web.route` override
   (`world.ts:449`) with the option (default `false`).
3. Let `scenario()`/`executeScenario` accept and forward world options down to the
   `WorldFactory` (`scenario.ts:778-819`).

Contract test: a world built with `{ debugEnabled: true }` serves a debug-gated path;
the default still 404s it.

### 2. `dashboard-auth-fixture`

A second session vault mirroring the settings-session vault (`fixtures.ts:81-130`), for
the dashboard trust domain:

- `given.dashboardSession()` — issues a claim for the runtime operator identity
  (`issueClaim(ADMIN_USER_ID, …)`, `src/dashboard-auth/index.ts:48-55`), drives a real
  `POST /auth/claim` (`auth-routes.ts:85-109`), parses the `dashboard_session` cookie
  (`src/dashboard-auth/cookie.ts`), and returns a handle keyed into a private vault by
  object identity.
- `when.dashboardRequest(session, path, init?)` — attaches the cookie, mirroring
  `when.settingsRequest`.

The dashboard principal is a single opaque `adminUserId` (not a `{platformInstanceId,
platformUserId}` pair), so the fixture takes no user argument — it _is_ the operator.
Unlocks `admin-dashboard`, `billing-stats-readonly`, and `debug-live-panels`.

### 3. `notify-token-fixture`

`given.notifyToken(token)` seeds the `notify_token` `systemConfig` row **and** calls
`resetNotifyTokenCacheForTesting()` (`notify-token.ts:51-53`) in fixture setup, and
registers the same reset in the world cleanup coordinator (`world.ts:346`). Both halves
are mandatory: the module-level `cached` (`notify-token.ts:16`) is process-lifetime and
outlives the per-scenario DB, so without the dual reset the first scenario to touch
`/api/notify` pins the token for every later scenario in the same worker file. This is the
family's top determinism risk; its contract test asserts a second world in the same
process sees the freshly seeded token, not a stale one.

### 4. `fake-magi-transcript`

A new `expectTranscriptHistory(token, body)` method on `FakeMagi` (`fake-magi.ts`, beside
the existing `expect*` registrations) declaring `GET {baseUrl}/t/{token}/transcript` on
`world.http.expect`, asserting the forwarded `Authorization: Bearer {magi_token}`
(`assertAuthorization`, `fake-magi.ts:149-153`) and returning canned transcript bytes. The
config half is already free: `given.codingSession` sets `magi_base_url`/`magi_token` via
`setPluginAdminConfig('acp', …)` (`src/coding-sessions/configure.ts:55-63`) — the exact
keys `getViewerMagiConfig()` reads (`transcript-viewer.ts:17-22`). Closes the catalog gap.

### 5. `given.publicBaseUrl(url)`

A centralized set/restore of `SETTINGS_PUBLIC_BASE_URL` (read at `src/settings/config.ts:7`)
through the world cleanup coordinator, replacing the ad-hoc try/finally one-off in
`tests/stories/commands/surface.story.test.ts:66-70` (the cleanup `tests/CLAUDE.md`
assigns to F4, flagged by F1). The transient env write is I/O-guard-legal because the
coordinator guarantees restoration before teardown; unlike the one-off, no story repeats
the pattern.

### Assertion surface: one traced helper

Add a single `then.responseJson(response)` fluent asserter (`.contains(token)` /
`.equals(…)`) beside `then.responseStatus` (`scenario.ts:762-764`), routing body
assertions through the same sanitized event-trace formatter. F4 is body-assertion-heavy
(session JSON, admin/stats data, transcript bytes), and the harness's whole failure-triage
model is the event trace — a bare `expect(await response.json())` fails opaque. Status
stays on `then.responseStatus`.

## Story files

Grouped by trust domain under a new `tests/stories/http/`. Every scenario qualifies through
observable behavior (rule 3 — never a bare 200 or an internal call count).

### `tests/stories/http/auth-claim.story.test.ts` (1) — settings domain

| Scenario              | Shape                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-http-auth-claim` | Promotes the settings exchange from scaffolding to subject: a minted session's cookie authorizes a follow-up `GET /settings/api/session`; negatives — 401 on a reused/expired code, 429 on the exchange quota, 403 on a CSRF-less `logout`, and the `Set-Cookie` attributes (`HttpOnly; SameSite=Lax; Path=/settings`) |

### `tests/stories/http/dashboard.story.test.ts` (3) — dashboard domain

| Scenario                          | Shape                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-http-admin-dashboard`        | A dashboard session authorizes `/admin/identity/mappings` returning real seeded data; **trust-domain separation** — a _settings_ cookie is rejected (401) on the same route, no cookie → 401                                                                                                                     |
| `SCN-http-billing-stats-readonly` | A dashboard session → `/stats/global` (or `/stats/subject/:id`) returns real aggregates reflecting seeded activity; 400 unknown window, 404 unknown subject; a settings cookie is rejected; read-only (GET, no mutation) — honoring the `/stats/*` anonymity contract (aggregate shape, not identities)          |
| `SCN-http-debug-live-panels`      | **Layered gate**: without the world option `/debug`→404; with `debugEnabled` on but no dashboard session→401; with both, a panel reflecting a **real prior scripted turn**'s distinctive token→200 (the specific panel — `/turns/:id` vs `/logs` — a plan-discovery pick against the in-process state-collector) |

### `tests/stories/http/notify.story.test.ts` (1) — token domain

| Scenario          | Shape                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-http-notify` | `POST /api/notify` with the seeded bearer delivers a **captured proactive message** (`kind:'proactive'`, `chat.ts:244-249`) to the target context, and the `recordProactiveInHistory` row (`src/proactive-history.ts:31-45`) surfaces on a following real turn; negatives — 401 wrong token, 503 before seeding, 404 unmapped context, 400 bad body |

### `tests/stories/http/transcript-viewer.story.test.ts` (1) — proxy domain

| Scenario                     | Shape                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-http-transcript-viewer` | `given.codingSession` seeds magi config; `GET /t/:token/transcript` returns the **exact bytes** fake-magi served, and the outbound request carried `Authorization: Bearer {magi_token}`; negatives — 503 before config, 502 on upstream failure |

## Reclassification (roadmap rule 6)

`SCN-http-mcp-plugin` was audited `needs:[fake-mcp-server]` in family **F4**. Research
showed the shared `fake-mcp-server` seam name hides different machinery per family: the F4
route (`/mcp/plugin/:pluginId`, `src/mcp-server/server-route.ts`) makes papai the MCP
**server** — it dispatches JSON-RPC **in-process** to a fixture plugin's `tool.execute()`
(`plugin-bridge.ts`), so exercising it needs a fixture plugin + token minting
(`mintPluginMcpToken`) + a StreamableHTTP MCP **client** driver. F7's
`SCN-settings-admin-mcp-*` need the opposite — papai as a **client** to an _external_ fake
MCP server declared on the strict dispatcher.

Corrected record: **family F7**, seam `fake-mcp-server` unchanged, **stays pending**. F7
becomes the sole owner of MCP-harness machinery; `fake-mcp-server` becomes an F7-only seam.
This mirrors the settings family's own note that `SCN-http-mcp-plugin` belongs with "a
later MCP-focused spec." The audit-record family change lands with F4's ledger update.

## Deliberate exclusions

- **No production `src/` changes** — see "No production seam" above.
- **`http-mattermost-action` stays forward-only.** The `mattermostActionSecretForTest`
  option exists, but making the callback executable also needs a per-instance
  action-dispatcher registration — platform-adapter (F8) territory. Respecting the roadmap
  and F8's don't-build-platform-fakes-speculatively discipline, the
  `mattermost-action-fixture` seam is **not built**.
- **`http-mcp-plugin` deferred to F7** (Reclassification above).
- **No real socket** — every request drives `PapaiRuntime.request()` in-process against the
  same `routeRequest` as production.
- **Story-mode-only proxy interception.** The transcript route's `fetchImpl` defaults to
  the global `fetch` and is not overridden by `pluginProviderRuntimeDeps.fetch`
  (`transcript-viewer.ts:114-135`); it is intercepted only under `bun test:stories`' I/O-guard
  global-fetch patch, not in `--contracts` mode — the same footnote F3 recorded for
  `memory-capture-sweep`. The transcript story runs story-mode.

## Ledger updates (same PR, rule 5)

Six `AUDIT_RECORDS` entries move to `EXECUTABLE_STORY_MAPPINGS` with
`verifiedAt: '2026-07-20'` — the 1 `executable-as-is` (`auth-claim`) and 5 `needs-seam`
(`notify`, `transcript-viewer`, `admin-dashboard`, `billing-stats-readonly`,
`debug-live-panels`). `SCN-http-transcript-viewer` also leaves `GAP_SCENARIO_IDS`
(gap → confirmed). The `SCN-http-mcp-plugin` record is rewritten to family **F7**
(stays `needs-seam`/pending). `SCN-http-mattermost-action` is unchanged (forward-only,
pending). Contract-test totals become **128 ids / 87 executable / 41 pending** (the
readiness literals decrement by 1 `executable-as-is` + 5 `needs-seam`; `blocked`
unchanged), and the runner manifest totals line follows.

## Success criteria

- 6 new scenarios pass sandboxed (`bun test:stories`).
- Ledger: 87 executable / 41 pending; runner prints the updated totals line.
- The five harness seams (plus the `then.responseJson` helper) land first and are reviewed
  independently; no production `src/` file changes.
- `bun test:stories:contracts` (including the new fixture/seam contract tests), typecheck,
  lint, and `format:check` stay green.
- `bun test:stories:stress` once before merge — no flakes (the notify-token cache reset is
  the specific determinism guard under scrutiny).
- The compat baseline is re-recorded only for the intended harness byte changes; the 40-story
  scenario set is otherwise untouched.

## Risks

1. **Notify-token module cache** — mitigated by the dual reset (fixture setup + cleanup
   coordinator) and a contract test that proves cross-world isolation in one worker.
2. **Debug-panel in-process data source** — a plan-discovery step picks the panel
   (`/turns/:id` vs `/logs`) that the in-process `state-collector` deterministically
   populates from a real scripted turn; the layered 404→401→200 gate proof does not depend
   on that pick.
3. **World-options plumbing touches shared harness files** (`world.ts`, `scenario.ts`) —
   contract-tested, and the re-baseline is intended, but the change must not alter behavior
   for stories that pass no options (default `debugEnabled: false`).
4. **Transcript proxy interception** — story-mode-only (Deliberate exclusions); the contract
   test for `expectTranscriptHistory` runs under the story-mode fetch patch.
5. **Dashboard fixed principal** — the fixture binds to `ADMIN_USER_ID` (`world.ts:463`);
   the trust-domain-separation assertions rely on that being the only dashboard principal,
   distinct from any settings session's `{platformInstanceId, platformUserId}`.

## Post-implementation deviations (2026-07-20)

The implementation held to the spec's decisions (five harness seams landed and reviewed
independently, six `SCN-http-*` scenarios, `http-mcp-plugin` reclassified F4→F7, ledger
81→87 executable / 41 pending, zero production `src/` changes). The refinements below are
recorded here rather than rewriting each section above.

- **`then.responseJson` takes the already-parsed body, not the `Response`.** The helper is
  `then.responseJson(body).contains(needle)` / `.equals(expected)`, called as
  `then.responseJson(await res.json())` — `response.json()` is async, so the parse stays
  inline and only the (sync) assertion is traced via `tracedAssertion`.
- **`debugEnabled` is a `scenario(name, run, { debugEnabled })` option.** It threads through
  `executeScenario`'s default world factory into `createScenarioWorld(name, { debugEnabled })`
  → `world.ts` `web.route` literal (`debugEnabled: options.debugEnabled ?? false`). Stories
  that pass no options keep the default `false` (the 404→401→200 debug gate proof). The
  option reaches `routeRequest` unchanged.
- **`notify-token-fixture` resets in `setupDatabase`, not a cleanup-coordinator dual reset.**
  `resetNotifyTokenCacheForTesting()` runs unconditionally per scenario in `setupDatabase`
  (there is no generic cleanup-registration API), which defeats the process-lifetime module
  cache for both the seeded and the unconfigured case. Seeding uses a direct
  `getTestDb().insert(schema.systemConfig)` helper (`seedTestSystemConfig`) because
  production's `setSystemConfig` cannot write `notify_token` (its `SystemConfigKey` union
  excludes it); the `systemConfig.key` column is plain `text`, so no type-widening was needed.
- **`given.publicBaseUrl` restores via `fixtures.teardown`.** It captures the prior
  `SETTINGS_PUBLIC_BASE_URL` on the first call (idempotent under repeat calls) and restores
  or deletes it inside the existing `teardown` closure, which runs before the I/O guard's env
  check — net env mutation is zero. This retired the hand-rolled `try/finally` +
  `Reflect.deleteProperty` one-off in `tests/stories/commands/surface.story.test.ts` (and the
  now-accurate note in `tests/CLAUDE.md`).
- **The dashboard session vault parses the `302` claim cookie.** `given.dashboardSession()`
  issues a claim for `ADMIN_USER_ID`, POSTs `/auth/claim`, and the vault reads the
  `dashboard_session` cookie off the `302` redirect (empty body), not a `200` JSON exchange.
  `given.dashboardSession` deliberately omits the `prerequisite()` unstarted-world guard
  (mirroring the pre-existing `given.llm` sub-pattern) because story usage calls it after an
  anonymous `when.request` has already started the runtime; `runtimeRequest`→`ensureStarted`
  still rejects invalid world states.
- **Story routes/fields confirmed during diagnosis (all held to the plan, no substitution).**
  Settings read path `/settings/api/bootstrap` (401 anonymous / 200-with-session, exchange
  body carries `csrfToken`); `/admin/identity/mappings` echoes the seeded `providerUserLogin`
  through a real DB round trip; `/stats/global` uses the `window` query param, echoes it in
  the body, and `parseStatsWindow` returns `400 unknown window` for an unknown value; `/debug`
  serves HTML with `200` (the 404→401→200 gate flip is the rule-3 proof, no body assertion);
  the notify route resolves `contextId` to a platform instance via `parseScopedContextId`
  (no extra mapping seed needed) and the proactive delivery is captured by `then.replyTo`
  (native user id, `threadId: null`).
- **The transcript-viewer scenario seeds magi config mid-scenario via the production function
  directly, not `given.codingSession`.** The harness forbids any `given.*` after the first
  `when.*` (`assertPrerequisitesOpen`), so the 503-then-configure-then-200 flow cannot use the
  `given.codingSession` fixture between the two requests. It instead calls
  `configureCodingSessionCapability` (the exact function `given.codingSession` wraps) with the
  group's scoped context id via `toScopedContextId` — the established mid-scenario-config
  precedent (`eligibility.story.test.ts`). Only the fixture's ordering gate is bypassed; the
  seeding logic and the exact-proxied-payload deep-equal are unchanged. This scenario is
  story-mode-only (the proxy's fetch is patched to `world.http` only under `bun test:stories`,
  not `--contracts`).
- **Seam contract tests drop an unneeded `async`.** Several new `scenario.test.ts` /
  `fake-magi.ts` callbacks that contain no `await` are written non-`async` to satisfy oxlint's
  pedantic `require-await`; behavior is identical and no lint-disable was used.
