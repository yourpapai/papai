# Proposal

## Why

Group-scoped Kaneo provisioning is dead on arrival. It builds the synthetic account email from the raw actor id; a group's id is the scoped config context id (`pi:<b64>:ctx:<b64>`) with a null username, so the email `pi:…:ctx:…-<suffix>@pap.ai` is rejected by Kaneo's Better Auth (`400 [body.email] Invalid email address`, reproduced on the pinned `ghcr.io/usekaneo/kaneo:2.7.2`). Nothing is stored for the group, its task provider never resolves, and the membership backstop, `group_member:added` subscriber, and startup backfill all skip — members never enter Kaneo (ADR-0215 is inert). Null-username DMs (Telegram users without a public username, `@user:server` ids) hit the same path.

## What Changes

- Provisioning derives the account email local part from a sanitized actor id (valid RFC 5321), not the raw id; the existing random suffix keeps it unique.
- The sanitizer is provisioning-specific: the member path's `toEmailLocalPart` truncates at the first `:`, collapsing a scoped id to `pi`.
- Unit tests pin the sign-up email to a real email validator across id shapes (scoped id, `@user:server`, numeric, unicode, empty) and keep the failed-outcome contract (no config write).
- Operator note: groups provisioned while this was broken must re-run Provision; there is no group auto-provision.

## Capabilities

### New Capabilities

- `kaneo-workspace-provisioning`: Kaneo provisioning SHALL mint an account whose email is valid for every identifier the core supplies, and persist credential/workspace only when the account exists. Without it: group contexts and null-username DMs never resolve a provider, run providerless, and ADR-0215 member registration never runs.

### Modified Capabilities

None — no spec under `openspec/specs/` covers workspace provisioning; `kaneo-provider-error-classification` covers only error mapping. The behavior lives unspecced in `plugins/task-provider-kaneo/provision-requests.ts` behind `src/debug/settings/provision-routes.ts`; this change specs its identity contract.

## Impact

- Code: `plugins/task-provider-kaneo/provision-requests.ts` (email derivation), a sanitizer beside it, tests under `tests/plugins/task-provider-kaneo/`.
- Scope: keyed by config context id — group-shared for groups, per-user for DMs; credential stored encrypted at rest. No new state, no migration.
- Task instances: Kaneo only (the sole type with a `provision` hook); YouTrack/GitHub unchanged.
- Platforms: adapter-agnostic; all four adapters in scope, only null-username shapes differ.
- Docs: `docs/architecture/environment.md`, `docs/architecture/plugins.md`.

## Non-goals

- Auto-provisioning on group task-instance assignment; settings Provision stays the only group trigger.
- Changing the invite/accept auth shape — verified live as working on 2.7.2 (Bearer shim, cross-group reuse).
- Sanitizing the workspace name (`User pi:…`) or slug; Kaneo accepts both (verified).
- Backoff/queueing for Better Auth's `/sign-up/email` 429s; failed rows retry on later turns.
- Member account email derivation — already sanitized.
- Re-provisioning groups created before scoped context ids — operational.
