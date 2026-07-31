<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0306: F4 HTTP-Surfaces Story Family — Behavioral Coverage for the Auth-Claim Exchange, Dashboard/Admin, Stats, Notify-Bearer, and Transcript-Proxy HTTP Domains

## Status

Implemented (with divergence)

## Date

2026-07-20

## Context

The coverage-expansion roadmap sequences family **F4** (`http-*`) after F1–F3. Unlike the chat/tool-call families before it, F4 exercises raw HTTP request→response **in-process** — no socket is bound (`startNetworkServer: false`); the harness `PapaiRuntime.request()` drives the single `routeRequest` function (`src/debug/server.ts`) that production serves, so these stories are the behavioral tripwire for route dispatch and the server's three independent trust domains:

1. **Settings sessions** — `papai_settings_session`, the auth-code exchange (`src/debug/settings-routes.ts`); already exercised as scaffolding by the settings family (ADR-0293).
2. **Dashboard domain** — `dashboard_session`, a separate cookie/principal (`src/dashboard-auth/index.ts`), gated by `isAuthorizedRequest`; covers admin, billing/stats, and (with `debugEnabled`) the debug panels.
3. **Token/secret domains** — the notify bearer (`src/notify-token.ts`) and the transcript-viewer magi-proxy capability token (`src/debug/transcript-viewer.ts`).

F4 is the program's first **zero-production-`src/`-change** family: every capability the stories touch already exists on `WebServerRouteOptions` (`debugEnabled`) or is DB-backed (dashboard-auth, notify-token, magi config). The refactor risk it covers is therefore reached purely through **harness** seams. The design (`docs/superpowers/specs/2026-07-20-f4-http-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-20-f4-http-story-family.md`) chose five harness-only seams (plus a traced `then.responseJson` helper), four story files grouped by trust domain under a new `tests/stories/http/`, an `http-mcp-plugin` F4→F7 reclassification (the `fake-mcp-server` seam name hid different machinery per family — F4's route makes papai the MCP *server*, F7 needs papai as a *client*), and a ledger update moving the catalog from 81 to 87 executable scenarios.

## Decision Drivers

- **Zero production `src/` changes, by construction.** The route option, the notify-token reset hook, and the DB-backed credentials already exist; the work is threading them back into the harness. No capability ids are added (contrast F1/F2/F3).
- **In-process HTTP is the entry point.** Every scenario drives `PapaiRuntime.request()` → `routeRequest` against `https://scenario.invalid`, never a bound socket; the three trust domains are exercised through their real gating order (debug `404` gate before the dashboard-cookie `401` gate).
- **Five seams, each reviewed independently (roadmap rule 2).** `debugEnabled` world option, a `dashboard-auth` session vault mirroring the settings vault, a `notify_token` seed + per-scenario cache reset, a fake-magi transcript responder, and `given.publicBaseUrl`. Each lands with its own contract test before any story consumes it.
- **No assertion-only stories (rule 3).** Every scenario qualifies through a delivered reply, an authorization flip, an exact proxied payload, or a durable cross-turn change — never a bare `200` status.
- **Reclassifications record their rationale (rule 6).** `http-mcp-plugin` moves to F7 with the corrected *direction* (server vs. client) rationale; `fake-mcp-server` becomes an F7-only seam. Ledger updates ride in the same PR (rule 5).

## Considered Options

### Option 1 — Five harness-only seams + four story files + `http-mcp-plugin` F4→F7 reclassification, zero production changes (chosen)

Thread `debugEnabled` back through three harness layers; add a second (dashboard) session vault; reset the notify-token module cache per scenario and seed `notify_token` via a direct `systemConfig` insert; declare a transcript route on fake-magi; centralize `SETTINGS_PUBLIC_BASE_URL` set/restore. Group six scenarios by trust domain under `tests/stories/http/`. Reclassify `http-mcp-plugin` to F7 (stays pending). Leave `http-mattermost-action` forward-only (its action-dispatcher registration is platform-adapter / F8 territory).

- **Pros:** keeps F4's "first zero-`src/`-change family" promise; the three trust domains are reached through the exact production gating path; each seam is contract-testable in isolation; the transcript proxy's upstream fetch is intercepted by the same global-fetch patch the strict dispatcher (ADR-0305) already enforces.
- **Cons:** world-options plumbing touches shared harness files (`world.ts`, `scenario.ts`); the notify-token module cache is process-lifetime and outlives the per-scenario DB (a determinism hazard needing a dual reset); the transcript proxy interception is story-mode-only (its `fetchImpl` is not overridden in `--contracts`).

### Option 2 — Add a production seam per domain, mirroring F1/F2/F3 (rejected)

Each capability (`debugEnabled`, notify-token, magi config) already exists, but a production seam (a new test-only config flag or a per-request override) would make each story self-contained without harness plumbing.

- **Pros:** no shared-harness-file churn; no module-cache determinism hazard.
- **Cons:** contradicts F4's defining constraint (the surfaces already exist — a production seam would be dead code that duplicates an existing field); pollutes `src/` for test convenience; re-baselines the compat proof for `src/` shape, not just harness bytes. Strictly worse than Option 1.

### Option 3 — Keep `http-mcp-plugin` in F4 under a shared `fake-mcp-server` seam (rejected)

Build the MCP-server-direction harness under F4 alongside the client-direction harness F7 will need.

- **Pros:** one fewer reclassification.
- **Cons:** the shared seam name hides opposite machinery (in-process plugin-tool dispatch vs. an external StreamableHTTP client); F7 is the natural owner of all MCP-harness machinery; the roadmap's per-family discipline rejects speculative seam-building. The audit-record rationale must move with the record (rule 6).

## Decision

The chosen Option 1 shipped across five harness seams, the traced helper, four story files (six scenarios), the catalog ledger update, and the `http-mcp-plugin` reclassification. What shipped:

1. **`debugEnabled` threaded through three layers.** `ScenarioWorldOptions.debugEnabled?: boolean` (`world.ts:96-101`); the `web.route` override passes `debugEnabled: options.debugEnabled ?? false` to `routeRequest` (`world.ts:452-458`); `ScenarioOptions` (`scenario.ts:303`) and `executeScenario(..., options?)`'s default factory forward it into `createScenarioWorld` (`scenario.ts:926-938`). Stories passing no options keep the default `false`.
2. **`then.responseJson` traced helper.** Takes the already-parsed body (`then.responseJson(await res.json())`), exposing traced `.contains(needle)` / `.equals(expected)` (`scenario.ts:907-912`) routed through `tracedAssertion`, beside the existing `then.responseStatus`.
3. **`dashboard-auth` session vault.** `DashboardSessionHandle` / `DashboardSessionVault` (`fixtures.ts:144-156`) mirroring the settings vault; `createDashboardSessionVault` + `extractDashboardCookie` (`fixtures.ts:158-200`) parse the `dashboard_session` cookie off the `302` claim response; attached/reset/revoked on `ScenarioFixtures` (`fixtures.ts:346,350,334`). `given.dashboardSession()` (`scenario.ts:551-554`) issues a claim for the runtime operator `ADMIN_USER_ID` and POSTs `/auth/claim` (`scenario.ts:407-415`); `when.dashboardRequest` (`scenario.ts:810-813`) attaches the cookie.
4. **`notify_token` seed + per-scenario cache reset.** `seedTestSystemConfig` (`tests/utils/test-helpers.ts:219`) inserts the `systemConfig` row directly (production's `setSystemConfig` excludes `notify_token` from its key union); `setupDatabase` calls `resetNotifyTokenCacheForTesting()` unconditionally per scenario (`fixtures.ts:352`); `given.notifyToken` seeds via `seedNotifyToken` (`scenario.ts:711-713`, `fixtures.ts:438-440`).
5. **fake-magi transcript responder.** `FakeMagi.expectTranscriptHistory(token, body, response?)` (`fake-magi.ts:136`, impl `:380-387`) declares `GET {baseUrl}/t/{token}/transcript`, asserts the forwarded `Bearer <magi_token>`, and returns canned bytes.
6. **`given.publicBaseUrl` env seam.** `ScenarioFixtures.setPublicBaseUrl` (`fixtures.ts:521-525`) captures the prior `SETTINGS_PUBLIC_BASE_URL` once (idempotent) and restores/deletes it inside the existing `teardown` closure (`fixtures.ts:330-340`); `given.publicBaseUrl` (`scenario.ts:719-721`) retires the ad-hoc `try/finally` one-off in the commands `/config` story (`surface.story.test.ts:66`).
7. **Four story files, six scenarios under `tests/stories/http/`.** `auth-claim` (settings domain), `dashboard` (admin / stats / debug — three scenarios), `notify` (token domain), `transcript-viewer` (proxy domain).
8. **Catalog ledger + reclassification.** Six `SCN-http-*` records moved to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-20'` (`coverage.ts:783-816`); `http-mcp-plugin` rewritten to family **F7** with the server-vs-client rationale; the family-queue contract carries `['SCN-http-mcp-plugin', 'F7']` ahead of `['SCN-http-', 'F4']` (`catalog-coverage.test.ts:90`).

## Consequences

### Positive

- F4 is the program's first zero-production-`src/`-change family: route dispatch and the three server trust domains are now covered by real behavioral scenarios with no test-only production code added.
- The three trust domains are reached through their **exact** production gating path — the debug `404` gate, the dashboard-cookie `401` gate, the notify bearer, and the magi-proxy config — so a refactor that breaks dispatch order or any trust boundary fails a story, not a unit assertion.
- The notify-token determinism hazard (process-lifetime module cache outliving the per-scenario DB) is structurally closed: the unconditional `setupDatabase` reset defeats the cache for both the seeded and unconfigured cases, and a contract test proves cross-scenario isolation in one worker.
- `given.publicBaseUrl` retires a duplicated ad-hoc env-juggling pattern and centralizes the set/restore through `fixtures.teardown`, so the I/O guard's "no net env mutation" rule holds without per-story discipline.
- The `http-mcp-plugin` reclassification makes F7 the sole owner of MCP-harness machinery and makes the `fake-mcp-server` seam F7-only, removing a name that hid opposite directions.

### Negative

- **Shared-harness-file churn.** `world.ts`, `scenario.ts`, `fixtures.ts`, `fake-magi.ts`, `test-helpers.ts`, and `surface.story.test.ts` all change; the compat baseline must re-record for these intended harness byte changes (expected, not a regression).
- **The transcript proxy interception is story-mode-only.** The route's `fetchImpl` defaults to the global `fetch` and is intercepted only under `bun test:stories`' global-fetch patch, not in `--contracts` — the transcript scenario runs story-mode (the same footnote ADR-0305 recorded for `memory-capture-sweep`).
- **World-options plumbing is a three-layer change** for a single boolean; future story-reachable world options must thread the same `ScenarioOptions` path.

### Risks

- **The transcript-viewer scenario seeds magi config mid-scenario via the production function directly, not `given.codingSession`.** The harness forbids any `given.*` after the first `when.*` (`assertPrerequisitesOpen`), so the 503-then-configure-then-200 flow cannot use the fixture between the two requests. It instead calls `configureCodingSessionCapability` (the exact function `given.codingSession` wraps) with the group's scoped context id — only the fixture's ordering gate is bypassed; the seeding logic and the exact-proxied-payload deep-equal are unchanged.
- **Dashboard fixed principal.** The fixture binds to `ADMIN_USER_ID` (`world.ts:37`); the trust-domain-separation assertions rely on that being the only dashboard principal, distinct from any settings session's `{platformInstanceId, platformUserId}`.
- **`debug-panel` in-process data source.** The scenario's rule-3 proof is the layered `404`→`401`→`200` gate flip (debug gate then dashboard gate), not a specific panel body — so it does not depend on which debug panel the in-process state-collector deterministically populates.

## Related Decisions

- [ADR-0305](0305-f3-memory-story-family.md) — F3 Memory Story Family: the immediately preceding story-family batch that built the strict-http `idle()`/in-flight tracking the transcript-viewer scenario's outbound fetch drains through (`world.settle()` awaits `http.idle()`). F4 reuses F3's strict-dispatcher FIFO matching and records the same story-mode-only interception footnote.
- [ADR-0293](0293-settings-story-family.md) — Settings HTTP Story Family: established the settings-session auth-code exchange F4 promotes from scaffolding to first-class subject (`SCN-http-auth-claim`), and the `when.settingsRequest`/`then.responseStatus` HTTP DSL F4's stories and `then.responseJson` helper extend.
- [ADR-0304](0304-story-catalog-audit.md) — Story Catalog Audit: established the structured `needs(...)`/`ready(...)` pending-record shape and the `EXECUTABLE_STORY_MAPPINGS` table F4's six new records and the `http-mcp-plugin` reclassification land in (the family-queue override and the F4/F7 family split operate on that audited catalog).
- [ADR-0297](0297-f1-command-meta-story-family.md) / [ADR-0298](0298-f2a-task-lifecycle-story-family.md) / [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) / [ADR-0300](0300-f2b2-task-integration-surface-story-family.md) — the sibling story-family batch (same 2026-07-19/20 cycle) that established the family-by-family landing pattern, the five-seams-first discipline, and the "no production `src/` change" precedent F4 extends to its limit; their later landing is why the shipped catalog totals (140/165) far exceed F4's 81→87 era target.
- [ADR-0134](0134-dashboard-session-authentication.md) — Dashboard Session Authentication: the dashboard-cookie trust domain (`issueClaim`/`consumeClaim`/`mintSession`, the `dashboard_session` cookie) the F4 dashboard vault drives through a real `POST /auth/claim`, and the principal F4's trust-domain-separation assertions rely on.
- [ADR-0121](0121-dashboard-admin-split-and-redesign.md) — Debug/Admin Surface Split and Dashboard Redesign: the `/admin` + `/debug` surface split and the layered gating order (debug gate before the dashboard-cookie gate) F4's `SCN-http-debug-live-panels` exercises as a `404`→`401`→`200` flip.
- [ADR-0120](0120-central-llm-credentials-usage-billing-stats.md) — Central LLM Credentials, Usage Telemetry, Billing Dashboard, and Anonymous DB-Wide Statistics: the `/stats/*` anonymity contract and the `window` query-param contract F4's `SCN-http-billing-stats-readonly` asserts against (aggregate shape, `400 unknown window`, read-only GET).
- [ADR-0280](0280-plugins-as-mcp-servers.md) / [ADR-0271](0271-mcp-catalog-hardening.md) / [ADR-0135](0135-mcp-adapter.md) — the MCP-server vs. MCP-client direction split (`src/mcp-server/` vs. `src/mcp/`) that justifies the `http-mcp-plugin` F4→F7 reclassification: papai-as-MCP-server (`0280`) is the F4 route deferred to F7, papai-as-MCP-client (`0135`) is the F7 surface the reclassification makes the seam's sole owner.
- [ADR-0166](0166-storybook-harness-pr1.md) / [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness (origin vertical slice + master baseline + OS sandbox + Docker-all-hosts) these scenarios execute under.
- **ADR-0063** — Web Fetch MVP (referenced via the index; its source file was pruned with the 0001-0100 batch): the SSRF-guarded public-web fetch model and the rate-limit/allowlist pattern the egress discipline these HTTP surfaces honor descends from.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. The no-`src/`-change promise holds: the seam reads existing production surfaces (`src/dashboard-auth/index.ts`, `src/notify-token.ts`, `src/debug/transcript-viewer.ts`, `src/debug/notify-route.ts`) without modifying them.

| File | Role | Evidence |
| --- | --- | --- |
| `tests/stories/harness/world.ts:96-101` | `ScenarioWorldOptions` gains `debugEnabled?: boolean`. | `read` confirms. |
| `tests/stories/harness/world.ts:452-458` | `web.route` override passes `debugEnabled: options.debugEnabled ?? false` to `routeRequest`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:303` | `ScenarioOptions = Readonly<{ debugEnabled?: boolean }>`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:926-938` | `executeScenario(..., options?)` default factory forwards `debugEnabled` into `createScenarioWorld`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:291` | `ScenarioThen.responseJson(body): ResponseJsonAssertion` type member. | `read` confirms. |
| `tests/stories/harness/scenario.ts:907-912` | `responseJson` impl — traced `.contains`/`.equals` via `tracedAssertion`. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:144-156` | `dashboardSessionOwner` symbol + `DashboardSessionHandle`/`DashboardSessionVault` types. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:158-200` | `extractDashboardCookie` + `createDashboardSessionVault`; `parseClaim` asserts `302` + reads `Set-Cookie`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:407-415` | `createDashboardSession` — `issueClaim(ADMIN_USER_ID, …)` → POST `/auth/claim` → `parseClaim`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:551-554` | `given.dashboardSession` — no `prerequisite()` guard (see divergence). | `read` confirms. |
| `tests/stories/harness/scenario.ts:810-813` | `when.dashboardRequest` — attaches the dashboard cookie. | `read` confirms. |
| `tests/utils/test-helpers.ts:219` | `seedTestSystemConfig({ key, value })` — direct `systemConfig` insert (bypasses `setSystemConfig`'s key union). | `read` confirms. |
| `tests/stories/harness/fixtures.ts:22,352` | imports + calls `resetNotifyTokenCacheForTesting()` in `setupDatabase`. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:438-440` | `seedNotifyToken(token)` seeds `notify_token`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:711-713` | `given.notifyToken` DSL. | `read` confirms. |
| `tests/stories/harness/fake-magi.ts:136,380-387` | `expectTranscriptHistory` type member + impl (declares `GET /t/{token}/transcript`, asserts Bearer). | `read` confirms. |
| `tests/stories/harness/fake-magi.test.ts:615-619` | Transcript-responder contract test. | `grep` confirms. |
| `tests/stories/harness/fixtures.ts:312,322-323,330-340,521-525` | `setPublicBaseUrl` + prior-state capture + `teardown` restore. | `read` confirms. |
| `tests/stories/harness/scenario.ts:719-721` | `given.publicBaseUrl` DSL. | `read` confirms. |
| `tests/stories/commands/surface.story.test.ts:66` | `SCN-cmd-config-dm` uses `given.publicBaseUrl(SETTINGS_BASE_URL)` (one-off retired). | `read` confirms. |
| `tests/stories/http/auth-claim.story.test.ts:8-37` | `SCN-http-auth-claim` — settings exchange 200/401/replay-401 + `csrfToken` body assert. | `read` confirms. |
| `tests/stories/http/dashboard.story.test.ts:8-53` | `SCN-http-admin-dashboard` / `-billing-stats-readonly` / `-debug-live-panels` (the last with `{ debugEnabled: true }`). | `read` confirms. |
| `tests/stories/http/notify.story.test.ts:8-32` | `SCN-http-notify` — 401 wrong bearer / 200 authorized + `then.replyTo(...).contains('build finished')`. | `read` confirms. |
| `tests/stories/http/transcript-viewer.story.test.ts:14-42` | `SCN-http-transcript-viewer` — 503 unconfigured → seed via `configureCodingSessionCapability` → 200 exact-proxied bytes. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:783-816` | Six `SCN-http-*` executable mappings, `verifiedAt: '2026-07-20'`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:883-889` | `SCN-http-mcp-plugin` in the F7 block (reclassified; now executable under F7 at `verifiedAt: '2026-07-22'`). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:90` | Family-queue override `['SCN-http-mcp-plugin', 'F7']` ahead of `['SCN-http-', 'F4']`. | `read` confirms. |
| `src/notify-token.ts:16,35-46,51-52` | Production module cache + `getNotifyToken` + `resetNotifyTokenCacheForTesting` (consumed unchanged). | `grep` confirms. |
| `src/debug/transcript-viewer.ts:17,28,126-127` | `getViewerMagiConfig` / `proxyTranscriptHistory` / `503`-on-null-config (consumed unchanged). | `grep` confirms. |
| `src/dashboard-auth/index.ts:48,57,68` | `issueClaim` / `consumeClaim` / `mintSession` (consumed unchanged). | `grep` confirms. |

Plan-vs-implementation notes:

- **The transcript-viewer scenario seeds magi config mid-scenario via the production function directly, not `given.codingSession`.** The plan's Task 9 called `given.codingSession({...})` after the 503 check. The harness forbids any `given.*` after the first `when.*` (`assertPrerequisitesOpen`), so the request that proves the 503 already starts the runtime and closes the `given.*` window. Shipped (`transcript-viewer.story.test.ts:28-34`) calls `configureCodingSessionCapability` (the exact function `given.codingSession` wraps) with the group's scoped context id via `toScopedContextId`, mirroring the mid-scenario-config precedent (`eligibility.story.test.ts`). Only the fixture's ordering gate is bypassed; the seeding logic and the exact-proxied-payload deep-equal are unchanged.
- **`notify-token-fixture` resets in `setupDatabase`, not a cleanup-coordinator dual reset.** The spec's "setup + cleanup-coordinator dual reset" assumed a generic cleanup-registration API that does not exist. Shipped calls `resetNotifyTokenCacheForTesting()` unconditionally per scenario in `setupDatabase` (`fixtures.ts:352`), which defeats the process-lifetime module cache for both the seeded and the unconfigured case; seeding uses a direct `getTestDb().insert(schema.systemConfig)` helper (`seedTestSystemConfig`) because production's `setSystemConfig` cannot write `notify_token` (its `SystemConfigKey` union excludes it).
- **`given.publicBaseUrl` restores via `fixtures.teardown`, not a cleanup coordinator.** Same missing-API reason. It captures the prior `SETTINGS_PUBLIC_BASE_URL` on the first call (idempotent under repeat calls) and restores or deletes it inside the existing `teardown` closure (`fixtures.ts:330-340`), which runs before the I/O guard's env check — net env mutation is zero.
- **The dashboard session vault parses the `302` claim cookie, not a `200` JSON exchange.** `POST /auth/claim` returns a `302` → `/debug` with `Set-Cookie` (empty body); `parseClaim` (`fixtures.ts:184-187`) asserts `status === 302` and reads the `dashboard_session` cookie off `Set-Cookie`, mirroring the settings vault's JSON-exchange shape only at the vault-handle level.
- **`then.responseJson` takes the already-parsed body, not the `Response`.** The helper is `then.responseJson(await res.json())`; `response.json()` is async, so the parse stays inline and only the (sync) assertion is traced via `tracedAssertion`.
- **`given.dashboardSession` omits the `prerequisite()` unstarted-world guard.** Unlike `given.settingsSession` (`scenario.ts:548`), `given.dashboardSession` (`scenario.ts:551-554`) only sets the event phase — mirroring the pre-existing `given.llm` sub-pattern — because story usage calls it after an anonymous `when.request` has already started the runtime; `runtimeRequest`→`ensureStarted` still rejects invalid world states.
- **Seam contract tests drop an unneeded `async`.** Several new `scenario.test.ts` / `fake-magi.ts` callbacks that contain no `await` are written non-`async` to satisfy oxlint's pedantic `require-await`; behavior is identical and no lint-disable was used.
- **The shipped catalog totals far exceed F4's era target.** The plan's ledger target was **81→87 executable / 41 pending (128 ids)**. Shipped, the catalog now carries **140 executable / 25 pending (165 ids)** (`catalog-coverage.test.ts:114,216,305`; `tests/scripts/story-coverage-totals.test.ts:14-26`): the sibling story-family batch (ADR-0293, 0297-0300) and the tier-expansion roadmap landed after F4 and filled `EXECUTABLE_STORY_MAPPINGS` far beyond F4's six records, and `http-mcp-plugin` and `http-mattermost-action` later became executable under F7 (`verifiedAt: '2026-07-22'`) and the T3 platform lane (`verifiedAt: '2026-07-25'`, provingTier `3`) respectively. F4's own deliverables — the six `SCN-http-*` mappings at `verifiedAt: '2026-07-20'` and the `http-mcp-plugin` F4→F7 reclassification — are all present; the larger totals are the cumulative state, not an F4 divergence.
- **Zero production `src/` changes, confirmed.** F4's defining constraint held: `grep`/`read` against `src/dashboard-auth/`, `src/notify-token.ts`, `src/debug/transcript-viewer.ts`, and `src/debug/notify-route.ts` shows the seams consume existing exports (`issueClaim`, `SESSION_COOKIE_NAME`, `resetNotifyTokenCacheForTesting`, `getViewerMagiConfig`) with no modification.

The source plan `docs/superpowers/plans/2026-07-20-f4-http-story-family.md` and design `docs/superpowers/specs/2026-07-20-f4-http-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
