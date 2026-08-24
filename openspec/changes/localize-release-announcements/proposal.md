# Localize release announcements per subscriber language

## Goal

Fix issue #334: version release announcements are generated once in English and broadcast as a single body, which is awkward for users whose `language` setting is `ru`. The announcement body a recipient receives must match their per-config-context language setting (`en`|`ru`, default `en`), resolved via the existing `getContextLanguage()` (`src/utils/config-language.ts`).

## Current behavior (why it's English-only)

1. Startup: `announceNewVersion` (`src/announcements.ts`) extracts the changelog section, calls `humanizeChangelog` (`src/announcements/humanize.ts`) — two-pass classify+write with an **English-only** `SYSTEM_PROMPT` — and stores one `humanized_body` TEXT column on `version_announcements` (`src/db/announcement-schema.ts`, migration 063). The admin DM wrapper (`announcements.adminNotice`) is already localized; the body is not.
2. Admin reviews/edits/regenerates the **single** body in Settings → Release notes (`src/debug/settings/admin/release-notes-routes.ts`, `client/settings/sections/admin/AdminReleaseNotesSection.svelte`, `client/settings/admin-fetchers.ts`).
3. Broadcast (`src/announcements/broadcast.ts`) fans the **same** string to all opt-in subscribers (DMs + groups).

## Intended behavior change

- **Per-locale humanization**: the classify pass stays language-neutral and runs once; the write pass runs once per supported locale (`SUPPORTED_LOCALES`, currently en/ru) with a locale-targeted system prompt (output language + localized section headers). The empty-release one-liner gets localized too (add `announcements.emptyReleaseNote` to `src/i18n/locales/en.ts`, `ru.ts`, `src/i18n/types.ts`). A per-locale generation failure is isolated: that locale falls back to the `en` body (warn log), never blocks the other locale.
- **Per-locale storage**: store one body per locale on the announcement row (e.g. a `humanized_bodies` JSON column added by a new migration `064_*`, registered in `src/db/index.ts`). Keep graceful reads: a row with only the legacy `humanized_body` is treated as the `en` body; no backfill of historical rows.
- **Per-recipient delivery**: `broadcastAnnouncement` resolves each recipient's locale and sends the matching body — DM recipients via `getContextLanguage(toScopedContextId({ platformInstanceId, nativeContextId: userId }))`, groups via `getContextLanguage(groupId)` — with fallback chain locale-body → en-body → raw body. Per-recipient idempotency (`announcement_deliveries`) and failure isolation are unchanged.
- **Admin notice**: the startup DM to the admin uses the body for the admin's own locale (fallback en).
- **Admin UI**: the Release notes section shows and edits one body per locale (save/regenerate accept a locale; broadcast unchanged). Stated assumption: per-locale admin editing is in scope because the admin UI is the review gate for what gets broadcast; without it the admin could only fix the en text.

## Files to touch

- `src/announcements/humanize.ts` — per-locale write pass, localized empty note, deps shape.
- `src/announcements/store.ts` — read/write per-locale bodies.
- `src/db/announcement-schema.ts` + new `src/db/migrations/064_*.ts` + `src/db/index.ts` — per-locale column.
- `src/announcements.ts` — humanize both locales, persist, admin-locale notice body.
- `src/announcements/broadcast.ts` — per-recipient locale resolution + body selection.
- `src/debug/settings/admin/release-notes-routes.ts` — view/save/regenerate per locale.
- `client/settings/admin-fetchers.ts` (+ response schema), `client/settings/sections/admin/AdminReleaseNotesSection.svelte` — per-locale editing UI.
- `src/i18n/locales/en.ts`, `src/i18n/locales/ru.ts`, `src/i18n/types.ts` — `announcements.emptyReleaseNote` key.
- `docs/architecture/behaviors.md` — update the version-release-announcements behavior entry (localized per-recipient bodies, per-locale storage/fallback).

## Verification

- Unit tests (extend `tests/announcements.test.ts`, `tests/db/announcement-schema.test.ts`, and the broadcast/settings-route suites, following their DI style):
  - humanize produces both locale bodies from one classify pass; ru-write failure yields en-only with warn, not null overall.
  - broadcast sends the ru body to a ru-configured DM user and ru-configured group, en body to en/unset recipients, en body to ru recipient when ru body missing, raw body as last resort; delivery dedup keyed per recipient unchanged.
  - store round-trips per-locale bodies; legacy rows with only `humanized_body` read back as en.
  - settings API: save/regenerate act on the requested locale; view returns per-locale bodies; broadcast action still works.
  - migration 064 adds the column idempotently.
  - i18n key-parity test passes for the new key.
- `bun run test:affected` during the loop, one full `bun run test` before finishing; `bun check:full` (lint/typecheck/knip/format).

## Non-goals

- No per-recipient LLM calls at broadcast time (bodies are generated once at humanize time).
- No new locales beyond existing `SUPPORTED_LOCALES` (en/ru).
- No backfill/re-broadcast of previously announced versions.
- The separate manual admin Announce broadcast (`/settings/api/admin/announce`) is untouched.
