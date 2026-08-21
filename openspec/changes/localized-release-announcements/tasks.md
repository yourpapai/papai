# Tasks — localized-release-announcements

Ordered test-first: each task extends/writes the covering suite before or together with the implementation it covers, per the repo's TDD hook policy. Design reference: `design.md` (D1–D7); behavior contract: `specs/release-announcements/spec.md`.

## 1. Storage: schema, migration 080, store

- [x] 1.1 Extend `tests/db/announcement-schema.test.ts` with a failing case for the `localizedBodies` field on `versionAnnouncements`, then add `localizedBodies: text('localized_bodies')` to `src/db/announcement-schema.ts`. Verify: `bun test tests/db/announcement-schema.test.ts`
- [x] 1.2 Write `tests/db/migrations/080_localized_announcement_bodies.test.ts` (pattern of `tests/db/migrations/063_release_announcements.test.ts`: adds `version_announcements.localized_bodies TEXT`, `columnExists`-guarded, idempotent on re-run), then implement `src/db/migrations/080_localized_announcement_bodies.ts` and register it in `src/db/index.ts`. Verify: `bun test tests/db/migrations/080_localized_announcement_bodies.test.ts`
- [ ] 1.3 Extend `tests/announcements/store.test.ts` with failing cases for `updateLocalizedBodies(version, bodies)` (JSON upsert merging non-`en` locales without touching `humanized_body` or other locales) and for `getAnnouncementDraft` returning parsed `localizedBodies` (null when column empty/invalid JSON), then implement in `src/announcements/store.ts` per design D1. Verify: `bun test tests/announcements/store.test.ts`

## 2. Locale-aware humanizer + i18n key

- [ ] 2.1 Add `announcements.emptyReleaseNote` to `src/i18n/locales/en.ts`, `src/i18n/locales/ru.ts`, and `src/i18n/types.ts` (behind-the-scenes one-liner per locale). Verify: `bun run typecheck` and the ru/en key-parity suite picking the key up (`bun run test:log i18n` against the persisted report, or the parity suite directly)
- [ ] 2.2 Extend `tests/announcements/humanize.test.ts` with failing cases: classify pass runs once for multiple locales; write pass per requested locale with the locale's system prompt from an exhaustive `Record<Locale, string>` table (en keeps ✨ New/⚡ Improvements/🛠 Fixes; ru outputs «✨ Новое / ⚡ Улучшения / 🛠 Исправления»); zero surviving entries → localized `announcements.emptyReleaseNote` per locale; central LLM unconfigured → `{}`; one locale's write failure omitted (warn) while the other succeeds, then change `humanizeChangelog(rawSection, locales, deps?)` in `src/announcements/humanize.ts` to `Partial<Record<Locale, string>>` per design D2, removing the `EMPTY_RELEASE_NOTE` constant. Verify: `bun test tests/announcements/humanize.test.ts`

## 3. Startup flow: per-locale generation + localized admin notice

- [ ] 3.1 Extend `tests/announcements/announce-new-version.test.ts` and `tests/announcements.test.ts` with failing cases: `humanizeChangelog` dep typed `(rawSection, locales) => Promise<Partial<Record<Locale, string>>>`; generation requests all `SUPPORTED_LOCALES`; `en` persisted via `updateHumanizedBody`, non-`en` via new `updateLocalizedBodies` dep; admin review notice body resolved by `getContextLanguage(adminConfigContextId)` with en→raw fallback (wrapper stays `t('announcements.adminNotice', …)`); then update `AnnouncementsDeps` and `announceNewVersion` in `src/announcements.ts` per design D3. Verify: `bun test tests/announcements/announce-new-version.test.ts tests/announcements.test.ts`

## 4. Localized broadcast

- [ ] 4.1 Extend `tests/announcements/broadcast.test.ts` and `tests/announcements/broadcast.testing.test.ts` with failing cases: signature takes `bodies: Partial<Record<Locale, string>>` plus `fallback: string | null`; new `resolveLanguage(configContextId)` dep (default `getContextLanguage`); DM locale from `toScopedContextId({ platformInstanceId, nativeContextId: platformUserId })`, group locale from `g.groupId`; per-recipient body `bodies[locale] ?? bodies.en ?? fallback`; no resolvable body records a `failed` delivery; idempotency/p-limit/failure isolation unchanged, then rework `broadcastAnnouncement` in `src/announcements/broadcast.ts` per design D4 (extract a pure body-resolution helper if `max-lines` pressure appears). Verify: `bun test tests/announcements/broadcast.test.ts tests/announcements/broadcast.testing.test.ts`

## 5. Settings admin API: per-locale review/edit/regenerate/broadcast

- [ ] 5.1 Extend `tests/debug/settings/admin/release-notes-routes.test.ts` with failing cases: GET returns `{ version, bodies: { en, ru }, broadcastAt, counts }` with null = not generated; `save` `{ action:'save', locale, body }` routes en→`updateHumanizedBody`, non-en→merge into `localized_bodies` leaving other locales untouched; `regenerate` `{ action:'regenerate', locale? }` re-runs `humanizeChangelog(raw, [locale])` for one locale or all supported; `broadcast` builds bodies + raw fallback server-side with the nothing-to-broadcast guard = no en AND no localized AND no raw body, then update `src/debug/settings/admin/release-notes-routes.ts` per design D6. Verify: `bun test tests/debug/settings/admin/release-notes-routes.test.ts`

## 6. Settings UI: per-locale editor

- [ ] 6.1 Update `client/settings/fetcher-schemas-release.ts` (`ReleaseNotesResponseSchema` gains `bodies: { en, ru }`, replaces `body`) and `client/settings/admin-fetchers.ts` (`saveReleaseNotes(locale, body)`, `regenerateReleaseNotes(locale?)`), keeping the schemas Zod-validated. Verify: `bun run typecheck`
- [ ] 6.2 Extend `tests/client/settings/admin-release-notes-section.test.ts` with failing cases: EN/RU tab switcher with one textarea state per locale; save/regenerate act on the active tab; "falls back to English" caption when a locale body is null; broadcast persists edited bodies first then broadcasts, then rework `client/settings/sections/admin/AdminReleaseNotesSection.svelte`. Verify: `bun test:client`
- [ ] 6.3 Update MSW fixtures in `client/stories/msw/settings-handlers-admin-2.ts` to the new response shape. Verify: `bun test:client`

## 7. Story coverage, docs, full gates

- [ ] 7.1 Add a ru-recipient assertion to `tests/stories/settings/announcement-delivery.story.test.ts` (ru subscriber receives the ru body; en subscriber receives en). Verify: `bun test:stories`
- [ ] 7.2 Update the `<!-- behavior:release-announcements -->` block in `docs/architecture/behaviors.md`: per-locale generation at draft time, per-recipient localized delivery with en→raw fallback, per-locale admin review/edit/regenerate, `localized_bodies` storage. Verify: manual read of the block
- [ ] 7.3 Run the full gates: `bun run test`, `bun run typecheck`, `bun run lint` (plus `bun check:full` and the `test:mutate:changed` ratchet for touched files per repo policy); fix any fallout. Verify: `bun run test && bun run typecheck && bun run lint`
