<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Opt-in Version Announcement Subscriptions — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan

## Problem

Today, when a new version is detected at startup, `announceNewVersion`
(`src/announcements.ts`) reads `CHANGELOG.md`, extracts the current
`## [version]` section as **raw markdown**, and DMs it to **only**
`ADMIN_USER_ID`. Deduplication is per-version via the `version_announcements`
table (`version` PK).

We want:

1. A DM user, or a group admin, can **opt in** to receive new-version
   announcements (default **off**).
2. The raw changelog is **processed by the central/global LLM exactly once**
   into a clear, human-readable summary focused on the important changes
   (features / fixes).
3. That single humanized output is reused to deliver to every subscribed DM
   and group — not re-generated per recipient.
4. The bot admin **reviews and triggers** the broadcast (it is not automatic).

## Decisions (settled)

- **Trigger model:** Admin approves, then broadcast. Startup never fans out
  automatically.
- **Approval UX:** A new settings-UI **admin** _Announcements_ section where the
  admin reviews, can regenerate or edit the draft, and clicks **Broadcast**.
- **LLM:** Central/global credentials only (`resolveGlobalConfig`), **not**
  per-context BYOK. Use `main_model` for quality. Processed once, stored,
  reused for every recipient.
- **Opt-in scope:** A DM user opts _themselves_ in (authenticated settings
  session); a _group admin_ opts the _group_ in (group-shared, group-admin
  scope). Default off for both.
- **Subscription storage:** Dedicated boolean columns (mirrors `guest_mode` /
  `open_dm_access`), not a `user_config` KV key — clean, indexed fan-out
  enumeration that records context type directly.
- **One shared message** for everyone; no per-recipient personalization.

## Architecture

```
startup → announceNewVersion(version)
  ├─ already in version_announcements? → skip
  ├─ extract raw "## [version]" section (existing extractChangelogSection)
  ├─ humanizeChangelog(raw) via resolveGlobalConfig → buildChatModel(main_model)
  │     → generateText                                        [ONCE]
  ├─ persist {version, raw_body, humanized_body, broadcast_at = null}
  └─ DM admin: "vX.Y.Z ready to announce — review & broadcast" + settings link
        (NO automatic fan-out)

admin opens Settings → Announcements (admin-scoped)
  ├─ GET draft + subscriber counts
  ├─ Regenerate (re-run LLM)  /  Save (edit text)
  └─ Broadcast → broadcastAnnouncement(version)
        ├─ enumerate subscribed users + subscribed groups
        ├─ p-limit fan-out via chat.sendMessage / sendProactiveMessage
        ├─ record per-recipient delivery (idempotent)
        └─ mark broadcast_at; return {sent, failed, skipped}
```

## Data model (migration)

- `users.announce_subscribed` — boolean, default `false` (DM opt-in). `users`
  already carries `platform_instance_id` for routing.
- `authorized_groups.announce_subscribed` — boolean, default `false` (group
  opt-in; group-shared, mirrors `guest_mode`).
- Extend `version_announcements`: add `raw_body TEXT NULL`,
  `humanized_body TEXT NULL`, `broadcast_at TEXT NULL`. Keeps the existing
  `version` PK + `announced_at` admin-dedup behavior.
- New `announcement_deliveries` table — `(version, context_id, context_type,
status, delivered_at)`, PK `(version, context_id)`. Enables idempotent
  broadcast (skip already-delivered on re-click / retry) and a delivery report.

**To verify during implementation:** `guest_mode` / `open_dm_access` are not in
the scoped-context-owned-columns registry, so `announce_subscribed` likely needs
no `ENTITY_SCOPES` entry. Confirm against the consistency test
(`src/chat/context-scope.ts`).

## Modules

- **`src/announcements/humanize.ts`** — `humanizeChangelog(raw, deps): Promise<string | null>`.
  Central LLM only (`resolveGlobalConfig` → `buildChatModel(mainModel)` →
  `generateText`), DI-friendly. System prompt: produce a clear, friendly,
  **user-facing** summary grouped into **✨ New / 🛠 Fixes**, drop internal /
  dev-only churn (build, test, refactor, chore), no commit hashes. On
  LLM-unconfigured / failure → return `null`; caller stores raw as fallback so
  the admin can Regenerate later.
- **`src/announcements.ts`** (changed) — `announceNewVersion` humanizes +
  persists + sends the admin a _review_ notice with the settings link, instead
  of fanning out. No auto-broadcast.
- **`src/announcements/broadcast.ts`** — `broadcastAnnouncement(version, deps)`:
  enumerate `listSubscribedUsers()` / `listSubscribedGroups()`, `p-limit`
  fan-out, per-recipient dedup via `announcement_deliveries`, failure-isolated,
  returns summary counts. Sets `broadcast_at` when complete.
- **`src/announcements/store.ts`** — getters / setters: draft read / update,
  subscription read / write helpers, delivery records.

## Settings UI + routes

- **Admin section** `client/settings/sections/AnnouncementsAdminSection.svelte`
  — shows latest pending version, editable humanized draft (textarea),
  **Regenerate** / **Save** / **Broadcast** (broadcast confirms first, shows
  subscriber count + last result).
  - `GET /settings/api/admin/announcements` →
    `{version, body, broadcastAt, counts: {dm, group}}` (admin scope).
  - `POST /settings/api/admin/announcements` → discriminated
    `{action:'regenerate'} | {action:'save', body} | {action:'broadcast'}`
    (admin scope + CSRF; strict schemas → 422 on ambiguity; `GET`-only siblings
    405, following the BYOK admin precedent).
- **Subscription toggles** (reuse the guest-mode route shape):
  - DM: personal-scope toggle (authenticated session) →
    `PATCH /settings/api/announce-subscription`.
  - Group: group-admin-scope toggle →
    `PATCH /settings/api/group/announce-subscription`.

## Behavior & edge cases

- **No backfill:** subscribing after a version was broadcast does _not_
  retroactively deliver it — only future versions. Stated plainly in the UI.
- **Idempotent broadcast:** double-click / retry skips already-delivered
  recipients; `broadcast_at` guards version-level completion. Re-broadcast
  retries only `failed`/undelivered recipients.
- **Failure isolation:** a blocked user, inactive instance, or send failure is
  recorded as `failed` and never aborts the batch; the admin sees the count.
- **LLM down at startup:** store raw as fallback, admin still notified;
  Regenerate becomes available once central creds exist.
- **Groups:** delivered to the group's main context (`threadId: null`), no
  `@mention`.
- **Enumeration filters:** subscribed users exclude `placeholder-*` and
  `blocked_at` rows (as `broadcastMessage` already does); subscribed groups come
  from `authorized_groups`, platform instance resolved via
  `resolveDeliveryPlatformInstanceId` (groups) / `users.platform_instance_id`
  (DMs).

## Testing

DI-first, per repo conventions:

- `humanizeChangelog`: prompt shape + `null` fallback on LLM failure.
- `broadcastAnnouncement`: enumeration, `p-limit` concurrency, per-recipient
  idempotency, failure isolation, summary counts.
- Admin route: scope enforcement + CSRF + action discrimination + 405/422.
- Subscription toggles: personal vs group-admin scope, default off.
- Migration: column/table creation, defaults.
- Changed startup path: admin notified, **no** auto-fanout, version dedup
  intact.

## Out of scope (YAGNI)

- Chat-command broadcast trigger (`/announce`) — settings-UI only.
- Per-recipient personalized announcement text.
- Backfilling missed announcements to new subscribers.
- Scheduling / delayed broadcast.

```

```
