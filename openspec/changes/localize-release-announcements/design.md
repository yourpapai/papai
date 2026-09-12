# Design: localize-release-announcements

## Context

Announcements today are single-string end to end: `announceNewVersion`
(`src/announcements.ts`) humanizes once with an English-only write prompt,
`version_announcements` stores one `humanized_body` TEXT column (migration
`063`), the admin edits one body in Settings → Release notes, and
`broadcastAnnouncement` (`src/announcements/broadcast.ts`) fans that one
string to every opt-in subscriber. Locale infrastructure already exists and
is used by the admin notice wrapper: `SUPPORTED_LOCALES = ['en','ru']`,
`t(key, locale, params)` with typed key-parity catalogs, and
`getContextLanguage(configContextId)` (`src/utils/config-language.ts`,
`en` when unset/invalid). Broadcast already knows both recipient shapes it
needs: DM users (`platformInstanceId` + `platformUserId`, dedup key
`instance:userId`) and subscribed groups (`groupId` — already the scoped
config-context id, so directly readable by `getContextLanguage`). See
proposal.md for motivation.

Correction to the proposal's file list: migration number `064` is taken
(`064`–`079` exist); the new migration is **`080_`**, registered after
`migration079ToolCallDurationNormalize` in `src/db/index.ts`.

## Goals / Non-Goals

**Goals:**

- One humanized body per locale, generated once per version (classify once,
  write per locale), stored per locale on the existing announcement row.
- Recipient-locale delivery with the fallback chain body(locale) →
  body(en) → raw section, reusing existing config-context language reads.
- Admin can view/save/regenerate each locale independently; broadcast stays
  one action.
- Rollback-safe storage: an old binary reading a migrated DB keeps today's
  behavior.

**Non-Goals** (beyond proposal Non-goals):

- No new module boundaries: everything lands in the existing
  `src/announcements*` files, settings route, fetchers, and i18n catalogs;
  the only new files are the migration and its test additions.
- No concurrency change in generation — the per-locale write passes run
  sequentially (two short calls once per version); `p-limit` stays
  broadcast-only.
- No re-localization of the admin notice wrapper (`announcements.adminNotice`
  already renders in the admin's locale) — only the embedded body changes.

## Decisions

### D1: Storage — `humanized_bodies` JSON column, read-time legacy coalescing, dual-write of `en`

`version_announcements` gains `humanized_bodies TEXT` (nullable JSON object
`locale → body`). Reads coalesce: `en` resolves to
`humanized_bodies.en ?? humanized_body` (legacy single-body rows become the
`en` body); never-written legacy rows are not backfilled. Every write of the
`en` body also mirrors it into the legacy `humanized_body` column, so a
rolled-back binary (which reads only `humanized_body`) still sees the
current English body for any row the new binary wrote.

*Alternative: child table `(version, locale, body)`* — normalized and
per-locale queryable, but ≤2 rows per version don't justify a join on a
read path that is a single `.get()` today. *Alternative: per-locale TEXT
columns* — needs a migration per future locale; a JSON object keyed by
`SUPPORTED_LOCALES` makes a locale addition code-only. JSON opacity is
contained by validating at the store boundary (Zod
`z.partialRecord(z.enum(SUPPORTED_LOCALES), z.string())`, unknown locales
stripped on write) — same discipline migration `069` used for
`matched_task_ids`.

### D2: Migration `080_release_announcement_bodies` — additive, idempotent, no backfill

Follows the `063`/`069` pattern: `columnExists` guard, single
`ALTER TABLE version_announcements ADD COLUMN humanized_bodies TEXT`,
`changed` flag, log line. Nothing else moves; `announcement_deliveries`
and its dedup keys are untouched — locale never enters delivery identity,
so idempotency survives a recipient changing language between broadcasts.

Rollback: additive nullable column only + `en` dual-write ⇒ redeploying the
previous binary is safe (it ignores the new column and reads the mirrored
`en`). No down-migration needed; the column is left in place.

### D3: `humanizeChangelog` returns a per-locale map; classify once, write per locale

New contract:
`humanizeChangelog(rawSection): Promise<Partial<Record<Locale, string>>>`
(possibly empty — central LLM unconfigured, classify failure, or both write
passes failed; callers fall back to the raw section exactly as `null` does
today). The classify pass (`CLASSIFY_SYSTEM_PROMPT`) stays language-neutral
and runs once — both locales announce the same selected entries. The write
pass runs once per locale with a locale-targeted system prompt from a
`Record<Locale, string>` map: same rules/example shape as today's English
prompt plus an explicit output-language instruction and localized section
headers (e.g. `✨ Новое` / `⚡ Улучшения` / `🛠 Исправления` for `ru`).
Each pass is individually try/caught: a failed/empty locale write logs a
`warn` naming the locale and simply omits that key; zero surviving entries
yields `t('announcements.emptyReleaseNote', locale)` per locale (new i18n
key in `en.ts`/`ru.ts`/`types.ts`; key-parity typing + test enforce ru
coverage). Deps keep the existing DI shape and gain `locales` (default
`SUPPORTED_LOCALES`) so tests inject a single-locale list.

*Alternative: translate the `en` body instead of writing per locale* —
rejected: translation compounds tone loss and drifts from the
benefit-framing rules; per-locale writes from one shared selection keep
content parity by construction. *Alternative: parallel write passes* —
rejected: two sequential calls once per version need no concurrency
machinery, and sequential failure semantics (later locale still attempted
after earlier failure) are trivially testable.

### D4: Store API — per-locale upsert, single coalescing reader

`updateHumanizedBody(version, body)` becomes
`updateHumanizedBodies(version, bodies)` performing a read-modify-write
merge per locale (single-process synchronous SQLite; no lost-update
window), mirroring `en` into `humanized_body` per D1.
`getAnnouncementDraft` returns `humanizedBodies: Partial<Record<Locale,
string>>` with the legacy coalescing applied once here — every consumer
(route view, admin notice, broadcast) reads the same resolved map; no
consumer touches the JSON column directly.

### D5: Broadcast — inject locale resolvers; pure body-selection helper

`broadcastAnnouncement(chat, version, bodies, rawBody, deps)` replaces the
`body: string` parameter. `BroadcastDeps` gains `getUserLocale:
(platformInstanceId, platformUserId) => Locale` (default
`getContextLanguage(toScopedContextId({ platformInstanceId, nativeContextId:
platformUserId }))` — the DM config-context id) and `getGroupLocale:
(groupId) => Locale` (default `getContextLanguage(groupId)` — group-shared
across threads). Body selection is a pure exported helper
`selectAnnouncementBody(bodies, rawBody, locale) → string | null`
implementing locale → `en` → raw; it is the single fallback-chain
implementation, unit-tested directly and reused by the admin notice. Each
recipient's `send` closure resolves locale → body → `sendDm`/`sendGroup`,
which now take the per-recipient body. Per-recipient dedup
(`isDelivered`/`recordDelivery`, keys unchanged), failure isolation, and
`markBroadcast` are untouched — localization changes only which string each
recipient gets.

*Alternative: resolve locales in the store/SQL* — rejected: config lives in
the config store, not the announcement schema; DI resolvers keep the
module DB-agnostic apart from its existing store deps and hermetic to test.
*Scope-model impact*: no new persisted state — locale is read live from
existing config-context keys; no storage-context-id state introduced; group
threads share one delivery via the group's single scoped id.

### D6: Startup flow and admin notice

`announceNewVersion` persists the draft as today, calls the map-returning
`humanizeChangelog`, stores the map, and builds the admin DM body with
`selectAnnouncementBody(bodies, rawSection, adminLocale)` where
`adminLocale = getContextLanguage(toScopedContextId({ platformInstanceId,
nativeContextId: adminUserId }))` — already computed for the wrapper `t()`
call, so one lookup serves both. Empty map → raw section, exactly today's
`humanized === null` path.

### D7: Settings route and SPA — locale-parameterized actions, per-locale view

`ActionSchema` save/regenerate gain `locale: z.enum(SUPPORTED_LOCALES)`
(compile-time from `SUPPORTED_LOCALES`, so a future locale is code-only);
unsupported locale → existing 422 invalid-request path. View returns
`bodies: { en: string | null; ru: string | null }` (plus `rawBody` when no
humanized body exists) replacing `body` in both the route response and
`ReleaseNotesResponseSchema` — route and SPA ship together, so no compat
field. Regenerate runs the D3 pipeline but persists only the requested
locale's result (classify is shared; one write pass; failure → today's 422).
Broadcast resolves the map + raw from the draft and calls the new
`broadcastAnnouncement` signature. The SPA swaps the single textarea for a
locale switcher with one editor state per locale; `admin-fetchers.ts`
fetchers gain the `locale` argument; Storybook stories/fixtures gain a
per-locale shape. Admin guard (read vs write) and CSRF checks are
unchanged. No new tool surface — capability gating and `tool_prefs` are
unaffected.

### D8: TDD order and hook interaction

New/edited files under `src/` and `client/` pass through the Write/Edit
TDD hook pipeline (write-policy gate + advisory test-first nudge); the hard
gates remain CI coverage + mutation ratchet. Test-first order, each step
Red → Green:

1. `tests/db/announcement-schema.test.ts` — extend for `080` (column added,
   idempotent re-run, legacy row reads back as `en`) before writing the
   migration.
2. i18n key-parity — add `announcements.emptyReleaseNote` expectations;
   write `en.ts`/`types.ts` so `ru` parity fails until `ru.ts` lands.
3. `tests/announcements.test.ts` humanize cases — one classify for two
   bodies, ru-write failure → en-only + warn + not-null-overall, empty
   release → localized one-liners.
4. Store round-trip tests (map merge, `en` mirror, legacy coalescing).
5. Broadcast tests — ru DM user / ru group get ru body; en/unset get en;
   ru recipient with missing ru body gets en; raw fallback last; dedup and
   failure isolation unchanged.
6. `announceNewVersion` + settings-route tests (per-locale save/
   regenerate/view, 422 on unsupported locale, broadcast passes map).
7. SPA: fetcher schema + section updates with their stories; client edits
   after the route contract is green.

Mutation-ratchet note: landing the DB/migration step separately from the
broadcast/UI steps keeps `test:mutate:changed` measuring files as they
change, matching the monotonic per-file baseline.

## Risks / Trade-offs

- [ru write-pass quality or header drift between locales] → one shared
  classify pass pins content parity; prompts live in one reviewed
  `Record<Locale, string>`; the admin can edit either locale before
  broadcasting (the review gate exists precisely for this).
- [Double LLM cost per release] → accepted: classify once, two short write
  passes, once per version — no per-recipient calls ever (spec-pinned).
- [JSON column opaque to SQL/audit] → contained by store-boundary Zod
  validation; the locale set is closed by `SUPPORTED_LOCALES`; consumers
  only ever see the coalesced `getAnnouncementDraft` shape.
- [Rollback binary loses localized bodies] → `en` dual-write keeps the old
  binary correct for the locale that matters (default); ru bodies are
  re-derivable only by regenerating — accepted, no historical re-broadcast
  is a Non-Goal anyway.
- [Read-modify-write merge race] → none in practice: synchronous
  single-process SQLite; the route is the only writer besides startup,
  which precedes the route server.
- [Broadcast signature change is a breaking internal API] → both call
  sites (settings route, tests) updated in the same change; no plugin or
  external consumer imports it.

## Migration Plan

Ship migration `080` + code in one normal release; startup runs migrations
before `announceNewVersion`, so a fresh version announced on the new binary
stores per-locale bodies immediately. Existing rows stay legacy-shaped and
keep working via coalescing. Rollback = redeploy previous binary: the
additive column is ignored, and dual-written `humanized_body` preserves
today's English-only behavior; no down-migration, no data cleanup.
