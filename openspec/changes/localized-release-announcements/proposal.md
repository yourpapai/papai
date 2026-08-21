# localized-release-announcements

## Goal

Release-announcement bodies are humanized once, in English only, and that single text is broadcast to every opt-in subscriber (issue #323). Users/groups whose `language` setting is `ru` receive an English announcement, which looks awkward. Make the pipeline locale-aware: generate one humanized body per supported locale (`en`, `ru` — `SUPPORTED_LOCALES`), store them per locale, and deliver each subscriber (DM user or group) the body matching their config-context `language`, falling back to English.

## Capabilities

- `release-announcements` — new requirements: per-locale humanized bodies, per-recipient localized delivery, per-locale admin review/edit/regenerate.

## Current flow (what changes)

1. Startup `announceNewVersion` (`src/announcements.ts`): extract changelog section → persist draft → `humanizeChangelog` once (English-only prompts in `src/announcements/humanize.ts`) → single `humanized_body` → DM admin a notice whose wrapper text is localized but whose body is always English.
2. Admin review/edit/regenerate/broadcast in Settings → Release notes (`src/debug/settings/admin/release-notes-routes.ts`) over the single `humanized_body`.
3. `broadcastAnnouncement` (`src/announcements/broadcast.ts`) fans the single body out to all opt-in subscribers.

## Design

1. **Locale-aware humanizer** (`src/announcements/humanize.ts`)
   - New signature: `humanizeChangelog(rawSection, locales: readonly Locale[], deps?) => Promise<Partial<Record<Locale, string>>>`.
   - The classify pass runs **once** (language-independent); the write pass runs once per requested locale, in parallel, with a per-locale system prompt from an exhaustive `Record<Locale, string>` prompt table: `en` keeps "✨ New / ⚡ Improvements / 🛠 Fixes"; `ru` outputs Russian with «✨ Новое / ⚡ Улучшения / 🛠 Исправления» headers. Adding a locale later forces authoring its prompt (type error otherwise).
   - Zero surviving entries → localized behind-the-scenes one-liner via new i18n key `announcements.emptyReleaseNote` (replaces the `EMPTY_RELEASE_NOTE` English constant). Central LLM unconfigured → `{}` (callers fall back to raw body, as today's `null` did). A failed write pass for one locale is omitted (warn log) without killing other locales.
2. **Storage** (`src/db/announcement-schema.ts`, `src/announcements/store.ts`, new migration)
   - Add `version_announcements.localized_bodies TEXT` — JSON map of non-`en` bodies, e.g. `{"ru": "…"}` — via migration `src/db/migrations/080_localized_announcement_bodies.ts` (next free number; `columnExists` guard pattern from 063), registered in `src/db/index.ts`.
   - `humanized_body` keeps its meaning as the authoritative English/default body — no data migration.
   - Store: `updateLocalizedBodies(version, bodies)` (upsert JSON) and `getAnnouncementDraft` returns parsed `localizedBodies`.
   - Universal resolution chain: `localized[locale] → humanized_body (en) → raw_body`.
3. **Startup flow** (`src/announcements.ts`)
   - `AnnouncementsDeps.humanizeChangelog` type changes to `(rawSection, locales) => Promise<Partial<Record<Locale, string>>>`; add `updateLocalizedBodies` dep.
   - Generate for **all** `SUPPORTED_LOCALES` (deterministic; subscribers may change between draft and broadcast). Persist `en` via `updateHumanizedBody`, non-`en` via `updateLocalizedBodies`.
   - Admin review-notice body: pick the body for `getContextLanguage(adminConfigContextId)` with en/raw fallback; wrapper stays `t('announcements.adminNotice', …)`.
4. **Broadcast** (`src/announcements/broadcast.ts`)
   - Takes `bodies: Partial<Record<Locale, string>>` plus `fallback: string | null` (raw) instead of a single `body`.
   - New dep `resolveLanguage: (configContextId) => Locale` (default `getContextLanguage`). DM locale: `toScopedContextId({ platformInstanceId, nativeContextId: platformUserId })`; group locale: `g.groupId` (already the scoped config-context id).
   - Per recipient: body = `bodies[locale] ?? bodies.en ?? fallback`; if none exists, record a `failed` delivery (keeps idempotency table intact).
5. **Settings API** (`src/debug/settings/admin/release-notes-routes.ts`)
   - GET → `{ version, bodies: { en: string|null, ru: string|null }, broadcastAt, counts }` (null = not generated).
   - `save` → `{ action: 'save', locale, body }` per locale: `en` → `updateHumanizedBody`; non-`en` → merge into `localized_bodies`.
   - `regenerate` → `{ action: 'regenerate', locale? }`: single locale re-runs `humanizeChangelog(raw, [locale])` (re-classifying is fine); omitted → regenerate all supported locales.
   - `broadcast` request shape unchanged; server builds `bodies` + raw fallback from the draft; "nothing to broadcast" guard becomes: no en body AND no localized body AND no raw.
6. **Settings UI** (`client/settings/…`)
   - `fetcher-schemas-release.ts`: `ReleaseNotesResponseSchema` gains `bodies: { en, ru }` (replaces `body`).
   - `admin-fetchers.ts`: `saveReleaseNotes(locale, body)`, `regenerateReleaseNotes(locale?)`.
   - `AdminReleaseNotesSection.svelte`: EN/RU tab switcher with one textarea state per locale; save/regenerate act on the active tab; caption notes "falls back to English" when a locale body is null; broadcast still saves edited bodies first, then broadcasts.
   - MSW fixtures `client/stories/msw/settings-handlers-admin-2.ts` updated to the new response shape.
7. **Docs** — update the `<!-- behavior:release-announcements -->` block in `docs/architecture/behaviors.md` (per-locale generation, per-recipient localized delivery, per-locale review).

## Out of scope

The manual admin **Announce** section (`/settings/api/admin/announce`) — free-text broadcast, no language handling; translation beyond `SUPPORTED_LOCALES`; adding new locales.

## Files to touch

Backend: `src/announcements/humanize.ts`, `src/announcements.ts`, `src/announcements/store.ts`, `src/announcements/broadcast.ts`, `src/db/announcement-schema.ts`, `src/db/migrations/080_localized_announcement_bodies.ts` (new), `src/db/index.ts`, `src/i18n/types.ts`, `src/i18n/locales/en.ts`, `src/i18n/locales/ru.ts`, `src/debug/settings/admin/release-notes-routes.ts`.
Client: `client/settings/fetcher-schemas-release.ts`, `client/settings/admin-fetchers.ts`, `client/settings/sections/admin/AdminReleaseNotesSection.svelte`, `client/stories/msw/settings-handlers-admin-2.ts`.
Tests: `tests/announcements/humanize.test.ts`, `tests/announcements.test.ts`, `tests/announcements/announce-new-version.test.ts`, the announcement-broadcast suite, `tests/db/announcement-schema.test.ts`, new `tests/db/migrations/080_*` test (pattern of the 063 test), `tests/debug/settings/admin/release-notes-routes.test.ts`, `tests/client/settings/admin-release-notes-section.test.ts`, `tests/stories/settings/announcement-delivery.story.test.ts` (add a ru-recipient assertion).
Docs: `docs/architecture/behaviors.md`.

## Verification

- Unit (DI-first, Bun): humanizer dispatches per-locale prompts, classifies once, localizes the empty note, isolates per-locale failure; `announceNewVersion` persists per-locale bodies and localizes the admin notice by admin language (with en fallback); broadcast resolves per-user and per-group language with en→raw fallback; store roundtrip for `localized_bodies`; migration 080 adds the column idempotently; release-notes routes save/regenerate/broadcast per locale; client section test covers tabs, per-locale save, broadcast flow.
- The existing i18n ru key-parity test automatically enforces `announcements.emptyReleaseNote` in both dictionaries.
- Full `bun run test` green (CI-serial equivalent), `bun check:full` (lint, typecheck, knip, format) green; `test:mutate:changed` gate satisfied for touched files (baseline per policy).

## Assumptions

- Per-locale generation always runs for both supported locales at draft time (one extra LLM write call per release) rather than computing the subscriber locale set — subscriber sets change between startup draft and admin broadcast.
- `humanized_body` remains the English/default body so existing rows and the fallback chain stay valid without data migration.
