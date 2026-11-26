# Proposal

## Why

Production Kaneo sits behind an edge rule that blocks `/api/auth/sign-up/*` publicly. Group provisioning signs up through the task instance's internal URL (`KANEO_INTERNAL_URL`), so it succeeds; member provisioning calls `provisionWorkspaceMember` with the provider's public `baseUrl`, so every member sign-up reaches the blocked path and returns an empty 403. In the copied production DB every `kaneo_workspace_members` row is `failed` with no login. Even after an operator temporarily unblocks sign-up, a non-admin group member still cannot see the group context in the settings UI — group scopes require group-manager status — so they cannot reveal the one-time password.

## What Changes

- Member auth traffic for Kaneo (`sign-up/email`, `sign-in/email`, `organization/invite-member`, `organization/accept-invitation`) uses the task instance's configured `internalUrl` when present; the public `baseUrl` remains the `Origin` and the user-facing link base. Without `internalUrl`, behavior falls back to today's public base.
- Add a member-scoped settings API: the caller can list their own `kaneo_workspace_members` rows (group label, login, status, workspace URL) and reveal their own stored password once, authorized by row ownership (`contextId` + `principal.platformUserId`) instead of group-manager scope. Other members' rows stay inaccessible.
- Surface that list in the settings UI's personal context as "My Kaneo access" with the same reveal-once behavior; the group-context section remains for group admins.
- Document the deployment contract: when the edge blocks public sign-up, `internalUrl` is required for member provisioning; reconcile the misleading `.env.example`/Caddy guidance. No schema, migration, or persisted-state change.
- Group service-account provisioning from the in-flight `fix-kaneo-group-provisioning` change is unchanged; this is its member-side complement.

## Capabilities

### New Capabilities

- `kaneo-member-provisioning`: without it, every group member's Kaneo account creation depends on public sign-up being reachable, so edge-blocked deployments stay `failed` and no member can be assigned or log in.
- `kaneo-member-credentials`: without it, a non-admin member has no way to retrieve the login/password that provisioning created; reveal is reachable only from a group context that requires group-manager status.

### Modified Capabilities

None. `kaneo-provider-error-classification` covers error mapping only; the in-flight `fix-kaneo-group-provisioning` owns `kaneo-workspace-provisioning`, which is not yet in `openspec/specs/`.

## Impact

- Code: Kaneo plugin (`entry-runtime.ts`, `provider.ts`, `client.ts`, `operations/members.ts`), settings routes (`src/debug/settings/kaneo-credentials-routes.ts`, `settings-api-router.ts`), settings SPA (`client/settings/{nav.svelte.ts,fetchers.ts,sections}`), and their tests.
- Scope: no new persisted state; new routes keyed by the caller's platform user id; `kaneo_workspace_members` stays keyed by the group config context id; per-user identity scope unchanged.
- Task instances: Kaneo only; YouTrack/GitHub unchanged. Platforms: adapter-agnostic (all four); guests remain excluded.
- Docs: `docs/architecture/plugins.md`, `docs/architecture/environment.md`, `.env.example`/Caddy guidance.
- Security: `bun security` because this touches credentials and auth traffic; no secrets logged.
