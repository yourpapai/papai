<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0215: Kaneo Group-Member Provisioning

## Status

Implemented

## Date

2026-06-21

## Context

When a Kaneo task provider is provisioned for a **group** context, `provisionAndConfigure` creates exactly one synthetic `…@pap.ai` Better Auth account, one workspace, and one API key — the group's **service account** the bot uses to manage tasks. The workspace contains no other users, so a specific group member can never be resolved as an assignee: `KaneoProvider.listUsers` was unimplemented (so the `find_user` tool was never registered), no code synced chat members into a Kaneo workspace, and the `group_member:added`/`:removed` events fired with no subscriber.

The 2026-06-21 design spec (`docs/superpowers/specs/2026-06-21-kaneo-group-member-provisioning-design.md`) set the goal: each chat member of a group is registered as a real Kaneo user, added to the group's existing workspace, and linked to their chat identity, so the bot can resolve and assign tasks by name and the member can obtain credentials for Kaneo's own UI. A Phase-0 feasibility spike against real Kaneo 2.7.2 then fixed the two load-bearing mechanism questions: `organization/add-member` and `admin/set-password` both return **404** over HTTP, so membership must use **invite-member + member auto-accept**, and credentials must use **encrypted-password-at-creation** (generate at sign-up, encrypt at rest, reveal once through the settings UI).

The spec's remaining decisions — eager `group_member:added` trigger + one-shot startup backfill + first-interaction backstop, settings-UI credential delivery, and a `'provisioned'` identity `MatchMethod` that never overwrites `auto`/`manual_nl` — were all retained and implemented.

## Decision Drivers

- **Assignability**: a named group member must resolve to a real Kaneo `userId` so `create_task`/`update_task` can set an assignee; the service account alone cannot be the only workspace user.
- **Provider generality**: the provisioning seam must live on the provider-agnostic `TaskProvider` interface (gated by a capability), not in core calling Kaneo HTTP directly; YouTrack simply lacks the capability and the feature stays inert.
- **Identity integrity**: provisioning must not clobber an identity link a user already established via auto-detection or manual NL assignment; the new mapping is lowest-priority.
- **No plaintext credentials in chat**: the member's password is delivered only through the settings web UI, and only revealed once.
- **Turn safety**: provisioning is best-effort and fire-and-forget; a failure (Kaneo down, registration disabled, unresolvable label) must never break or block a chat turn.
- **Guest exclusion**: guests are never provisioned a workspace account, per the guest-mode contract (ADR-0213).

## Considered Options

### Option A: `organization/add-member` over HTTP with the service session (spec's original choice)

- **Pros:** Single service-account call; no per-member session choreography; matches the existing service-credential model.
- **Cons:** Returns **404** in Kaneo 2.7.2 (verified by the Phase-0 spike) — the endpoint is server-only and not exposed over HTTP. **Dead.**

### Option B: invite-member + member auto-accept (chosen)

- **Pros:** `invite-member` returns **200** with the service credential; `accept-invitation` with the member's own session cookie joins them to the workspace. Reuses the existing sign-up/sign-in helpers and the service-account auth shape.
- **Cons:** Three-step sequence (sign-up → invite → accept) is **not idempotent**: a retry after a partial failure can orphan a Better Auth account or hit a still-pending invitation error. Requires capturing the member's session cookie between steps. Full resume-by-stored-state idempotency is deferred to a later iteration.

### Credential delivery: admin `set-password` reset vs. encrypted-password-at-creation (Branch B)

- **Pros of Branch B:** `admin/set-password` also returns **404** (server-only), so the only reachable mechanism is to generate the password at sign-up, encrypt it at rest with `INSTANCE_CONFIG_KEY` (AES-256-GCM via `encryptInstanceConfig`), and reveal it once on demand.
- **Cons of Branch B:** No out-of-band reset; if the encrypted ciphertext is cleared (after reveal) or lost, the member cannot recover access without an admin re-provisioning the account. Reveal-once means the password is shown exactly once and the stored ciphertext is nulled immediately after decryption.

## Decision

Six coordinated changes implement the architecture, all behind a new `'members.provision'` capability:

### 1. Provider seam + capability

`TaskProvider` (`src/providers/types.ts`) gains an optional `provisionWorkspaceMember?(member, opts?)` returning `{ providerUserId, login, password }`. The `opts.existing*` triplet, when all present, makes the implementation **skip sign-up and sign in** with the stored password instead (cross-group account reuse). `'members.provision'` is added to `TaskCapability` (`src/providers/task-capability.ts`); `KaneoProvider` advertises it via `ALL_CAPABILITIES` (`plugins/task-provider-kaneo/constants.ts`) and implements both `listUsers` (already-written `kaneoListUsers`, which now registers `find_user`) and `provisionWorkspaceMember`.

### 2. `kaneoProvisionMember` operation (invite + accept)

`plugins/task-provider-kaneo/operations/members.ts` runs the three-step flow: `doMemberSignUp` (or `doMemberSignIn` for reuse) → `doInviteMember` (service credential, `{ email, role: 'member', organizationId }`) → `doAcceptInvitation` (member session cookie + `invitationId`). A new `toEmailLocalPart` sanitizer converts arbitrary identifiers — including Matrix/Kontur Talk `@user:server` IDs — into a valid RFC 5321 local-part for the synthetic `…@pap.ai` email. Better Auth responses are validated with Zod (`AuthResponseSchema`/`InviteResponseSchema`), and the session cookie is extracted from `Set-Cookie` with an `__Secure-` prefix when the public URL is HTTPS.

### 3. `kaneo_workspace_members` table (migration 060) + encrypted password

`src/db/migrations/060_kaneo_workspace_members.ts` adds the table keyed by `(group_context_id, chat_user_id, provider_name)` with `status` (`active`|`inactive`|`failed`), `login`, and an `encrypted_password` column. The Drizzle table is `kaneoWorkspaceMembers` (`src/db/schema.ts`). `ensureWorkspaceMember` **upserts** (`onConflictDoUpdate`), so a prior `failed`/`inactive` row is overwritten on re-provision rather than silently ignored; only an `active` row short-circuits to `exists`. On every successful provision the returned `password` is encrypted via `encryptInstanceConfig({ password })` and written to `encrypted_password`.

### 4. `ensureWorkspaceMember` service + `'provisioned'` identity mapping

`src/providers/membership/ensure-member.ts` is the idempotent entry point returning `'created'|'exists'|'skipped'|'failed'`. It resolves the group's provider (bailing `skipped` unless it advertises `members.provision`), resolves a display name via `ChatRouter.resolveUserLabel` with an `@username`/`User <id>` fallback, and — for cross-group reuse — looks up any `kaneo_workspace_members` row across groups with a non-null `encrypted_password`, decrypts it, and passes all three `existing*` opts to the provider. On success it writes a `'provisioned'` identity mapping through `setProvisionedIdentityMapping` (`src/identity/mapping.ts`), which **does not overwrite** an existing `auto` or `manual_nl` link but does overwrite an `unmatched` one. `'provisioned'` is added to `MatchMethod` and `MATCH_METHOD_VALUES` (`src/identity/types.ts`). All failures are caught, logged, and recorded as a `failed` row — never thrown to the caller.

### 5. Three triggers

- **Eager subscriber** (`src/providers/membership/subscriber.ts`): a global event-bus listener calls `ensureWorkspaceMember` on `group_member:added` and `markMemberInactive` on `:removed`, both `p-limit(4)`-bounded and skipping `placeholder-*` user IDs.
- **Startup backfill** (`src/providers/membership/backfill.ts`): a one-shot idempotent pass over `group_members` for Kaneo-assigned groups, fire-and-forget at startup and re-runnable from admin.
- **First-interaction backstop** (`src/llm-orchestrator.ts` + `src/llm-orchestrator-membership.ts`): `shouldBackstopGroupMembership(contextType, actorRole)` gates a fire-and-forget `ensureWorkspaceMember` on the speaker's first group turn. The gate is `contextType === 'group' && actorRole !== 'guest'` — stricter than the plan's `contextType === 'group' && provider !== null`, so guests are excluded by contract (ADR-0213).

### 6. Settings-UI credentials route

`GET/POST /settings/api/kaneo/credentials` (`src/debug/settings/kaneo-credentials-routes.ts`) sits behind the standard settings session + `requireScope` guard (a member only ever sees their own row). `GET` returns `login`, `status`, and `kaneoUrl` (never the password). `POST { action: 'reveal' }` decrypts the stored `encrypted_password`, returns the plaintext **once**, and nulls the ciphertext immediately to enforce reveal-once; a row with no stored password returns `409`. The action is `reveal` (not the spec's `reset`), reflecting that Branch A admin reset is unreachable and the route only surfaces the stored credential. Wired into `src/debug/settings-api-router.ts`; the Svelte `KaneoAccessSection` consumes it.

## Consequences

### Positive

- Every non-guest group member is registered as a real Kaneo user in the group's workspace and linked to their chat identity, so the bot can resolve and assign tasks to them by name.
- `KaneoProvider.listUsers` is now wired, so `find_user` is registered for Kaneo and the LLM can resolve a display name → Kaneo `userId`.
- The provisioning seam is provider-agnostic and capability-gated; YouTrack simply lacks `'members.provision'` and the feature stays inert with no core special-casing.
- Identity integrity is preserved: a `'provisioned'` link never overwrites an `auto` or `manual_nl` mapping a user already established.
- Credentials never touch chat; the password is delivered only through the settings UI and revealed exactly once, with the ciphertext cleared after reveal.
- Cross-group account reuse means one chat person gets one Kaneo account reused across their Kaneo groups (sign-in + invite + accept), rather than a fresh account per group.
- All three triggers are best-effort and bounded; provisioning can never block or drop a turn.

### Negative

- **The invite + accept flow is not idempotent.** If sign-up succeeds but a later invite/accept step fails, a retry creates a second Better Auth account (orphaning the first), and re-inviting a still-pending invitation may error. Resume-by-stored-state is deferred.
- **No out-of-band password reset.** Because `admin/set-password` is unreachable, a lost or already-revealed password cannot be reset without an admin re-provisioning the account. The reveal-once clear means the member gets exactly one chance to store the password securely.
- **`resolveUserLabel` is best-effort.** When the chat platform cannot resolve a label (e.g. Telegram private accounts), the member is provisioned under `@username` or `User <id>`, which is assignable but not human-readable in Kaneo.
- **Guests are excluded entirely.** A guest never receives a workspace account, so they remain unassignable in Kaneo; this is intentional (guest-mode contract) but means guest assignment falls back to the existing `identity_required` graceful path.

### Risks

- **Partial-failure orphans** accumulate in Better Auth when the three-step flow fails mid-sequence; there is no cleanup of the half-created account. Mitigated only by the `failed` row recording and admin re-runs.
- **Cross-group reuse assumes one account per chat person.** A user who first appeared under a `placeholder-*` ID (later rebound) could get a second account if the placeholder was provisioned before rebounding; the eager subscriber skips placeholders, but the backstop uses the rebound ID, so the window is narrow.
- **Encrypted password at rest** depends on `INSTANCE_CONFIG_KEY`; if the key is rotated or lost, all stored member passwords become undecryptable and reveal returns `500`.

## Related Decisions

- ADR-0167: Provider Abstraction Leaks Fix — removed direct `provisionAndConfigure` imports from core; this work extends the same provider-agnostic seam with a new optional method and capability rather than re-introducing a core→Kaneo coupling.
- ADR-0177: Plugin Review Validated Remediation — defined the `autoProvision` hook and the identity-facade `setIdentityMapping` contract that `setProvisionedIdentityMapping` builds on; the no-overwrite rule here mirrors the facade's actor-scoping guarantee.
- ADR-0179: Plugins Deployment Safety — registered `kaneoProvision` through the provider descriptor; `provisionWorkspaceMember` follows the same descriptor-threading pattern.
- ADR-0123: Trusted-Local Plugin System — the plugin activation/contribution model `KaneoProvider` lives under.
- ADR-0124 / ADR-0125: Multi-Provider instance data model + task provider resolver — the `defaultTaskProviderResolver` and `context_settings.task_instance_id` (nullable) that `ensureWorkspaceMember` resolves through.
- ADR-0136 / ADR-0137: Settings Web UI access model + HTTP API — the `requireScope`/CSRF session model the credentials route reuses, and the one-time credential-reveal precedent from provisioning.
- ADR-0213: Guest Mode for Group Chats — the `actorRole !== 'guest'` exclusion the first-interaction backstop enforces.
- ADR-0115: Readable Group and User Labels — `ChatRouter.resolveUserLabel`, the display-name source for provisioning.

## Implementation Notes

Key files confirm the architecture (all present):

- `src/providers/types.ts:140` — `provisionWorkspaceMember?` on `TaskProvider`.
- `src/providers/task-capability.ts:50` — `'members.provision'` in `TaskCapability`.
- `plugins/task-provider-kaneo/operations/members.ts:225` — `kaneoProvisionMember` (invite + accept flow, `toEmailLocalPart` sanitizer, Zod-validated Better Auth responses, `establishMemberSession` helper).
- `plugins/task-provider-kaneo/provider.ts` — `listUsers` + `provisionWorkspaceMember` implementations.
- `plugins/task-provider-kaneo/constants.ts` — `'members.provision'` in `ALL_CAPABILITIES`.
- `src/db/migrations/060_kaneo_workspace_members.ts` — migration 060 creating `kaneo_workspace_members` with the `encrypted_password` column.
- `src/db/schema.ts` — `kaneoWorkspaceMembers` Drizzle table + `KaneoWorkspaceMember` type.
- `src/providers/membership/ensure-member.ts:198` — `ensureWorkspaceMember` (upsert on `onConflictDoUpdate`, `findActiveExistingMemberRow`, `resolveExistingOpts`, `provisionAndPersist`), `markMemberInactive`, `MembershipDeps` with injectable `decryptPassword`.
- `src/providers/membership/subscriber.ts` — `registerMembershipSubscriber` (`group_member:added`/`:removed`, `p-limit(4)`, placeholder skip, runtime type-guarded event data).
- `src/providers/membership/backfill.ts` — `runMembershipBackfill` (idempotent, returns `BackfillResult` counts).
- `src/providers/membership/index.ts` — barrel exports.
- `src/identity/types.ts:7` — `'provisioned'` added to `MatchMethod` and `MATCH_METHOD_VALUES`.
- `src/identity/mapping.ts:124` — `setProvisionedIdentityMapping` (no-overwrite guard for `auto`/`manual_nl`).
- `src/llm-orchestrator-membership.ts` — `shouldBackstopGroupMembership` (guest exclusion gate).
- `src/llm-orchestrator.ts:55` — `maybeEnsureGroupMembership` backstop, gated by the helper at the group turn path.
- `src/debug/settings/kaneo-credentials-routes.ts` — `GET`/`POST` (action `'reveal'`, reveal-once ciphertext clear, `decryptStoredPassword`/`clearStoredPassword` helpers).
- `src/debug/settings-api-router.ts` — routes `/settings/api/kaneo/credentials`.
- `src/index.ts` — registers the subscriber and fires startup backfill after `ChatRouter` construction, threading `resolveUserLabel` through `membershipDeps`.

Divergences from the plan, all refinements: `writeMemberRow` uses `onConflictDoUpdate` (upsert) rather than `onConflictDoNothing`, so `failed`/`inactive` rows are re-provisioned instead of short-circuiting; the backstop was extracted into `src/llm-orchestrator-membership.ts` and adds `actorRole !== 'guest'` gating the plan lacked; `MembershipDeps.getContextSettings` returns `taskInstanceId: string | null` (per migration 062) rather than the plan's non-null `string`; the credentials `POST` action is `'reveal'` rather than `'reset'`; and `kaneoProvisionMember` gained `toEmailLocalPart` and Zod response validation the plan's inline version omitted.
