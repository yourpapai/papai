# Design

## Context

See `proposal.md` — Why, and the two specs for requirements.

The member path is `KaneoProvider.provisionWorkspaceMember` (`plugins/task-provider-kaneo/provider.ts`) → `kaneoProvisionMember` (`plugins/task-provider-kaneo/operations/members.ts`). It currently receives `this.config.baseUrl` as both the HTTP base and the trusted `Origin`. The provider config is built in `entry-runtime.ts` from the resolver's merged instance config; `internalUrl` is present in the instance schema and in the merged record but is discarded. Group provisioning already separates the two: `provisionKaneoUser(internalUrl, publicUrl, …)` sends auth traffic to the internal URL and uses the public URL only as `Origin`.

The credential surface is `src/debug/settings/kaneo-credentials-routes.ts`, reached only through `resolveContextScope(principal, action, contextId)`. For a group context that requires `manageableGroups`, which is populated from `groupAdminObservations` with `isAdmin = true`. A member row is keyed `(group_context_id, chat_user_id, provider_name)`; `group_context_id` is the scoped config context id (`pi:<b64>:ctx:<b64>`), so a platform-instance filter is derivable without new state. The settings bootstrap already requires a live authorized principal (`requireScope` personal), so the member-scoped route inherits that prerequisite; this change does not widen settings authorization.

## Goals / Non-Goals

**Goals:**

- Make member provisioning independent of whether the public edge accepts `/api/auth/sign-up/*`.
- Let an authorized member retrieve their own login and reveal their own password once, without group-manager scope.
- Keep the existing group-manager credential surface and the group service-account provisioning path unchanged.
- Keep all credential handling encrypted at rest, reveal-once, and absent from logs.

**Non-Goals:**

- Persisting the failure reason on `kaneo_workspace_members` (logs remain the operator source).
- Retry queues/backoff, or auto-provisioning group service accounts.
- Broadening settings bootstrap so non-authorized group members can open the UI.
- Exposing another member's row to an admin, or adding password reset.
- Changing identity mapping, guest mode, or the group provisioning flow.

## Decisions

### D1 — Thread `internalUrl` through the Kaneo provider config and use it only for member auth traffic

`entry-runtime.ts` SHALL set an optional `internalUrl` on `KaneoConfig` from the merged `config['internalUrl']`. `members.ts` SHALL derive `authBaseUrl = internalUrl ?? baseUrl` and use it for sign-up, sign-in, invite-member, and accept-invitation; it SHALL keep `publicUrl = baseUrl` for the `Origin` header, the secure-cookie prefix decision, and the workspace URL shown to the member. All other Kaneo operations SHALL keep using `baseUrl`.

Alternatives rejected:

- **Unblock public sign-up in Caddy.** Reopens registration to the internet and made every member attempt fail in production; rejected.
- **Use the internal URL as `baseUrl`.** Would change task/project link generation and every API call, and contradicts the instance schema's public-URL meaning.
- **Read `KANEO_INTERNAL_URL` from the plugin.** The provision route uses the env var, but the provider should consume operator-set instance config so multiple instances and tests stay isolated.

No fallback from a failing internal URL to the public URL: a silent fallback would mask a misconfigured deployment and usually hit the same edge block. The failure is recorded as `failed` and logged with the provider status.

### D2 — Add a self-scoped credentials route, separate from the group route

Add `GET /settings/api/kaneo/credentials/self` and `POST /settings/api/kaneo/credentials/self` (`{ action: 'reveal', contextId }`), dispatched before the existing `/settings/api/kaneo/credentials` route. The existing route and its authorization stay byte-identical.

Why a separate route rather than a mode on the existing handler: the two paths have different authorization models (groupmanager scope vs row ownership). Keeping them separate prevents a future edit to the member path from accidentally widening the group path.

`GET` queries `kaneo_workspace_members` for `chat_user_id = principal.platformUserId`, filters to scoped group contexts whose parsed `platformInstanceId` equals the principal's, keeps only currently authorized groups, joins `known_group_contexts` for the display label (falling back to the native context id when the row is absent), and resolves `kaneoUrl` per context via `getContextSettings` → `getTaskInstance(...).config['baseUrl']` (null when unconfigured). It returns `{ memberships: [{ contextId, groupLabel, login, status, kaneoUrl }] }` and never the password.

`POST` loads the row by `(contextId, principal.platformUserId)`, verifies the group is authorized and belongs to the principal's platform instance, requires CSRF, then decrypts with `decryptInstanceConfig`, returns the password with the store-securely warning, and clears `encrypted_password` immediately. Missing row or a row owned by another user returns the same 404 shape, so existence is not disclosed. A null ciphertext returns 409 (already-revealed or legacy row). A decryption failure returns a generic 500 and leaves the row unchanged.

No group scope is used for either method. The session must still resolve an authorized principal through the existing bootstrap, so guests and unauthorized users are rejected before any query.

### D3 — Personal-context UI as a sibling section, not a mode switch

Add `KaneoAccessSelfSection.svelte` under `client/settings/sections/`, composed from the existing primitives (`PageHeader`, `KV`, `StatusPill`, `Btn`, `Code`, `CopyButton`, `EmptyState`, `ErrorState`, `IconButton`) and a `KaneoMembership` fetcher pair. It lists memberships and renders one reveal block per row, with the same one-way hide semantics as the group section. `KaneoAccessSection.svelte` stays untouched for group admins.

Add `{ id: 'kaneo-access-self', label: 'My Kaneo access' }` to `PERSONAL_ITEMS` in `nav.svelte.ts` and render the new section in the personal branch of `SettingsApp.svelte`; the existing group entry keeps id `kaneo-access` and is relabeled "Group Kaneo access" so the two surfaces do not share an id or a label. A separate component avoids threading an optional list mode through the existing single-row state machine and keeps the change testable in isolation; the duplicated reveal call is one fetcher invocation.

### D4 — No persisted state, migration, or backfill

`kaneo_workspace_members` already holds login, status, and encrypted password. The self route derives platform-instance membership from the scoped context id; no new column or index is needed. Failed rows are retried by the existing triggers; no data migration. The deployment step is to set `internalUrl` on the Kaneo task instance (or keep `KANEO_INTERNAL_URL` in the bootstrap) and re-trigger member provisioning for rows already `failed`.

### D5 — Keep the public edge closed; fix the deployment documentation

The Caddy rule blocking `/api/auth/sign-up/*` stays. `internalUrl` becomes the supported bypass for bot-internal auth traffic. Update `docs/architecture/plugins.md` and `docs/architecture/environment.md` to state the contract, and reconcile `.env.example`'s misleading claim that `KANEO_DISABLE_REGISTRATION` should be flipped temporarily — it is the app-level switch, not the edge rule. Add a comment to the `Caddyfile` block saying member provisioning uses the internal URL and must not be opened publicly.

### D6 — Scope-model and capability impact

- Persisted state: unchanged; rows stay group-shared under the group config context id, and the password remains per-member.
- New route authorization: per-user (`principal.platformUserId` + `platformInstanceId`), not per-group.
- No new tool surface, so `tool_prefs`/capability gating is untouched.
- Guests are excluded by the existing settings session gate and by the guest exclusion in member provisioning.
- Platforms: the route is platform-agnostic; the platform-instance filter prevents a shared numeric chat id across Telegram/Discord/Mattermost/Kontur Talk from crossing rows.
- Task instances: Kaneo only; YouTrack/GitHub have no member provisioning or member rows.

## Risks / Trade-offs

- **Internal URL unreachable or misconfigured** → member provisioning fails; the failure is logged with the provider error and the row stays retryable. Mitigated by documenting `internalUrl` as required when the public edge blocks sign-up.
- **Server-side request now bypasses the edge** → only bot-internal traffic to the configured instance path; the public URL stays the authorized origin for Better Auth. No user-controlled host is introduced.
- **Self listing reveals group memberships** → only the caller's own rows, and group labels are already visible in the chat; accepted.
- **Numeric chat ids collide across platform instances** → scoped `pi:` prefix filter; covered by a test.
- **Reveal-once remains destructive** → second reveal 409 and no reset; unchanged contract, documented in the UI.
- **Failed rows stay opaque in the DB** → operators still need logs; persisting an error column is deferred.

## Migration Plan

1. Deploy the plugin/config change; no DB migration.
2. Ensure the Kaneo task instance has `internalUrl` (the compose default `http://kaneo:5173`) and keep the public edge block in place.
3. Re-trigger member provisioning for existing `failed` rows: remove/re-add via Settings → Members, or have each member send one group message; the startup backfill covers the next restart.
4. Verify rows become `active` with a non-null `encrypted_password`, then verify a member can list/reveal from the personal settings context.
5. Rollback is a plain revert; active rows and stored encrypted credentials remain valid, and the existing group route is untouched.

## Open Questions

- Should a later change persist the last provisioning error on the member row for operator visibility? Deferred; it does not affect these specs or the task breakdown.
