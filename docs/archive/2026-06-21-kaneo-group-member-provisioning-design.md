<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kaneo group-member provisioning — design spec

**Date:** 2026-06-21
**Status:** Approved for planning
**Branch:** `feat/live-status-toggle`
**Bug:** "Assign in Kaneo (auto-provisioned groups) fails — only a single group service account exists; group members are not registered as Kaneo users, so they cannot be assignees."

---

## 1. Problem

When a Kaneo task provider is provisioned for a **group** context, `provisionAndConfigure`
(`plugins/task-provider-kaneo/provision.ts`) creates exactly **one** Better Auth account
(synthetic `…@pap.ai`), **one** workspace (`organization/create`), and **one** API key,
storing the credential + `workspaceId` under the group's `contextId`. That single account is
the group's **service account** the bot uses to manage tasks.

Consequences (verified in code):

- The only user endpoint in the Kaneo plugin is read-only `GET /workspace/{id}/members`
  (`operations/users.ts:56`). There is **no** create-user / invite-member / add-member call.
- `KaneoProvider.listUsers` is **not implemented**, so the `find_user` tool is never even
  registered for Kaneo (`src/tools/collaboration-tools-builder.ts:23` gates on
  `provider.listUsers !== undefined`).
- No code ever syncs chat members into a Kaneo workspace. `group_member:added`/`removed`
  events fire (`src/groups.ts:23,36`) but have **no subscriber**.

Therefore a specific group member cannot be resolved or assigned: the workspace contains only
the service account, the identity resolver finds no match, and no `userId` can be produced.

## 2. Goal

Each chat member of a group (members **and** group admins; guests excluded) is registered as a
Kaneo user, **added to the group's existing workspace**, and linked to their chat identity — so
the bot can resolve and assign tasks to them by name, and the member can obtain credentials to
use Kaneo's own UI.

Non-goals (v1): removing a member from the Kaneo org when they leave the chat (mark inactive
only); per-member separate workspaces; YouTrack support (capability simply absent there).

## 3. Decisions (locked during brainstorming)

| Decision             | Choice                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Identity model       | One **real** Kaneo account per chat member, added to the group's existing workspace; member can use Kaneo UI via their own credentials. |
| Trigger              | **Eager** on `group_member:added` + one-shot **backfill** + **first-interaction backstop**.                                             |
| Credential delivery  | **Settings web UI** (view email / reset-and-reveal-once password). No plaintext password in chat.                                       |
| Membership mechanism | **Approach A**: `organization/add-member` over HTTP with the service-account session (no email handshake).                              |
| On account creation  | Set Kaneo account **`name` = chat display name** and **write the identity link** automatically.                                         |
| Account reuse        | One Kaneo account per chat **person**, reused across that person's Kaneo groups.                                                        |

## 4. Architecture

### 4.1 Provider seam (provider-agnostic)

Add to `TaskProvider` (`src/providers/types.ts`):

```ts
// gated by capability string 'members.provision'
provisionWorkspaceMember?(member: {
  chatUserId: string
  displayName: string
  username: string | null
}): Promise<{ providerUserId: string; login: string }>
```

The provider instance already carries the group's service credential + `workspaceId`, so the
method needs only the member's chat identity. YouTrack does not implement it (capability absent
→ feature inert). The core never calls Kaneo HTTP directly.

Also implement the currently-missing **`KaneoProvider.listUsers`** (thin wrapper over
`kaneoListUsers`) so `find_user` is registered for Kaneo and the LLM can resolve a name →
Kaneo `userId` for assignment.

### 4.2 Kaneo implementation

New operation `kaneoProvisionMember` (`plugins/task-provider-kaneo/`):

1. **Create user** — `POST /api/auth/sign-up/email` with `name = displayName`, synthetic
   `…@pap.ai` email, generated password. (Reuse/refactor the existing `doSignUp` helper.)
2. **Add to workspace** — `POST /api/auth/organization/add-member` with
   `{ userId, organizationId: <workspaceId>, role: "member" }`, authenticated with the
   **service-account session** (the stored `kaneoKey`). An already-member conflict is treated
   as success.
3. Return `{ id, email }`.

Account reuse: before sign-up, look up an existing identity link / member row for this
`chatUserId`; if a Kaneo account already exists, **skip sign-up** and only run add-member
against this group's workspace.

### 4.3 Persisted state

**New table `kaneo_workspace_members`** (new migration):

| column             | notes                                 |
| ------------------ | ------------------------------------- |
| `group_context_id` | group's storage/config context id     |
| `chat_user_id`     | chat platform user id                 |
| `provider_name`    | `'kaneo'`                             |
| `provider_user_id` | Better Auth user id (the assignee id) |
| `login`            | synthetic email                       |
| `status`           | `active` \| `inactive` \| `failed`    |
| `created_at`       | ISO timestamp                         |

Unique key `(group_context_id, chat_user_id, provider_name)`; `onConflictDoNothing` for
idempotency. Source of truth for the settings credentials view and backfill tracking.

**Identity link** — on success, write `user_identity_mappings` keyed by `(chatUserId, 'kaneo')`
with new `matchMethod: 'provisioned'`. This makes both `resolveMeReference` (self) and
name-based `searchUsers` / `find_user` (third-party) resolve the member. The `'provisioned'`
write **must not overwrite** an existing non-provisioned link (`manual_nl`/`auto`).

### 4.4 Orchestrating service — `ensureWorkspaceMember`

`src/providers/membership/` (provider-agnostic core). Single idempotent entry point:

```
ensureWorkspaceMember(groupContextId, chatUserId)
  -> 'created' | 'exists' | 'skipped' | 'failed'
```

Steps:

1. Short-circuit if a `kaneo_workspace_members` row already exists → `exists`.
2. Resolve the group's config context → task provider (`defaultTaskProviderResolver`); bail
   (`skipped`) unless it is Kaneo **and** advertises `members.provision` **and** the group
   workspace is provisioned.
3. Resolve display name via `ChatRouter.resolveUserLabel(chatUserId, { contextType:'group',
contextId, platformInstanceId })`. On null, fall back to `@username`, else `User <id>`.
4. Call `provider.provisionWorkspaceMember(...)`.
5. Persist the member row + write the `'provisioned'` identity link.

All failures are logged and recorded as `failed` — never thrown into the caller.

## 5. Triggers

1. **Eager — `group_member:added` subscriber** (primary). Global event-bus subscriber calls
   `ensureWorkspaceMember`. **Skips** placeholder (`placeholder-<uuid>`) and guest users.
   Bounded with `p-limit`.
2. **Backfill — one-shot pass** over existing `group_members` rows for Kaneo-assigned groups.
   Runs **automatically on startup** (startup-guarded, idempotent, bounded concurrency) and is
   re-runnable via an **admin "sync now"** action. Catches groups that predate the feature.
3. **First-interaction backstop** — in the group turn path, alongside `maybeAutoLinkIdentity`,
   call `ensureWorkspaceMember` for the **speaker** if no row exists. Catches Telegram
   placeholders rebound on first DM, members the eager path missed, and transient
   `resolveUserLabel` failures.

**Removal:** `group_member:removed` → mark the member row `inactive`. v1 does **not** remove the
user from the Kaneo org (preserves historical assignees; revocation is a later iteration).

**Idempotency & races:** unique key + `onConflictDoNothing` + the existence short-circuit make
concurrent triggers safe (eager add racing first-interaction). `add-member` on an already-member
is treated as `exists`.

## 6. Credentials (settings UI)

New settings section "My Kaneo access" + API route `GET/POST /settings/api/kaneo/credentials`,
behind the existing settings session / `requireScope` guard (a member only ever sees their own
row).

- `GET` → member's Kaneo `email` + workspace URL for the current group context. **Password is
  never returned for an existing account.**
- `POST { action: 'reset' }` → reset the member's account password and reveal the new password
  **once** in the response body.

This stores **no reversible password** — only `email` / `providerUserId`. The reset path is the
only way to obtain a usable password.

**Dependency:** password reset needs a Kaneo/Better-Auth endpoint reachable over HTTP (admin
`set-password` is also "server-only"). This rides on the **Phase-0 spike**. If no reset path is
exposed over HTTP, fallback: capture the generated password at creation and store it
**encrypted at rest** (reuse the `INSTANCE_CONFIG_KEY` AES-256-GCM helper), reveal-once from
there. Both paths are written; the spike selects which ships.

## 7. Error handling (all best-effort; never breaks a turn)

- **Registration disabled** on Kaneo → record `failed`, surface once to admins (reuse
  `KANEO_REGISTRATION_DISABLED_MESSAGE`); no retry-spam.
- **`resolveUserLabel` null** (e.g. Telegram private account) → fall back to `@username`, else
  `User <id>`; still provision so the member stays assignable.
- **`add-member` unreachable** (bad spike outcome) → `failed`, logged with the classified
  error; feature degrades to "no auto-assignment" rather than erroring.
- **Member not provisioned at assignment time** → existing `identity_required`-style graceful
  path still applies.

## 8. Testing (DI-first, per `tests/CLAUDE.md`)

- `ensureWorkspaceMember` state machine: `exists`/`created`/`skipped`/`failed`, placeholder &
  guest skips, idempotent races — with a fake provider.
- Kaneo `provisionMember` / `listUsers` against a mock fetch asserting exact endpoints + bodies
  (sign-up `name`, add-member `organizationId`/`role`, already-member conflict → success).
- Event subscriber + backfill with an in-memory event bus; assert `p-limit` boundedness and
  placeholder/guest skips.
- Settings route: scope isolation (a member cannot read another's credentials) and reveal-once
  semantics.
- Identity-link write: `'provisioned'` does not overwrite `manual_nl`/`auto`.
- No fixed-wall-clock assertions; poll for conditions.

## 9. Phasing

- **Phase 0 — feasibility spike (blocking).** Confirm against the real Kaneo deployment that
  `organization/add-member` (and a password-reset path) are reachable over HTTP with the
  service-account session. Outcome selects add-member vs. encrypted-password fallback. Nothing
  else builds until this resolves.
- **Phase 1** — provider seam + Kaneo `provisionMember` + `listUsers` (behind capability).
- **Phase 2** — member table, identity-link write, `ensureWorkspaceMember` service.
- **Phase 3** — triggers: eager subscriber, backfill, first-interaction backstop.
- **Phase 4** — settings-UI credentials view + reset.
- **Phase 5** — prompt/tool wiring so the LLM uses `find_user` for Kaneo assignment
  (assignment-only; light overlap with the separate reminder-mention work).

## 10. Open questions / risks

- **Phase-0 spike is load-bearing.** Both `add-member` and password-reset are "server-only" in
  Better Auth; HTTP reachability via the service-account session is unverified against the
  deployment. The encrypted-password fallback de-risks credentials; if `add-member` itself is
  unreachable, escalate to a Kaneo-side route (out of this repo) before proceeding.
- **Service-account auth shape.** Org endpoints may require a real session cookie rather than an
  API key; the stored `kaneoKey` can be either. The spike must confirm which the service account
  holds and whether it satisfies `add-member`.
- **Multi-group / one-account reuse** relies on the global `(chatUserId, 'kaneo')` identity link;
  interaction with the existing **DM personal-account** provisioning (also keyed by `chatUserId`)
  must avoid clobbering — the `'provisioned'` no-overwrite rule covers this, to be verified in
  Phase 2.
