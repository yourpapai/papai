# Localize remaining chat-facing texts (live status + /context)

## Goal

Issue #304: with Russian set as the context language, the ephemeral live-status texts (`💭 Thinking…`, `⚙️ Running <tool>…`, tool labels, `💬 Preparing response…`) still render in English. A sweep of `src/` confirms these plus the `/context` command output are the only remaining user-visible chat surfaces that bypass the `t()`/`getContextLanguage()` i18n pipeline everything else already uses. Localize all of them; English behavior must remain byte-identical to today.

## Root cause (found)

- `src/live-status/status-engine.ts:12` — module constant `THINKING = '💭 Thinking…'` (identity-compared inside the engine).
- `src/live-status/reporter.ts:20` — `PREPARING_RESPONSE = '💬 Preparing response…'`.
- `src/live-status/tool-status-labels.ts:53-108` — 32 hardcoded English registry labels + fallback `⚙️ Running ${humanizeToolName(toolName)}…` (this is the reported "Running search tool…").
- `src/llm-orchestrator-support.ts:183,196` — creates the reporter and passes `PREPARING_RESPONSE` without a locale.
- `/context`: `src/commands/context-collector.ts` builds English section labels/details; `src/chat/{telegram,discord,mattermost,kontur-talk}/context-renderer.ts` add English chrome (`Context · …`, `tokens`, `tk`, `_token counts are approximate_`, `(approximate)`); `src/commands/context-grid.ts:15-20` keys `SECTION_EMOJIS` by those English labels, so naively translating labels breaks the emoji legend.

Everything else checked (commands, auth, steer, messageEdit, orchestrator errors, interactions, progress reporter, permission prompts, picker, deferred prompts, announcements admin notice) already goes through `t()` + `getContextLanguage()` — no action needed there.

## Part 1 — live status

**Dictionary** (`src/i18n/types.ts`, `src/i18n/locales/en.ts`, `src/i18n/locales/ru.ts`): add a `liveStatus` section with typed keys (so `ru` is forced to provide every key at compile time, matching the existing catalog pattern):

- `thinking` — en `💭 Thinking…` / ru `💭 Думаю…`
- `preparingResponse` — en `💬 Preparing response…` / ru `💬 Готовлю ответ…`
- `runningTool` (param `{tool}`) — en `⚙️ Running {tool}…` / ru `⚙️ Выполняю {tool}…`
- `tools: { webFetch, fetchChatLink, searchMemory, listMemory, rememberMemory, searchMemos, saveMemo, listMemos, createTask, updateTask, deleteTask, getTask, listTasks, searchTasks, countTasks, addComment, createProject, listProjects, listFiles, searchStagedFiles, uploadAttachment, resolveStagedFile, createRecurringTask, createReminder, createAlert, listReminders, getReminder, updateReminder, cancelReminder, lookupGroupHistory, findUser, getCurrentTime }` — one key per REGISTRY entry, en = current labels; ru gerunds, e.g. `Загружаю`, `Читаю ссылку`, `Ищу в памяти`, `Вспоминаю`, `Сохраняю в память`, `Ищу в заметках`, `Сохраняю заметку`, `Показываю заметки`, `Создаю задачу`, `Обновляю задачу`, `Удаляю задачу`, `Читаю задачу`, `Показываю задачи`, `Ищу задачи`, `Считаю задачи`, `Добавляю комментарий`, `Создаю проект`, `Показываю проекты`, `Показываю файлы`, `Ищу файлы`, `Прикрепляю файл`, `Прикрепляю файл`, `Создаю повторяющуюся задачу`, `Настраиваю напоминание`, `Настраиваю уведомление`, `Показываю напоминания и уведомления`, `Читаю напоминание`, `Обновляю напоминание`, `Отменяю напоминание`, `Проверяю историю`, `Ищу пользователя`, `Проверяю время`.

**Wiring**:

- `src/live-status/tool-status-labels.ts` — REGISTRY entries keep `emoji`/`arg`/`quote` but replace `label: string` with the dictionary key; `formatToolStatus(toolName, input, locale)` resolves text via `t('liveStatus.tools.<key>', locale)`; unknown tools fall back to `t('liveStatus.runningTool', locale, { tool: humanizeToolName(toolName) })`. Emoji, quoting (` host` vs `: "arg"`), truncation, and the parallel `(+n)` suffix are unchanged.
- `src/live-status/status-engine.ts` — replace the `THINKING` constant with an `idleText` (or `thinkingText`) field in `StatusEngineDeps`; all identity comparisons (`lastRendered`, `reset()`, `lastStartLabel` init) use the injected text.
- `src/live-status/reporter.ts` — add `locale?: Locale` to `LiveStatusReporterOptions` (default `'en'`); `start()` creates the status with `t('liveStatus.thinking', locale)` and passes the same text to the engine; `onToolStart` calls `formatToolStatus(event.toolName, event.input, locale)`. Remove the exported `PREPARING_RESPONSE` constant.
- `src/llm-orchestrator-support.ts` — in `invokeWithLiveStatus`, resolve `locale = getContextLanguage(getConfigContextIdFromStorageContextId(invokeArgs.contextId))` (same pattern as line 92), pass it in the reporter options, and use `t('liveStatus.preparingResponse', locale)` for the placeholder call (line 196).

## Part 2 — /context view

- `src/chat/context-types.ts` — add `locale: Locale` to `ContextSnapshot`; add a stable machine `id` to `ContextSection` (e.g. `system_prompt`, `base_instructions`, `custom_instructions`, `provider_addendum`, `memory_context`, `summary`, `known_entities`, `conversation_history`, `tools`).
- `src/commands/context.ts` — set `snapshot.locale` from `getContextLanguage(auth.configContextId ?? auth.storageContextId)`.
- `src/commands/context-collector.ts` — emit labels via `t()` keyed by section id (`contextView.sections.*`); localize detail strings (`{count} fact(s)`, `{count} message(s)`, `{active} active · {available} available (progressive disclosure)` → ru: `{count} фактов`, `{count} сообщений`, `{active} активных · {available} доступных (прогрессивное раскрытие)`).
- `src/commands/context-grid.ts` — key `SECTION_EMOJIS` by the new section `id` instead of English label.
- `src/chat/{telegram,discord,mattermost,kontur-talk}/context-renderer.ts` — localize renderer chrome via `t('contextView.*', snapshot.locale)`: header word (`Context`/`Контекст`), `tokens`/`токенов`, `tk` column suffix, `(approximate)`/`(приблизительно)`, footer `_token counts are approximate_`/`_количество токенов приблизительное_`. Number formatting stays `en-US` grouping.

## Non-goals (checked, deliberately untouched)

- Tool descriptions/schemas in `src/tools/*` — LLM-facing, not user-visible; the localized system prompt already instructs replying in the user's language.
- Settings web UI / dashboard / config-key labels — operator web surface, separate from chat i18n.
- Announcement bodies (`src/announcements/humanize.ts`) — LLM-generated release notes for the admin flow.
- The `(+n)` parallel-tool suffix and emoji glyphs — locale-neutral.

## Verification

- New/extended unit tests: `tests/live-status/*` assert ru output (`💭 Думаю…`, `🔍 Ищу задачи…`, `⚙️ Выполняю <tool>…` fallback for an unregistered tool, `💬 Готовлю ответ…`) via the `locale` option, and that the default (no option) output is unchanged for en (existing expectations like `'💭 Thinking…'`, `'🕒 Checking the time…'` must keep passing unmodified).
- `/context`: renderer/collector tests for `locale: 'ru'` snapshots; existing en snapshots unchanged; grid legend still maps correct emojis via section ids.
- `t()` fallback warning path: remove/`''`-out a ru key in a test to confirm en fallback still works (existing i18n test pattern).
- Compile-time parity: `Dictionary` typing forces every new key in `ru.ts` (`bun run typecheck`).
- Full gates: `bun run test`, then `bun check:full` (lint, typecheck, knip, format) — all green.
