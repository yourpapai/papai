<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: localize-live-status-and-context

## 1. i18n catalog groundwork (`liveStatus.*` + `contextView.*`)

- [x] 1.1 Extend `tests/i18n/parity.test.ts` (and dictionary shape tests) to require the new `liveStatus` and `contextView` subtrees, en/ru — fails until catalogs land: `bun test tests/i18n/parity.test.ts`
- [x] 1.2 Add the `liveStatus` subtree to `src/i18n/types.ts` + `src/i18n/locales/en.ts`: `thinking`, `preparingResponse`, `runningTool` (slot `{tool}`), `tools.<key>` for all 32 REGISTRY tools (en = current labels): `bun test tests/i18n/ && bun run typecheck`
- [x] 1.3 Fill the `liveStatus` subtree in `src/i18n/locales/ru.ts` (`💭 Думаю…`, `💬 Готовлю ответ…`, `⚙️ Выполняю {tool}…`, gerund tool labels): `bun test tests/i18n/parity.test.ts`
- [x] 1.4 Add the `contextView` subtree to types + `en.ts`: `sections.<id>` for the nine section ids (`system_prompt`…`tools`), fact/message counts (singular/plural `{count}` keys), progressive-disclosure line (`{active}`/`{available}`), and renderer chrome (header word, `tokens` unit, `tk` suffix, `(approximate)` marker, approximate footer): `bun test tests/i18n/ && bun run typecheck`
- [x] 1.5 Fill the `contextView` subtree in `ru.ts` (`Контекст`, `токенов`, `факт`/`фактов`, `сообщений`, `{active} активных · {available} доступных (прогрессивное раскрытие)`, `(приблизительно)`, `_количество токенов приблизительное_`): `bun test tests/i18n/parity.test.ts`
- [x] 1.6 Fallback guard: add a test that blanks/omits one ru `liveStatus` key and asserts the en text renders with a warn (existing i18n fallback pattern): `bun test tests/i18n/index.test.ts`

## 2. Live status (Part 1)

- [x] 2.1 Test-first: `formatToolStatus` takes `locale`; ru renders catalog labels (`🔍 Ищу задачи…`), unregistered tools render `⚙️ Выполняю <humanized>…`, en/default output byte-identical (existing en expectations unmodified); arg quoting/truncation/emoji unchanged: `bun test tests/live-status/tool-status-labels.test.ts`
- [x] 2.2 Implement: REGISTRY entries swap `label: string` for the dictionary key; `formatToolStatus(toolName, input, locale)` resolves via `t('liveStatus.tools.<key>', locale)` with the localized `runningTool` fallback: `bun test tests/live-status/tool-status-labels.test.ts`
- [x] 2.3 Test-first: `createStatusEngine` uses an injected `idleText` for `lastStartLabel` init, `reset()`, and all identity comparisons (ru `💭 Думаю…` dedups/reverts correctly): `bun test tests/live-status/status-engine.test.ts`
- [x] 2.4 Implement: add `idleText` to `StatusEngineDeps`, remove the exported `THINKING` constant: `bun test tests/live-status/status-engine.test.ts`
- [x] 2.5 Test-first: `LiveStatusReporterOptions.locale` (default `'en'`) drives the thinking text and tool labels; no-locale output byte-identical to today: `bun test tests/live-status/reporter.test.ts`
- [x] 2.6 Implement: reporter resolves `t('liveStatus.thinking', locale)` for both `createStatus` and the engine, formats labels with the locale; remove the exported `PREPARING_RESPONSE`: `bun test tests/live-status/reporter.test.ts`
- [x] 2.7 Test-first + implement: `invokeWithLiveStatus` resolves `getContextLanguage(getConfigContextIdFromStorageContextId(invokeArgs.contextId))`, passes `locale` in reporter options, and calls `placeholder(t('liveStatus.preparingResponse', locale))`: `bun test tests/llm-orchestrator-support.test.ts`

## 3. /context view (Part 2)

- [x] 3.1 Test-first: `ContextSection` carries a stable `id`; `context-grid.ts` `SECTION_EMOJIS` and the Mattermost renderer's `emojiFor` key on ids, same emoji map for ru and en snapshots: `bun test tests/commands/context-grid.test.ts`
- [x] 3.2 Implement: add `id` to `ContextSection` (`context-types.ts`) and re-key `SECTION_EMOJIS` by id; update the Mattermost emoji lookup: `bun test tests/commands/context-grid.test.ts tests/chat/mattermost/context-renderer.test.ts`
- [x] 3.3 Test-first: collector emits section ids with labels via `t('contextView.sections.<id>', locale)` and localized detail strings (`{count} фактов`, `{count} сообщений`, progressive-disclosure line); en output unchanged: `bun test tests/commands/context-collector.test.ts`
- [x] 3.4 Implement: `collectContext` resolves labels/details through the catalog (locale threaded via deps or snapshot); add `locale: Locale` to `ContextSnapshot`: `bun test tests/commands/context-collector.test.ts`
- [x] 3.5 Test-first + implement: `src/commands/context.ts` sets `snapshot.locale = getContextLanguage(auth.configContextId ?? auth.storageContextId)`: `bun test tests/commands/context.test.ts`
- [x] 3.6 Test-first: all four renderers localize chrome (`Контекст`, `токенов`, `tk` suffix, `(приблизительно)`, footer) via `t('contextView.*', snapshot.locale)`; en snapshots byte-identical; digit grouping stays `en-US` in ru: `bun test tests/chat/telegram/context-renderer.test.ts tests/chat/discord/context-renderer.test.ts tests/chat/mattermost/context-renderer.test.ts tests/chat/kontur-talk/context-renderer.test.ts`
- [x] 3.7 Implement renderer chrome localization in `src/chat/{telegram,discord,mattermost,kontur-talk}/context-renderer.ts`: `bun test tests/chat/telegram/context-renderer.test.ts tests/chat/discord/context-renderer.test.ts tests/chat/mattermost/context-renderer.test.ts tests/chat/kontur-talk/context-renderer.test.ts`

## 4. Full gates and docs

- [x] 4.1 Run the full test suite and read the persisted report: `bun run test`
- [ ] 4.2 Run typecheck and lint: `bun run typecheck && bun run lint`
- [ ] 4.3 Run the remaining checks (knip, format) via the wrapped gate: `bun check:full`
- [ ] 4.4 Update affected docs — sweep `docs/architecture/*.md` (behaviors.md live-status entry, commands.md `/context` notes) for any now-stale "English-only" claims about these two surfaces; record the localization there: `git status --short docs/`
