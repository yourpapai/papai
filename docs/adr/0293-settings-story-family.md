<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0293: Settings HTTP Story Family — Tier 0 Qualification Coverage for Settings Write Paths

## Status

Implemented (with divergence)

## Date

2026-07-18

## Context

The hermetic Tier 0 story harness ([ADR-0282](0282-hermetic-e2e-master-baseline.md)) and the scenario catalog ledger ([ADR-0284](0284-scenario-catalog-hermetic-stories.md)) carried ~19 executable settings-era mappings; ten `SCN-settings-*` catalog IDs remained pending. The catalog's qualification rule is strict: every executable record must prove **both** that a setting was changed through the real HTTP write path **and** that the change alters observable behavior (the next chat turn, a coding-session start, or a settings authorization flip). A route-status-only story is **not** coverage.

The `/settings/api/*` surface (ADRs 0136–0139, restructured by 0187/0208 and extended by the coding-credentials, coding-repos, identity, context, and admin routes) had per-route unit tests but no end-to-end "write → behavior" story proof. Two MCP-admin IDs (`SCN-settings-admin-mcp-catalog`, `SCN-settings-admin-mcp-plugin-servers`) were explicitly deferred: their behavioral proof requires MCP-sourced tools in a chat turn, which requires a fake-MCP-server seam that did not exist.

The design (`docs/superpowers/specs/2026-07-18-settings-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-18-settings-story-family.md`) chose to map the ten implementable IDs to qualification stories across three (planned) story files plus one small harness fixture (`given.settingsAdminSession`), with the explicit policy that any production bug discovered en route lands as its own commit, separate from the story. The plan's preamble already flagged four expected divergences from the spec — most notably that the identity story would go **red** because the HTTP route keyed the identity mapping by the *scoped* config context id while the chat resolver reads the *raw* user id, exposing a real key-scope bug.

## Decision Drivers

- **Qualification over contract.** Each of the ten IDs must prove the HTTP write *and* the resulting behavior change; a story that only asserts a response status/shape is rejected by the catalog's qualification rule.
- **Drive the real in-process write path.** Stories exercise the actual `/settings/api/*` routes through `when.settingsRequest` (cookie session, CSRF header, resolved principal), not a fixture shortcut that bypasses authorization.
- **One behavior proof per family.** Context-config → the next turn's tool-visibility flush; identity → `me` resolves to the saved mapping; instances → the next turn lands tasks on the new instance; coding forge/mcp/repos → the fake-magi session start carries the saved config; admin guardrails → the advertised toolset flips for non-allowlisted users; admin system-access → the authorization decision flips 403↔200; admin roster-announce → a broadcast DM reaches every authorized user.
- **Bug fixes discovered en route land separately.** The identity story is written red first; the key-scope fix ships as its own commit before the green story + ledger entry.
- **Defer what needs a missing seam.** The two MCP-admin IDs (and any fake-MCP-server seam) move to a later MCP-focused spec; they are not forced into this family.
- **No new failure-injection machinery.** strict-http and the scripted model already fail the run on any undeclared call; the spec's three error layers (HTTP contract / fail-closed writes / secret hygiene) are asserted as explicit `then.responseStatus` checkpoints inside each story.

## Considered Options

### Option 1 — Qualification story family + `settingsAdminSession` fixture + separate identity bug fix (chosen)

Four story files under `tests/stories/settings/` (context-and-instances, identity, coding-surfaces, admin-surfaces) plus a `given.settingsAdminSession`/`seedAdmin` harness seam. Each of the ten IDs maps to a story that drives the real HTTP write and then proves the behavior change. The identity story goes red first; its key-scope bug fix lands as a dedicated commit before the green story and ledger entry.

- **Pros:** real write-path coverage with behavior proofs; the identity key-scope bug is caught by the red story and fixed at source; no new fakes or background services; secret-hygiene assertions baked into every credential-bearing story; the non-admin/super-admin denial matrix becomes provable in one scenario via the admin-session fixture.
- **Cons:** identity forces a fourth file (the spec planned three) and a production `src/` change — counter to the spec's "no production changes anticipated," though exactly per its "bug fixes land separately" policy; roster-announce has no membership-add surface, so it must qualify the admin broadcast route instead.

### Option 2 — Contract-only stories (rejected)

One status-and-shape assertion per route cluster, no behavior turn.

- **Pros:** cheapest; one file per route cluster; no chat-turn wiring.
- **Cons:** rejected by the catalog's qualification rule — a green contract story proves nothing about whether the write actually changed behavior, which is the entire point of the settings-era ledger.

### Option 3 — Build the fake-MCP-server seam now and cover the two MCP-admin IDs here (rejected)

Cover all twelve settings IDs in a single pass by introducing the fake-MCP-server seam in this family.

- **Pros:** full settings coverage in one cycle.
- **Cons:** out of scope; the MCP seam is its own sub-project (spec non-goal) and would couple this family to MCP harness work; the deferral is deliberate and the IDs land cleanly in a later MCP-focused spec.

## Decision

The chosen Option 1 shipped across four story files, the harness seam, one production bug fix, and ten ledger mappings. What shipped:

1. **`tests/stories/settings/context-and-instances.story.test.ts`** — `SCN-settings-bootstrap` (bootstrap GET → empty assignment → assign → config served → working turn), `SCN-settings-instances` (422 before create → 401 unauthenticated → admin POST 201 → assign → working turn), `SCN-settings-context-config` (`ai_tool_visibility` off→on flips the `create_task` progress flush into the posted replies).
2. **`tests/stories/settings/identity.story.test.ts`** — `SCN-settings-identity` (PUT identity → GET reflects → the next turn's `task.list` resolves assignee `me` to `tracker-alice`).
3. **`tests/stories/settings/coding-surfaces.story.test.ts`** — `SCN-settings-coding-forge` (forge PATCH → fake-magi start carries `forgeToken`), `SCN-settings-coding-mcp` (malformed MCP JSON fails closed 422 → valid → fake-magi `mcp`/`mcpTokens`), `SCN-settings-coding-repos` (invalid URL 422 → register → list contains → fake-magi start resolves it).
4. **`tests/stories/settings/admin-surfaces.story.test.ts`** — `SCN-settings-admin-guardrails` (guardrail flips `plugin_acp__start_session` out of the advertised toolset for non-allowlisted users), `SCN-settings-admin-system-access` (super-admin grant flips admin authorization 403→200; revoke returns 403), `SCN-settings-admin-roster-announce` (admin broadcast DMs every authorized user).
5. **`given.settingsAdminSession(user, options)` + `seedAdmin` fixture** — seeds the user into system access (platform or super admin via `SUPER_ADMIN_PLATFORM_ID`) before the auth-code exchange, returning the same `SettingsSessionHandle` as `settingsSession`.
6. **`src/debug/settings/identity-routes.ts` key-scope fix** — the GET/PUT/DELETE handlers now key `getIdentityMapping`/`setIdentityMapping`/`clearIdentityMapping` by `authed.principal.platformUserId` (the raw chat user id, matching every other writer), while `resolveContextScope` is retained for authorization and provider-name derivation.
7. **Ten `QUALIFICATION_STORY_IDS` entries and executable mappings** in `tests/stories/catalog/coverage.ts` (`verifiedAt: '2026-07-18'`), each resolving to a literal scenario name enforced by `catalog-coverage.test.ts`.

## Consequences

### Positive

- The settings-era ledger moves from ~19 → 29 executable mappings; every settings write path now carries a behavior proof rather than a route-status assertion.
- A real key-scope bug — the HTTP identity route keyed mappings by the scoped config context id while the chat resolver reads the raw user id — was caught by the red identity story and fixed at source; `me` now resolves correctly through the settings write path.
- Secret-hygiene assertions prove credential-bearing responses mask values and that the sanitized event trace carries no forge/MCP/provider/MAGI token.
- The `given.settingsAdminSession`/`seedAdmin` seam makes the full denial matrix (unauthenticated 401, non-admin 403, missing-CSRF 403, plain-admin-vs-super-admin 403) provable inside a single scenario.

### Negative

- A production `src/` change (identity-routes) landed with the story family, counter to the spec's "no production `src/` changes are anticipated" — though exactly per the spec's "bug fixes discovered en route land separately" policy, and the fix shipped as its own commit ahead of the green story.
- Four story files shipped, not the spec's three: identity got its own file so the red story and the bug fix could land as separate commits.
- The roster-announce story qualifies the admin broadcast route (`POST /settings/api/admin/announce`), not a membership-add announcement toggle, because no member-add announcement surface exists.

### Risks

- **The qualification proofs are coupled to specific behavior outputs** — the tool-visibility flush text, the `task.list` event shape, and the fake-magi start-session body. A future change to any of those output shapes will turn stories red even when the write path is correct. This is the intended refactor-resilience tradeoff: the red points to a real behavioral regression, not a stale contract.
- **The two MCP-admin IDs remain deferred** until a fake-MCP-server seam exists; the ledger keeps them pending. They later landed via the F7 MCP story-family plan (`verifiedAt: 2026-07-22`, `tests/stories/integrations/mcp/`), as [ADR-0284](0284-scenario-catalog-hermetic-stories.md) records — outside this plan's scope.

## Related Decisions

- [ADR-0282](0282-hermetic-e2e-master-baseline.md) — Hermetic E2E Master Baseline: the in-process story harness, deterministic boundary kit, and `scenario`/`given`/`when`/`then` DSL these stories are written in.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: the ledger whose qualification rule this family satisfies and whose ten mappings this family fills; also records the later MCP-family landing of the two deferred IDs.
- [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — Hermetic Story Process Sandbox: the OS-enforced sandbox under which these stories execute.
- [ADR-0136](0136-settings-web-ui-access-model.md) / [ADR-0137](0137-settings-web-ui-http-api.md) / [ADR-0138](0138-settings-web-ui-client-spa.md) / [ADR-0139](0139-settings-web-ui-command-retirement.md) — Settings Web UI: the access model, HTTP API, client SPA, and command retirement whose `/settings/api/*` write surface these stories qualify end to end.
- [ADR-0187](0187-settings-page-redesign.md) / [ADR-0208](0208-settings-ui-advanced-grouping.md) — Settings Page Redesign / Advanced Grouping: the settings surface layout these stories exercise through the HTTP routes.
- [ADR-0239](0239-storybook-settings-full-coverage.md) / [ADR-0240](0240-storybook-settings-story-backfill.md) — Storybook Settings coverage: the component-level (Storybook/MSW) settings coverage; this ADR is the in-process behavioral counterpart.
- [ADR-0166](0166-storybook-harness-pr1.md) — Storybook Harness PR 1: the Storybook harness, distinct from the hermetic story harness used here.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `tests/stories/settings/context-and-instances.story.test.ts:25-75` | `SCN-settings-bootstrap` — bootstrap GET → empty assignment → PATCH assign → config served → working chat turn; asserts CSRF-rejection 403 after the bootstrap GET rotates the token. | `read` confirms. |
| `tests/stories/settings/context-and-instances.story.test.ts:77-139` | `SCN-settings-instances` — 422 before create → 401 unauthenticated → admin POST 201 → assign 200 → working turn; typed `InstancesSchema` readback. | `read` confirms. |
| `tests/stories/settings/context-and-instances.story.test.ts:141-188` | `SCN-settings-context-config` — `ai_tool_visibility` off (no flush) → 422 unknown field → on (create_task success flush in `allReplies()`). | `read` confirms. |
| `tests/stories/settings/identity.story.test.ts:25-66` | `SCN-settings-identity` — PUT identity → GET reflects → next turn's `task.list` resolves `me` to `tracker-alice` (`assigneeId: 'tracker-alice', count: 0`); CSRF-rejection. | `read` confirms. |
| `tests/stories/settings/coding-surfaces.story.test.ts:34-141` | `SCN-settings-coding-forge` — 422 bad URL → 403 cross-context → CSRF 403 → PATCH 200 → fake-magi start carries `forgeToken`; secret-hygiene on FORGE/MAGI/PROVIDER tokens. | `read` confirms. |
| `tests/stories/settings/coding-surfaces.story.test.ts:143-254` | `SCN-settings-coding-mcp` — malformed JSON 422 fail-closed (read back `[]`) → CSRF 403 → valid → fake-magi `mcp`/`mcpTokens`; secret-hygiene. | `read` confirms. |
| `tests/stories/settings/coding-surfaces.story.test.ts:256-336` | `SCN-settings-coding-repos` — `git://` URL 422 → CSRF 403 → register 200 → list contains `papai` → fake-magi start resolves it; secret-hygiene. | `read` confirms. |
| `tests/stories/settings/admin-surfaces.story.test.ts:26-169` | `SCN-settings-admin-guardrails` — bob starts a session → guardrail applied → `plugin_acp__start_session` dropped for bob, retained for alice; 401/422/403/CSRF; `GuardrailsViewSchema` readback; secret-hygiene. | `read` confirms. |
| `tests/stories/settings/admin-surfaces.story.test.ts:171-225` | `SCN-settings-admin-system-access` — 401 unauthenticated → 403 non-super → CSRF 403 → super grant 200 → bob reads 200 → revoke → 403. | `read` confirms. |
| `tests/stories/settings/admin-surfaces.story.test.ts:227-269` | `SCN-settings-admin-roster-announce` — 422 empty message → 403 non-admin → CSRF 403 → broadcast `{totalUsers:2,successCount:2}` → DMs reach alice + bob. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:268,387-394` | `seedAdmin` fixture — `addAdmin(userId, superAdmin ? SUPER_ADMIN_PLATFORM_ID : platformInstanceId)`; declared on `ScenarioFixtures`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:481-487,559-567` | `seedAdminRole` helper + `given.admin` and `given.settingsAdminSession` DSL — both delegate to `seedAdminRole`, which calls `world.fixtures.seedAdmin`. | `read` confirms. |
| `tests/stories/harness/fixtures.test.ts:150-159` | `seedAdmin` contract test — platform admin then super admin roles via `isAdmin`/`isSuperAdmin`. | `read` confirms. |
| `tests/stories/harness/scenario.test.ts:311-324` | `given.admin`/`given.settingsAdminSession` contract — seeds the admin role without starting the runtime. | `read` confirms. |
| `src/debug/settings/identity-routes.ts:39-44,78-86,105` | Key-scope fix — GET/PUT/DELETE key the mapping by `auth.authed.principal.platformUserId` (raw); `resolveContextScope` retained for authz + provider derivation; 422 when no task instance configured. | `read` confirms. |
| `tests/debug/settings/identity-routes.test.ts:67,107,134-135` | Key expectation updated — `getIdentityMapping('u-1', 'kaneo')` (raw id), not the scoped `personalConfigContextId`; group-context mapping asserted null. | `read` confirms. |
| `src/debug/settings/admin/roster-plugins-routes.ts:92,119` | `handleAnnounce` + `/settings/api/admin/announce` route binding, importing `broadcastMessage` — the surface the roster-announce story qualifies. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:214-226` | The ten `SCN-settings-*` IDs in `QUALIFICATION_STORY_IDS` (plus the two deferred admin-mcp IDs, mapped later). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:425-496` | Ten executable mappings, `verifiedAt: '2026-07-18'`, each resolving to the literal scenario name. | `read` confirms. |

Plan-vs-implementation notes:

- **Identity is its own file (four files, not the spec's three).** The spec grouped `SCN-settings-identity` into File 1 (`context-and-instances`). The plan split it into `tests/stories/settings/identity.story.test.ts` so the red story and its key-scope bug fix could land as separate commits (spec policy: "bug fixes discovered en route land separately"). Shipped follows the plan: `identity.story.test.ts:25` is a standalone file.
- **The roster-announce story qualifies the admin broadcast route, not a membership-add announcement toggle.** The spec described `SCN-settings-admin-roster-announce` as "a membership-add produces a group announcement … when on, suppressed when off." No membership-add announcement surface exists. The plan remapped the ID to the roster-plugins admin broadcast route (`POST /settings/api/admin/announce` → proactive DM to every authorized user, `roster-plugins-routes.ts:92`). Shipped `admin-surfaces.story.test.ts:227` proves the broadcast reaches both seeded users (`totalUsers: 2`).
- **An extra `given.admin` DSL helper landed alongside `settingsAdminSession`.** The plan specified only `given.settingsAdminSession`. Shipped adds `given.admin(user, options)` (`scenario.ts:559`); both delegate to the shared `seedAdminRole` helper (`scenario.ts:481`). `given.admin` is used in `admin-surfaces.story.test.ts:177` to seed carol as a plain admin without spending the one-given-session budget.
- **CSRF-rejection negative paths, fail-closed readbacks, and secret-hygiene assertions were added to every story.** The plan's story bodies included some negative paths (422 unknown field, 401 non-admin) but not the explicit `{ csrf: false }` → 403 checks nor the "read back the prior value intact after a fail-closed write" proofs. Shipped adds both, fully realizing the spec's three-layer error-handling contract. For example `coding-surfaces.story.test.ts:190-192` reads the MCP selection back as `[]` after the malformed 422, and `:83-89` asserts CSRF rejection.
- **The guardrails story was substantially enriched beyond the plan.** The plan's guardrails proof inspected `world.model.inspections()` for the advertised toolset across a "What can you do?" turn. Shipped (`admin-surfaces.story.test.ts:26`) drives real coding-session starts through fake-magi (bob starts → guardrail applied → bob denied with `plugin_acp__start_session` dropped → alice still allowed), seeds `codingProject`/`codingCredentials` for both users, asserts `then.codingSessions(...).count(...)`, adds a `GuardrailsViewSchema` readback and a `kind: 'bogus'` 422, plus secret-hygiene on `PROVIDER_KEY`/`MAGI_TOKEN`. The toolset-inspection core is preserved; the behavioral proof is far stronger.
- **The instances story uses a typed `InstancesSchema`** (`context-and-instances.story.test.ts:23,119-121`) instead of the plan's loose `JSON.stringify(...).toContain('memory-tasks-late')`. Additive refinement.
- **`totalUsers: 2` (not 3).** The plan's draft body asserted `totalUsers: 3` and carried a Step-2 correction to 2 (alice + bob only). Shipped `admin-surfaces.story.test.ts:264` uses `totalUsers: 2, successCount: 2`, matching the correction.
- **The two MCP-admin IDs remained deferred at this plan's merge.** `SCN-settings-admin-mcp-catalog` and `SCN-settings-admin-mcp-plugin-servers` were deferred per spec (need a fake-MCP-server seam); they later landed (`verifiedAt: 2026-07-22`, `tests/stories/integrations/mcp/`) via the F7 MCP story-family plan, as [ADR-0284](0284-scenario-catalog-hermetic-stories.md) records. Out of scope here.

The source plan `docs/superpowers/plans/2026-07-18-settings-story-family.md` and design `docs/superpowers/specs/2026-07-18-settings-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
