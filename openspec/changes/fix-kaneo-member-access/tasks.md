# Tasks

## 1. Member auth through the internal URL

- [x] 1.1 Add failing tests in `tests/plugins/task-provider-kaneo/operations/members.test.ts`: with `internalUrl` set, sign-up/sign-in/invite/accept hit the internal base while `Origin` stays the public URL; with it absent, all requests use the public base; a task/project link still uses the public URL — run `bun test tests/plugins/task-provider-kaneo/operations/members.test.ts` and confirm the new cases fail
- [x] 1.2 Add the optional `internalUrl` to `KaneoConfig` and populate it in `plugins/task-provider-kaneo/entry-runtime.ts`; derive `authBaseUrl = internalUrl ?? baseUrl` inside `members.ts` while keeping `publicUrl` for `Origin` and the secure-cookie prefix — run `bun test tests/plugins/task-provider-kaneo/operations/members.test.ts tests/plugins/task-provider-kaneo/entry-runtime.test.ts`
- [x] 1.3 Add an `entry-runtime` regression test asserting `internalUrl` is preserved in the built config and stays undefined when the instance omits it — run `bun test tests/plugins/task-provider-kaneo/entry-runtime.test.ts`
- [x] 1.4 Update `docs/architecture/plugins.md` and `docs/architecture/environment.md` with the member-auth contract (internal URL for auth traffic, public URL for `Origin`/links, required when the edge blocks sign-up) and fix the `.env.example` registration guidance; add a comment to the `Caddyfile` sign-up block — verify with `bun run format:check`

## 2. Member-scoped credentials API

- [x] 2.1 Add failing route tests in `tests/debug/settings/kaneo-credentials-routes.test.ts`: self list returns only the caller's rows for authorized groups on the caller's platform instance, excludes deauthorized groups and other users, and tolerates a null task instance; reveal succeeds once, 409s on a second attempt, rejects missing CSRF, denies another user's row as 404, and returns a generic error on decrypt failure — run `bun test tests/debug/settings/kaneo-credentials-routes.test.ts` and confirm the new cases fail
- [x] 2.2 Implement the self list handler and helpers in `src/debug/settings/kaneo-credentials-routes.ts` (platform-instance filter from the scoped context id, authorized-group filter, `known_group_contexts` label, per-context `kaneoUrl`) — run `bun test tests/debug/settings/kaneo-credentials-routes.test.ts`
- [x] 2.3 Implement the self reveal handler with row-ownership authorization, CSRF, reveal-once ciphertext clear, and non-disclosing 404 — run `bun test tests/debug/settings/kaneo-credentials-routes.test.ts`
- [x] 2.4 Dispatch `GET`/`POST /settings/api/kaneo/credentials/self` before the existing group route in `src/debug/settings-api-router.ts` and add a route-dispatch test asserting the existing group route is unchanged — run `bun test tests/debug/settings/kaneo-credentials-routes.test.ts`
- [x] 2.5 Update `docs/architecture/plugins.md` with the member-scoped credential route and its ownership authorization (no group-manager scope, encrypted-at-rest, reveal-once) — verify with `bun run format:check`

## 3. Personal-context settings surface

- [x] 3.1 Add failing fetcher/schema tests for the self endpoints in `tests/client/settings/fetcher-schemas-kaneo.test.ts`, then implement `KaneoMembershipSchema`, the list fetcher, and the self reveal fetcher in `client/settings/` — run `bun test tests/client/settings/fetcher-schemas-kaneo.test.ts`
- [x] 3.2 Add failing component tests for `KaneoAccessSelfSection.svelte` covering the loaded list, empty state, reveal-once behavior, and error state; implement the section with the shared primitives and its MSW handlers/story — run `bun test tests/client/settings/sections/KaneoAccessSelfSection.test.ts`
- [x] 3.3 Add `kaneo-access` to the personal nav items and render the new section in the personal branch of `SettingsApp.svelte`; update `tests/client/settings/nav.svelte.test.ts` — run `bun test tests/client/settings/nav.svelte.test.ts tests/client/settings/sections/KaneoAccessSelfSection.test.ts`
- [x] 3.4 Add the Storybook story for the new section and refresh the story manifest/coverage; verify with `bun run test:stories:manifest`

## 4. Integration and full verification

- [x] 4.1 With Docker available, bring up the pinned Kaneo behind a Caddy config that blocks `/api/auth/sign-up/*`, provision a member through the configured internal URL, and confirm the member row becomes `active` with a stored password while public sign-up remains 403; tear down with `down -v`
- [x] 4.2 Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun security`, and `openspec validate --strict fix-kaneo-member-access`; confirm all green
- [ ] 4.3 Run `bun test:mutate:changed --base=HEAD~1` so the changed files' mutation scores are seeded for the CI ratchet; confirm no target falls below its recorded floor

## Workflow follow-up

- Archive the change after review approval and PR merge, per `openspec/config.yaml` archive guidance.
- Deploy note: set `internalUrl` on the Kaneo task instance before relying on member provisioning; re-trigger any `failed` rows via Settings → Members or a group message.
