# Tasks: localize-release-announcements

## 1. i18n key: `announcements.emptyReleaseNote`

- [x] 1.1 Test-first: extend `tests/i18n/parity.test.ts` (+ `tests/i18n/locales/en.test.ts`, `ru.test.ts`) to require the `announcements.emptyReleaseNote` key in both catalogs — fails until the catalogs land: `bun test tests/i18n/parity.test.ts`
- [x] 1.2 Add `emptyReleaseNote` to the `announcements` subtree in `src/i18n/types.ts` + `src/i18n/locales/en.ts` (move the current `EMPTY_RELEASE_NOTE` string), and its Russian rendering in `src/i18n/locales/ru.ts`: `bun test tests/i18n/ && bun run typecheck`

## 2. Migration 080 + store (`humanized_bodies` JSON column)

- [x] 2.1 Test-first: extend `tests/db/announcement-schema.test.ts` (+ new `tests/db/migrations/080_release_announcement_bodies.test.ts`) — column `humanized_bodies` added, re-run idempotent, legacy row with only `humanized_body` reads back as the `en` body, no backfill of historical rows: `bun test tests/db/announcement-schema.test.ts tests/db/migrations/080_release_announcement_bodies.test.ts`
- [x] 2.2 Implement `src/db/migrations/080_release_announcement_bodies.ts` (063/069 pattern: `columnExists` guard, `ALTER TABLE … ADD COLUMN humanized_bodies TEXT`, `changed` flag, log) and register it after `migration079ToolCallDurationNormalize` in `src/db/index.ts`; add the column to `versionAnnouncements` in `src/db/announcement-schema.ts`: `bun test tests/db/announcement-schema.test.ts tests/db/migrations/080_release_announcement_bodies.test.ts`
- [x] 2.3 Test-first: `tests/announcements.test.ts` store cases — `updateHumanizedBodies` merges per locale (one locale's write leaves the other untouched), every `en` write mirrors into legacy `humanized_body`, `getAnnouncementDraft` returns the coalesced `humanizedBodies` map with legacy coalescing applied once, unknown locales stripped on write (Zod `z.partialRecord(z.enum(SUPPORTED_LOCALES), z.string())`): `bun test tests/announcements.test.ts`
- [x] 2.4 Implement the store changes in `src/announcements/store.ts` (`updateHumanizedBody` → `updateHumanizedBodies` read-modify-write merge; `AnnouncementDraft.humanizedBodies`): `bun test tests/announcements.test.ts && bun run typecheck`
- [x] 2.5 Commit checkpoint: land the DB/migration/store step alone so `test:mutate:changed` measures these files as they change (per design D8): `bun run test:affected`

## 3. Per-locale humanization

- [x] 3.1 Test-first: `tests/announcements.test.ts` humanize cases — one classify call for both locale bodies (deps call counts), ru write failure/empty → en-only result + `warn` naming the locale + overall result not null, both passes fail → empty map, empty release → `announcements.emptyReleaseNote` per locale via `t()`: `bun test tests/announcements.test.ts`
- [x] 3.2 Implement `src/announcements/humanize.ts`: `humanizeChangelog(rawSection): Promise<Partial<Record<Locale, string>>>`; classify pass unchanged and run once; write pass per locale from a `Record<Locale, string>` prompt map (output-language instruction + localized headers, e.g. `✨ Новое` / `⚡ Улучшения` / `🛠 Исправления`); per-locale try/catch; deps gain `locales` (default `SUPPORTED_LOCALES`); remove the exported `EMPTY_RELEASE_NOTE` constant in favor of the i18n key: `bun test tests/announcements.test.ts && bun run typecheck`

## 4. Per-recipient broadcast

- [x] 4.1 Test-first: `tests/announcements/broadcast.test.ts` — new `broadcastAnnouncement(chat, version, bodies, rawBody, deps)` signature; ru DM user and ru group receive the ru body, en/unset recipients the en body, ru recipient with missing ru body falls back to en, raw section as last resort; `getUserLocale`/`getGroupLocale` DI resolvers drive selection; dedup (`isDelivered`/`recordDelivery` keys unchanged) and failure isolation unchanged: `bun test tests/announcements/broadcast.test.ts`
- [ ] 4.2 Implement `src/announcements/broadcast.ts`: pure exported `selectAnnouncementBody(bodies, rawBody, locale)` (locale → `en` → raw) reused by tests and the admin notice; `sendDm`/`sendGroup` take the per-recipient body; resolver defaults `getContextLanguage(toScopedContextId({ platformInstanceId, nativeContextId: userId }))` and `getContextLanguage(groupId)`: `bun test tests/announcements/broadcast.test.ts && bun run typecheck`
- [ ] 4.3 Test-first: `tests/announcements/announce-new-version.test.ts` — startup humanizes both locales and persists the map; admin DM body = `selectAnnouncementBody(bodies, rawSection, adminLocale)` (ru admin → ru body; missing ru body → en; empty map → raw section), wrapper text still `t('announcements.adminNotice', adminLocale)`: `bun test tests/announcements/announce-new-version.test.ts`
- [ ] 4.4 Implement `src/announcements.ts` (`announceNewVersion`): map-returning humanize, persist via `updateHumanizedBodies`, single `adminLocale` lookup serving both wrapper and body: `bun test tests/announcements/announce-new-version.test.ts && bun run typecheck`

## 5. Settings route + SPA per-locale editing

- [ ] 5.1 Test-first: `tests/debug/settings/admin/release-notes-routes.test.ts` — view returns `bodies: { en, ru }` (+ `rawBody` when no humanized body exists); `save`/`regenerate` accept `locale: z.enum(SUPPORTED_LOCALES)` and mutate only that locale (regenerate failure → 422, other locale untouched); unsupported locale → 422 invalid request; `broadcast` resolves the map + raw from the draft and fans out per-recipient; admin guard + CSRF unchanged: `bun test tests/debug/settings/admin/release-notes-routes.test.ts`
- [ ] 5.2 Implement `src/debug/settings/admin/release-notes-routes.ts` per design D7 (regenerate persists only the requested locale's write pass): `bun test tests/debug/settings/admin/release-notes-routes.test.ts && bun run typecheck`
- [ ] 5.3 Test-first: `tests/client/settings/admin-release-notes-section.test.ts` + `tests/client/stories/msw/scenarios-admin.test.ts` — fetcher schemas and handlers return/accept per-locale bodies; fetchers pass `locale` on save/regenerate; section renders a locale switcher with one editor state per locale, per-locale save/regenerate buttons disabled appropriately: `bun test tests/client/settings/admin-release-notes-section.test.ts tests/client/stories/msw/scenarios-admin.test.ts`
- [ ] 5.4 Implement the client: update `ReleaseNotesResponseSchema` (+ regenerate/save fetchers with the `locale` argument) in `client/settings/fetcher-schemas-release.ts` + `client/settings/admin-fetchers.ts`; locale switcher + per-locale editors in `client/settings/sections/admin/AdminReleaseNotesSection.svelte`; refresh msw handlers (`client/stories/msw/settings-handlers-admin-2.ts`) and the four stories' fixtures: `bun test tests/client/settings/admin-release-notes-section.test.ts tests/client/stories/msw/scenarios-admin.test.ts`

## 6. Full gates and docs

- [ ] 6.1 Run the full test suite once and read the persisted report (`bun run test:status` / `test:failures` for follow-ups): `bun run test`
- [ ] 6.2 Run typecheck and lint: `bun run typecheck && bun run lint`
- [ ] 6.3 Run the remaining checks (knip, format, license headers) via the wrapped gate: `bun check:full`
- [ ] 6.4 Update `docs/architecture/behaviors.md` — the `release-announcements` behavior entry: per-locale humanization (one classify, per-locale writes, failure isolation + en fallback), `humanized_bodies` JSON column (migration `080`, legacy `humanized_body` = en body, no backfill, en dual-write), per-recipient locale resolution (DM scoped id / group scoped id) with locale → en → raw fallback, per-locale admin editing: `git status --short docs/`
