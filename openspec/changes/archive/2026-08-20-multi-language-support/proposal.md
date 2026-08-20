# multi-language-support (en/ru)

## Goal
Let each user choose the bot's response language (English or Russian) on first interaction and in the settings web UI. Every user-facing text the bot emits — command replies, acks/errors, tool "in progress" lines, system-prompt fragments — must exist in locale catalogs (checked-in artifacts) consumed through a typed i18n interface, so adding a language later means adding a catalog, not touching call sites.

## Assumptions (stated, not asked)
- "Duplicated in two languages" means every text exists in both `en` and `ru` catalogs and exactly one is emitted, selected by the user's language preference — not that each message contains both languages (the user "changes the bot's response language", so output is single-language per choice).
- Language preference follows the existing `timezone` pattern: a new `PreferenceConfigKey` `'language'` stored per config context, surfaced automatically in the settings UI Profile section; default `'en'` when unset. Group contexts therefore share one language, consistent with `timezone`.
- "First interaction" = `/start` and the first authorized message from a context with no stored language present a two-button language picker (via `reply.buttons`) once; the choice persists in the config store.
- LLM free-text replies follow the configured language via a system-prompt instruction (replacing/augmenting today's "Reply in the same language the user used"); framework texts come from catalogs.
- Tool Zod `.describe()` strings stay English in v1 (model-facing, not user-facing) — recorded as a Non-goal.

## Files to touch
- New `src/i18n/` — `types.ts` (dictionary shape), `index.ts` (interface: `type Locale = 'en' | 'ru'`, `getDictionary(locale)`, lookup with en fallback + warn), `locales/en.ts` and `locales/ru.ts` catalogs (ru type-checked against the en shape).
- `src/types/config.ts`, `src/config.ts`, `src/config-keys.ts` (`PREFERENCE_FIELDS` gains `language` select with en/ru options), `src/config-editor/validation.ts` — add/validate the `language` preference key ('en' | 'ru', default 'en').
- First-interaction picker: `src/commands/start.ts` (welcome + language chooser) and `src/bot-message-handler.ts` (one-time language ask when none stored).
- Catalog migration of framework texts: `src/commands/*.ts` (help, config, context, clear, dashboard, stop acks), `src/bot-unauthorized-reply.ts`, `src/ai-progress-reporter.ts` (tool started/finished progress lines), user-facing strings in `src/bot.ts` / `src/llm-orchestrator-*.ts` (steering/stop acks), `src/announcements.ts` bot-authored texts.
- System prompts: `src/system-prompt.ts`, `src/system-prompt-group.ts`, `src/system-prompt-prefs.ts`, `src/completion/verified-completion.ts` — fragments become per-locale catalog entries; `buildSystemPrompt` takes the locale; the reply-language instruction uses the configured language.
- Tests: new `tests/i18n/` suite; updated command/progress/system-prompt tests.

## Intended behaviour change
- New `language` preference ('en' | 'ru'), default 'en', editable in the settings Profile section and settable via the first-interaction picker.
- All bot-emitted framework texts render in the selected language through the i18n interface; a missing ru key falls back to the en entry (logged warn), never to a raw key.
- System prompt (core, providerless, deferred fragments) is assembled in the selected locale and instructs the model to answer in that language.
- No chat commands are added or removed; `/start` additionally offers the language choice when unset.

## Verification
- `bun test tests/i18n/` — en/ru key parity, typed catalog shape, fallback behavior, language resolution per config context (default en).
- `bun test` — command/progress/system-prompt suites assert ru rendering for a ru-configured context and en default otherwise.
- `bun run typecheck`, `bun run lint`; existing config-fields tests cover the new preference field.
