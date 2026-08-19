<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: multi-language-support (en/ru)

## 1. i18n module (typed catalogs + fallback)

- [x] 1.1 Write failing `tests/i18n/dictionary.test.ts`: en catalog satisfies the `Dictionary` type; `t()` returns the en entry for `en`, the ru entry for `ru`, and falls back to en with a logged warn when a ru key is missing (raw key never returned); named-slot interpolation. Then implement `src/i18n/types.ts`, `src/i18n/index.ts` (`Locale`, `SUPPORTED_LOCALES`, `isSupportedLocale`, `getDictionary`, `t`), `src/i18n/locales/en.ts` seeded with the framework texts, and `src/i18n/locales/ru.ts` typed against the same shape. Verify: `bun test tests/i18n/dictionary.test.ts`
- [x] 1.2 Write failing key-parity test in `tests/i18n/parity.test.ts` that walks the en dictionary and asserts every key path exists in ru (and vice versa, no extra keys). Keep it green by completing `locales/ru.ts`. Verify: `bun test tests/i18n/parity.test.ts && bun run typecheck`

## 2. `language` preference (config key, validation, resolution)

- [x] 2.1 Write failing tests covering: `isConfigKey('language')` is true; config-editor validation accepts `en`/`ru` and rejects other values; `getContextLanguage(configContextId)` returns the stored value and `en` when unset (null task instance and empty context included). Then add `'language'` to `PreferenceConfigKey`/`ALL_CONFIG_KEYS` in `src/types/config.ts`, the select `PREFERENCE_FIELDS` entry in `src/config-keys.ts`, the validation branch in `src/config-editor/validation.ts`, and the `getContextLanguage` helper mirroring `src/utils/config-timezone.ts`. Verify: `bun test tests/i18n/ tests/config-editor/ && bun run typecheck`
- [x] 2.2 Add the internal `language_prompted` config key (guarded by `isConfigKey`, never a `ConfigField`) and a failing-then-passing test that it is storable/unsettable via the config store but absent from `getConfigFieldsForContext`. Verify: `bun test tests/i18n/ tests/config-fields.test.ts`

## 3. First-interaction picker

- [x] 3.1 Write failing `lang:` callback-route tests: `lang:en`/`lang:ru` from an authorized actor persists the language and clears `language_prompted`; unauthorized actor is rejected; invalid locale and already-stored language are no-ops. Then add the `lang:<locale>` prefix handling to `src/chat/interaction-router.ts`. Verify: `bun test tests/chat/interaction-router-lang.test.ts`
- [x] 3.2 Write failing tests for the picker trigger: `/start` and the first authorized message from a context with no stored language post a two-button picker via `reply.buttons` and set `language_prompted`; subsequent messages do not re-ask; guests and buttonless platforms (Kontur Talk) skip the picker; contexts with a stored language never see it. Then implement the trigger in `src/commands/start.ts` and `src/bot-message-handler.ts`. Verify: `bun test tests/commands/start.test.ts tests/i18n/`

## 4. System prompt per locale

- [x] 4.1 Write failing system-prompt tests: for `ru` the assembled prompt uses Russian fragments and contains the "answer in Russian" instruction; for unset language it is byte-identical to today's English prompt minus the mirror-language line, plus "answer in English"; tool names/parameter keys/JSON examples remain verbatim in both. Then move the fragment constants of `src/system-prompt.ts`, `src/system-prompt-group.ts`, `src/system-prompt-prefs.ts`, `src/completion/verified-completion.ts` into the catalogs' `systemPrompt` subtree and thread the locale through the builders. Verify: `bun test tests/system-prompt/ tests/completion/`
- [x] 4.2 Assert locale resolution in the orchestrator: the locale passed to `buildSystemPrompt` comes from the message's config context. Verify: `bun test tests/llm-orchestrator/`

## 5. Framework-text migration (one surface per task)

- [x] 5.1 Commands: update `tests/commands/` to assert ru rendering for a ru-configured context and en otherwise, then swap literals in `src/commands/*.ts` (help, config, context, clear, dashboard, stop acks, start welcome) for `t()` lookups. Verify: `bun test tests/commands/`
- [x] 5.2 Unauthorized replies: failing test for ru rendering of each `auth.reason` branch, then migrate `src/bot-unauthorized-reply.ts`. Verify: `bun test tests/bot-unauthorized-reply.test.ts`
- [x] 5.3 Progress lines: failing tests for ru/en tool started/finished lines, then migrate `src/ai-progress-reporter.ts`. Verify: `bun test tests/ai-progress-reporter.test.ts`
- [ ] 5.4 Stop/steer acks and announcements: failing tests for localized acks and bot-authored announcement texts, then migrate the user-facing strings in `src/bot.ts`, `src/llm-orchestrator-*.ts`, `src/announcements.ts`. Verify: `bun test tests/announcements/ tests/llm-orchestrator/`

## 6. Settings UI

- [ ] 6.1 Add the language select to the Profile section of the settings SPA (options from the field definition), test-first via the existing client tests/Storybook spec where present. Verify: `bun run typecheck`

## 7. Full verification

- [ ] 7.1 Run the full suite and gates: `bun test`, `bun run typecheck`, `bun run lint`; fix any fallout. Update `docs/architecture/behaviors.md` (language preference, picker, fallback) and `docs/architecture/environment.md` if runtime keys changed. Verify: `bun run test:status`
