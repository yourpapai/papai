<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0233: Release Announcement Subscriptions

## Status

Implemented (with divergence)

## Date

2026-06-26

## Context

`announceNewVersion` (`src/announcements.ts`) historically read `CHANGELOG.md` at startup, extracted the current `## [version]` section as **raw markdown**, and DM'd it to **only** `ADMIN_USER_ID` — no processing, no opt-in, no fan-out. The design (`docs/superpowers/specs/2026-06-26-announcement-subscriptions-design.md`) and plan (`docs/superpowers/plans/2026-06-26-release-announcement-subscriptions.md`) wanted to change four things:

1. A DM user, or a group admin, can **opt in** to receive new-version announcements (default **off**).
2. The raw changelog is **humanized once** by the central/global LLM (never BYOK) into a clear, user-facing summary grouped into **✨ New / 🛠 Fixes**, dropping internal churn.
3. That single humanized output is stored and **reused** for every recipient — never re-generated per subscriber.
4. The bot admin **reviews, edits/regenerates, and triggers** the broadcast from a new settings-UI admin **Release notes** section — startup does **not** fan out automatically.

The naming is deliberate: the new feature is "**Release notes** / **Release announcements**", kept **distinct** from the pre-existing admin **Announce** section (`AdminAnnounceSection.svelte` → `POST /settings/api/admin/announce` → `broadcastMessage`), which is a manual free-text broadcast to **all** users with no opt-in and no group support.

The data model mirrors the `guest_mode` precedent: subscription is a dedicated boolean column on `users` (DM, self opt-in) and `authorized_groups` (group, group-admin opt-in), not a `user_config` KV key — clean, indexed fan-out enumeration that records context type directly. The `version_announcements` table gains `raw_body`/`humanized_body`/`broadcast_at`; a new `announcement_deliveries` table `(version, context_id, context_type, status, delivered_at)` powers per-recipient idempotency.

## Decision Drivers

- **Admin-gated broadcast, never auto fan-out.** Startup humanizes + persists + DMs the admin a *review* notice; subscribers never receive anything until the admin clicks **Broadcast**.
- **Humanize exactly once, reuse everywhere.** The central LLM is the single source of the announcement body; one `generateText` call is persisted and delivered to every opt-in recipient.
- **Central/global LLM only, never BYOK.** `humanizeChangelog` uses the operator's main model so quality is predictable and no per-context key is consumed.
- **Opt-in storage mirrors `guest_mode`.** A dedicated boolean column on `users` / `authorized_groups` (default off) gives clean indexed fan-out enumeration, vs. a `user_config` KV key.
- **Idempotent, failure-isolated fan-out.** `p-limit` bounded concurrency; per-recipient `announcement_deliveries` dedup so a re-broadcast retries only the undelivered; a blocked user, inactive instance, or send failure is recorded `failed` and never aborts the batch.
- **Separate admin *Release notes* from *Announce*.** The opt-in subscription broadcast coexists with — and is not merged into — the pre-existing free-text broadcast-to-all.
- **DI-first tests, `guest_mode` route pattern.** Server routes mirror the guest-mode toggle shape (personal authenticated-session scope + group-admin scope); components reuse the shared `Btn`/`PageHeader` primitives.

## Considered Options

### Option 1 — Admin-review-then-broadcast; dedicated boolean columns; central-LLM one-shot humanize; per-recipient idempotent fan-out (chosen)

Two new settings sections: an admin **Release notes** section (`GET/POST /settings/api/admin/release-notes`) to review/regenerate/save/broadcast, and a personal+group **Release announcements** toggle section (`GET/PATCH /settings/api/release-subscription`, `/settings/api/group/release-subscription`). Subscription on `users.announce_subscribed` + `authorized_groups.announce_subscribed`; humanized draft on `version_announcements`; idempotency via `announcement_deliveries`.

- **Pros:** clean separation from the free-text Announce; central-LLM reuse avoids per-recipient cost/variability; boolean columns give simple indexed enumeration; idempotent fan-out survives retries and partial failures; admin gate prevents an embarrassing/uncurated release note from reaching everyone.
- **Cons:** two-phase (startup draft → admin broadcast) means a subscriber can wait arbitrarily long after a release; needs a migration + four new route/UI surfaces; the humanized body can drift from the raw changelog if edited by the admin.

### Option 2 — Auto fan-out to subscribers at startup

Skip the admin review; on new-version detection, humanize once and deliver immediately to all opt-in subscribers.

- **Pros:** lower latency; no admin action needed; smaller surface (no admin Release notes section).
- **Cons:** rejects the headline driver — an uncurated/LLM-garbled release note would reach every subscriber with no chance to edit/regenerate; loses the review gate the operator specifically wanted.

### Option 3 — Subscription as a `user_config` KV key

Store opt-in in the existing per-user/per-group config KV instead of a dedicated column.

- **Pros:** no migration; reuses existing config plumbing.
- **Cons:** rejected in the design — fan-out enumeration over a KV blob is neither clean nor indexable; the `guest_mode`/`open_dm_access` precedent uses dedicated columns exactly because broadcast enumeration needs typed, queryable rows.

## Decision

The chosen Option 1 shipped in full across migration, store, humanizer, broadcast, the startup change, four route modules, and three client sections. The feature is documented live in `docs/architecture/behaviors.md:28`. What shipped:

1. **Migration 063 + schema.** `063_release_announcements.ts` adds `users.announce_subscribed`, `authorized_groups.announce_subscribed`, `version_announcements.{raw_body,humanized_body,broadcast_at}`, and the `announcement_deliveries` table. The Drizzle schema is factored into `src/db/announcement-schema.ts` and re-exported from `src/db/schema.ts`.
2. **Store (`src/announcements/store.ts`).** Subscription getters/setters, draft upsert/read, humanized-body update, broadcast mark, delivery record/isDelivered, subscriber enumeration/counts. `listSubscribedUsers()` excludes blocked + `placeholder-*` rows.
3. **Humanizer (`src/announcements/humanize.ts`).** `humanizeChangelog(raw, deps?)` calls the central admin LLM once with the ✨ New / 🛠 Fixes system prompt; returns `null` on LLM-unconfigured/failure/whitespace so the caller falls back to raw.
4. **Broadcast (`src/announcements/broadcast.ts`).** `broadcastAnnouncement(chat, version, body, deps?)` enumerates subscribed users + groups, fans out with `p-limit(5)`, records per-recipient delivery, and returns `{sent, failed, skipped}`.
5. **Startup (`src/announcements.ts`).** `announceNewVersion` humanizes once, persists the draft, and DMs the admin a *review* notice — **no fan-out**.
6. **Routes.** Admin release-notes (`GET/POST`, discriminated `regenerate`/`save`/`broadcast`); personal release-subscription (`GET/PATCH`); group release-subscription handlers in `group-routes.ts`.
7. **Client.** `AdminReleaseNotesSection.svelte` (admin zone), `ReleaseSubscriptionSection.svelte` (personal + group), fetchers in `release-fetchers.ts` + `admin-fetchers.ts`, response schemas in `fetcher-schemas-release.ts`.

## Consequences

### Positive

- A subscriber (DM or group) receives a single curated, humanized release note per version, only after the admin has reviewed and broadcast it — never raw changelog, never unsolicited.
- The changelog is humanized **once** regardless of subscriber count, keeping LLM cost and variance flat.
- Fan-out is idempotent and failure-isolated: a re-broadcast retries only the undelivered; one bad recipient never aborts the batch; the admin sees exact sent/failed/skipped counts.
- Opt-in is a clean typed column mirroring `guest_mode`, giving indexed enumeration and per-context-type delivery records.
- The feature is cleanly separated from the free-text Announce section, and the two coexist without ambiguity.
- LLM-down-at-startup degrades gracefully: the raw body is stored and the admin can **Regenerate** later once central creds exist.

### Negative

- **Two-phase latency.** A subscriber can wait arbitrarily long between a release and the admin clicking Broadcast; there is no reminder/scheduling.
- **Humanized body can drift from raw.** The admin can edit the draft, so the delivered text is no longer a faithful transform of the changelog (by design, but unreviewable after the fact without the `raw_body`).
- **The codebase has evolved well beyond the plan.** The central-LLM resolver was refactored, the schema was extracted, and several fixes-doc-driven robustness changes (race-safe persist, native-context-id group routing, conditional delivery status) layered on top — see Implementation Notes.

### Risks

- **Group broadcast routing depends on the scoped→native id decode.** A malformed scoped group id would yield an invalid native channel id and fail per-recipient (now counted `failed`, not fatal) — fixed defensively by `groupTarget` + the Mattermost decode, but the dependency remains.
- **`version_announcements` dedup vs. the pre-LLM anchor.** The dedup anchor is now persisted before the LLM call; a crash between the anchor write and `updateHumanizedBody` leaves a `humanizedBody = null` row that the admin must Regenerate — recoverable, not silent.
- **Subscription broadcast is operator-cost.** The operator's central LLM pays for humanization and the chat platforms for delivery; a large subscriber base with frequent releases is an operator load with no rate limiting.

## Related Decisions

- **ADR-0229: Admin Dashboard Deduplication** — sibling `2026-06-26` settings/admin-area cleanup that landed alongside this feature's admin section.
- **ADR-0226: Backstage Phase 3.3 — Settings/Admin Sections Cleanup** — the settings-section conventions (shared `Btn`/`PageHeader`/`ErrorState`, sidebar items, admin guard) this feature's sections follow.
- The `guest_mode` / `open_dm_access` column-and-toggle precedent (group-admin scope, dedicated boolean column) that the subscription storage and group route mirror.
- A later **`docs/superpowers/specs/2026-07-03-release-subscription-fixes-design.md`** UX-fixes doc (not this plan's design) drove the `ReleaseSubscriptionSection` state-machine rewrite and the shared `Btn` `busy`/focus-ring additions layered on top of this feature.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; the core commit messages match the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `src/db/migrations/063_release_announcements.ts:26-58` | Adds `announce_subscribed` columns + `version_announcements` body cols + `announcement_deliveries` table; `columnExists`/`tableExists` idempotency guards. | `read` confirms. |
| `src/db/index.ts:76,182` | Migration 063 imported + registered in `MIGRATIONS`. | `grep` confirms. |
| `src/db/announcement-schema.ts:8-28` | `versionAnnouncements` (+`rawBody`/`humanizedBody`/`broadcastAt`) and `announcementDeliveries` (composite PK), re-exported from `schema.ts:83`. | `read` confirms. |
| `src/db/schema.ts:25,109` | `users.announceSubscribed` + `authorizedGroups.announceSubscribed` boolean columns (default false). | `grep` confirms. |
| `src/announcements/store.ts:24-163` | Subscription getters/setters, draft upsert, humanized update, broadcast mark, delivery record/isDelivered, subscriber enumeration/counts. | `read` confirms. |
| `src/announcements/humanize.ts:32-67` | `humanizeChangelog` central-LLM one-shot with ✨ New / 🛠 Fixes prompt; `null` fallback. | `read` confirms. |
| `src/announcements/broadcast.ts:53-137` | `groupTarget` (native-id decode) + `broadcastAnnouncement` `p-limit(5)` fan-out, per-recipient dedup, failure isolation, `{sent,failed,skipped}`. | `read` confirms. |
| `src/announcements.ts:89-119` | `announceNewVersion` persists dedup anchor, humanizes, DMs admin a review notice — **no fan-out**. | `read` confirms. |
| `src/debug/settings/admin/release-notes-routes.ts:24-106` | Admin `GET/POST` discriminated `regenerate`/`save`/`broadcast`; 405/422; admin guard + CSRF. | `read` confirms. |
| `src/debug/settings/release-subscription-routes.ts:17-45` | Personal `GET/PATCH` release-subscription; authorized check + CSRF; **reads back** persisted value. | `read` confirms. |
| `src/debug/settings/group-routes.ts:9,124,137,251` | Group `GET/PATCH /settings/api/group/release-subscription` via `getGroupAnnounceSubscribed`/`setGroupAnnounceSubscribed`. | `grep` confirms. |
| `src/debug/settings-api-router.ts:15,32,66,110` | Both route modules registered. | `grep` confirms. |
| `client/settings/release-fetchers.ts:14-26` | Personal + group release-subscription fetchers (extracted module). | `read` confirms. |
| `client/settings/admin-fetchers.ts:208-221` | `fetchReleaseNotes`/`regenerateReleaseNotes`/`saveReleaseNotes`/`broadcastReleaseNotes`. | `grep` confirms. |
| `client/settings/sections/admin/AdminReleaseNotesSection.svelte:102-159` | Admin section: review/edit/regenerate/broadcast with confirm + result. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:69-107` | Subscription toggle (personal + group) — rewritten to the loadError/actionError state machine. | `read` confirms. |
| `client/settings/SettingsApp.svelte:34,45,218,224,270` | Both sections mounted (personal + group + admin zones). | `grep` confirms. |
| `docs/architecture/behaviors.md:28` | Live behavior doc: humanize-once, admin-review-then-broadcast, opt-in columns, idempotent fan-out, distinct-from-Announce. | `grep` confirms. |
| commits `7c944e3aa`, `606d80063`, `715ebd315` | Migration / store / startup commit messages match the plan verbatim. | `git log -S` confirms. |
| commit `55dded719` | `fix(announcements): decode scoped group id to native channel id for broadcast` (Mattermost 403 fix). | `git log -S` confirms. |

Plan-vs-implementation notes:

- **The Drizzle schema was extracted to its own file.** The plan edited `versionAnnouncements`/`announcementDeliveries` inline in `src/db/schema.ts`; the shipped tree moves them to a new `src/db/announcement-schema.ts` and re-exports from `schema.ts:83`. `users.announceSubscribed`/`authorizedGroups.announceSubscribed` remain inline in `schema.ts`. Intent unchanged.
- **The central-LLM resolver was renamed/refactored after this plan.** The plan exported `resolveGlobalConfig` from `src/llm-config-resolver.ts`; `humanize.ts` now resolves config via `resolveAdminLlmConfig` from `src/llm-providers/resolver.js` (`LlmConfigResult`, `config.main.apiKey/baseUrl/model`). `resolveGlobalConfig` no longer exists in `src/` — a later multi-LLM-providers refactor superseded it; the humanizer still uses the central/admin model exactly as the design intended.
- **The dedup anchor is persisted BEFORE the LLM call (race-safety fix).** The plan persisted the draft after humanization (`persistDraft({ rawBody, humanizedBody: humanized })`). The shipped `announceNewVersion` (`announcements.ts:108-110`) writes the anchor with `humanizedBody: null` first, then humanizes, then `updateHumanizedBody` on success — so a rolling restart cannot pass the dedup check and trigger a duplicate LLM call or duplicate admin DM. This added `updateHumanizedBody` to `AnnouncementsDeps` (the plan's deps had only `persistDraft`).
- **`updateHumanizedBody` and `setUserAnnounceSubscribed` are upserts, not plain UPDATEs.** Plan used bare updates; shipped upserts (`store.ts:33-45,119-126`). `setUserAnnounceSubscribed` upserts because operators authorized via the admin store may have no `users` row (a bare UPDATE would silently no-op and drop the subscription); `updateHumanizedBody` upserts to survive the anchor-first persist when no row was seeded.
- **`recordDelivery` won't downgrade a `sent` to `failed`.** The plan's upsert always overwrote status; shipped adds `setWhere: ne(status, 'sent')` (`store.ts:150`) so a later retry cannot mark an already-delivered recipient as failed.
- **`groupTarget` decodes the scoped group id to the native channel id (Mattermost fix).** The plan's `groupTarget` used `contextId: groupId` (the scoped config-context id). Adapters use `contextId` verbatim as the send target, so passing the scoped id made Mattermost POST to an invalid channel and 403. Shipped (`broadcast.ts:53-65`) sets `contextId: getNativeContextId(groupId)` and keeps the scoped id as `storageContextId` (commit `55dded719`).
- **Proactive history recording was added.** Both the admin review DM (`announcements.ts:68`) and every broadcast send (`broadcast.ts:76,81`) now call `recordProactiveInHistory` so the messages appear in the proactive history. Not in the plan; surfaced a test-only `defaultBroadcastDepsForTest` handle (`broadcast.ts:88`, re-exported by `broadcast.testing.ts`).
- **The personal PATCH reads the persisted value back.** The plan echoed `body.data.enabled`; shipped re-reads via `getUserAnnounceSubscribed` before responding (`release-subscription-routes.ts:34`) so the response reflects actual stored state.
- **Client subscription fetchers were extracted to a dedicated module.** The plan added them to `client/settings/fetchers.ts`; shipped created `client/settings/release-fetchers.ts` (+ `fetcher-schemas-release.ts` for the response types) and the admin section imports its types from `fetcher-schemas-release.js`.
- **`ReleaseSubscriptionSection` was rewritten by a later fixes doc.** The plan's simple single-`error` component was replaced by the loadError/actionError state machine (`ErrorState` + retry on load failure, `Loading…` placeholder, `Btn` `busy` label swap, `role="alert"` mutation error) driven by `2026-07-03-release-subscription-fixes-design.md` — a separate, later UX-fixes design, not archived here.
- **`AdminReleaseNotesSection` gained broadcast robustness.** Beyond the plan, it auto-saves an edited body before broadcasting, tracks a `broadcasting`/`broadcastError` state inside the confirm dialog, shows a `Loading…` placeholder, and color-codes the result by `failed` count.
- **The migration gained a FK + a `tableExists` guard.** The plan's `CREATE TABLE` had no foreign key; shipped adds `REFERENCES version_announcements(version)` and a `tableExists` re-entry guard plus a `changed` log flag (`063_release_announcements.ts:19-21,46-58`).

The source plan `docs/superpowers/plans/2026-06-26-release-announcement-subscriptions.md` and design `docs/superpowers/specs/2026-06-26-announcement-subscriptions-design.md` are archived alongside this ADR to `docs/archive/`.
