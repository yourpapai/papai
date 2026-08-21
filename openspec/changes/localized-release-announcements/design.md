# Design — localized-release-announcements

## Context

Today one English humanized body serves everyone: `announceNewVersion` (`src/announcements.ts`) humanizes the changelog once via the central LLM (`src/announcements/humanize.ts`, two-pass classify→write), stores it as `version_announcements.humanized_body` (migration 063), DMs the admin a review notice, and `broadcastAnnouncement` (`src/announcements/broadcast.ts`) fans that single body out to opt-in subscribers with per-recipient idempotency (`announcement_deliveries`). The admin reviews/edits/regenerates/broadcasts through the Settings Release-notes routes (`src/debug/settings/admin/release-notes-routes.ts`) and UI section. The `language` preference is already resolved per config context by `getContextLanguage` (`src/utils/config-language.ts`, `en` default), with `SUPPORTED_LOCALES = ['en', 'ru']` and `Locale` exported from `src/i18n/index.ts`. See proposal.md for motivation (issue #323).

Constraints that shape the approach:

- `humanized_body` is read by existing rows, routes, and the fallback story; its meaning must survive.
- Latest migration is `079`; `080` is the next free id.
- Humanization uses the **central/global** LLM only (never BYOK) — unchanged.
- The draft→admin-review→broadcast window is unbounded; subscriber sets change inside it.

## Goals / Non-Goals

**Goals:**

- One humanized body per supported locale per version, generated once at draft time, with locale-independent entry selection.
- Per-recipient delivery in the recipient's config-context language via a single deterministic resolution chain (`locale → en → raw`).
- Per-locale review/edit/regenerate in the admin surface without disturbing other locales.
- Zero data migration; existing rows keep working through the fallback chain.

**Non-Goals** (design-level additions to the proposal's Out-of-scope):

- No auto-sync of locales after an admin edits one locale's body — regeneration is the explicit resync mechanism.
- No caching or reuse of LLM results between `regenerate` calls — each regeneration is a fresh pass.
- No new locales, no machine translation of arbitrary text — only the two authored write-pass prompts.

## Decisions

### D1. Store non-English bodies as a JSON map column, keep `humanized_body` as the English/default body

`version_announcements.localized_bodies TEXT` — nullable JSON object keyed by locale (`{"ru": "…"}`); `NULL`/absent = no localized bodies. `humanized_body` keeps its exact current meaning (English/default), so every existing reader stays valid and no backfill is needed. Resolution chain everywhere: `localized[locale] → humanized_body → raw_body`.

*Alternatives:* a normalized `(version, locale, body)` child table (overkill — never queried by locale, always read whole per version, ≤ `SUPPORTED_LOCALES` rows); one column per locale (schema churn per new locale); moving English into the map (breaks existing rows/readers for no gain — this change must not carry data migration).

### D2. Classify once, write per locale, prompts from an exhaustive `Record<Locale, string>` table

`humanizeChangelog(rawSection, locales, deps?) => Promise<Partial<Record<Locale, string>>>`: the classify pass runs once and its output is shared, so per-locale bodies differ in language only, never in which entries survived. The write pass runs once per requested locale (parallel), each with its locale's system prompt (`en` keeps "✨ New / ⚡ Improvements / 🛠 Fixes"; `ru` outputs Russian with «✨ Новое / ⚡ Улучшения / 🛠 Исправления»). The prompt table is `Record<Locale, string>`, so adding a locale later is a type error until its prompt is authored. Zero surviving entries yields the localized behind-the-scenes one-liner via new catalog key `announcements.emptyReleaseNote` (replacing the `EMPTY_RELEASE_NOTE` constant) — the existing ru/en parity test then enforces both dictionaries. Central LLM unconfigured → `{}` (callers fall back to raw, as today's `null` did). A failed write pass for one locale is omitted with a warn log; other locales survive.

*Alternatives:* one prompt asking the model to emit all locales at once (single failure kills everything, no per-locale regeneration, weaker output validation); machine-translating the English body (couples to a translation capability we don't have, degrades chat-announcement register); per-locale classify (selection could drift between locales — violates the spec's locale-independent selection requirement).

### D3. Generate for all `SUPPORTED_LOCALES` at draft time

Draft-time generation is deterministic and covers any subscriber who opts in or changes language before broadcast. Cost: one extra LLM write call per release (classify is shared). *Alternative:* computing the current subscriber locale set at draft time — stale the moment a subscriber changes language or opts in, and would strand locales with no regeneration path short of admin action.

### D4. Delivery resolves per recipient from injected `bodies` + `fallback`

`broadcastAnnouncement(chat, version, bodies: Partial<Record<Locale, string>>, fallback: string | null, deps?)` replaces the single `body`. A new dep `resolveLanguage: (configContextId) => Locale` (default `getContextLanguage`) supplies the locale; DM recipients resolve via `toScopedContextId({ platformInstanceId, nativeContextId: platformUserId })`, group recipients via `g.groupId`, which is already the scoped config-context id (group-shared across threads — matches the scope model). Per recipient: `bodies[locale] ?? bodies.en ?? fallback`; if none exists, a `failed` delivery is recorded so the `announcement_deliveries` idempotency table stays intact. Idempotency, p-limit concurrency, and failure isolation are untouched.

*Alternative:* resolving inside broadcast from the store (couples the fan-out loop to storage, harder to test, and the route already loads the draft). Per-DM locale resolution is required — a user's DM language is independent of any group's.

### D5. Scope-model impact: new persisted state is version-keyed, not context-keyed

`localized_bodies` is keyed by **version** alone (bot-wide asset, like `raw_body`/`humanized_body`); it introduces no storage-context, config-context, or platform-instance keying. Locale *resolution* at delivery reads the existing per-context `language` preference (DM: user's own config context; group: group-shared config context). No tool surface, capability, or `tool_prefs` permission changes — announcements flow through the settings admin surface and proactive delivery, not through LLM tools. No credentials are touched; bodies are non-secret and stored plaintext like the existing body columns (encryption-at-rest applies to platform/LLM credentials only). The central LLM key continues to never appear in logs or the draft.

### D6. Settings API and UI go per-locale in lockstep

GET returns `{ version, bodies: { en: string|null, ru: string|null }, broadcastAt, counts }` (`null` = not generated). `save` carries `{ action: 'save', locale, body }` — `en` routes to `updateHumanizedBody`, non-`en` merges into `localized_bodies` (never touching other locales). `regenerate` accepts `{ action: 'regenerate', locale? }` — single locale re-runs `humanizeChangelog(raw, [locale])` (re-classifying is accepted); omitted locale regenerates all supported locales. `broadcast` request shape is unchanged; the server builds `bodies` + raw fallback from the draft, and the nothing-to-broadcast guard becomes: no en body AND no localized body AND no raw body. The admin API is internal to the shipped settings SPA (updated in the same change, MSW fixtures included), so no compatibility shim is needed. UI: EN/RU tab switcher, one textarea state per locale, save/regenerate act on the active tab, a "falls back to English" caption when a locale body is `null`; broadcast persists edited bodies first, then broadcasts.

### D7. No new modules, no new dependencies

Every need is covered by an existing module: humanization (`src/announcements/humanize.ts`), persistence (`src/announcements/store.ts` + schema), fan-out (`src/announcements/broadcast.ts`), admin routes (`release-notes-routes.ts`), client fetchers/section. The only new backend file is migration `src/db/migrations/080_localized_announcement_bodies.ts`. No new npm dependency: the AI SDK's `generateText` already serves per-locale write passes, the i18n catalogs already provide localization, and translation libraries are explicitly out of scope.

## Risks / Trade-offs

- [Per-locale write passes can partially fail (rate limit, flaky model)] → per-locale failure isolation: the failed locale is omitted with a warn log; delivery falls back to English; the admin can regenerate just that locale.
- [Independent write passes drift in wording between locales] → the shared classify pass pins entry selection and the shared JSON input pins content; residual wording drift is inherent and acceptable. Header wording is pinned by each locale's prompt.
- [Admin edits one locale; others go stale] → explicit non-goal to auto-sync; per-locale regenerate is the resync; UI caption states the fallback. Same staleness exists today between `raw_body` and `humanized_body`.
- [JSON-in-column resists schema-level validation] → values are written only by the store's merge/upsert and parsed defensively on read; no query-by-locale pattern exists.
- [Extra LLM call per release] → one additional write call, bounded by locale count; classify remains single.
- [Admin API shape change breaks an in-flight admin tab] → internal API with lockstep client + fixtures; a stale tab sees a familiar error and reloads.
- [`broadcast.ts` / `release-notes-routes.ts` grow toward `max-lines` limits] → design signal: extract a pure body-resolution helper (chain + per-recipient pick) rather than compressing formatting.

## Migration Plan

1. Migration `080_localized_announcement_bodies`: `ALTER TABLE version_announcements ADD COLUMN localized_bodies TEXT` guarded by the `columnExists` PRAGMA check (idempotent, pattern of 063), registered in `src/db/index.ts`. Additive and nullable — old code selecting named columns is unaffected, so rolling restarts and rollback are safe with no backfill.
2. Already-announced versions never gain localized bodies (the `isVersionAnnounced` dedup anchor skips them); they resolve through `humanized_body`/`raw_body` — correct by the fallback chain.
3. Deploy is a single normal release; the first startup after deploy that detects a *new* version produces both locales.

## TDD / Hook Interactions

The Write/Edit hook pipeline gates implementation files under `src/` and `client/`. The only **new** gateable file is `src/db/migrations/080_localized_announcement_bodies.ts`, which needs its covering test (`tests/db/migrations/080_*`, pattern of the 063 test) written first. All other work extends existing files whose parallel test files already exist — order each edit red→green by extending the suite first: humanizer (`tests/announcements/humanize.test.ts`), startup flow (`tests/announcements/announce-new-version.test.ts`, `tests/announcements.test.ts`), store/schema (`tests/db/announcement-schema.test.ts`), broadcast suite, routes (`tests/debug/settings/admin/release-notes-routes.test.ts`), client (`tests/client/settings/admin-release-notes-section.test.ts`), story (`tests/stories/settings/announcement-delivery.story.test.ts` ru-recipient assertion). New test files must import their impl module (import gate). `test:mutate:changed` will measure every touched file against its companion suite; `bun check:full` + one full `bun run test` close out the change.
