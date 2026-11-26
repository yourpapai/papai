<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: localize-live-status-and-context

## Context

The `multi-language-support` change delivered `src/i18n/` — a typed
`Dictionary` catalog (`en` authoritative, `ru` typed against it so drift
fails `typecheck`), a `t(key, locale, params?)` lookup with en fallback +
warn, and `getContextLanguage(configContextId)` resolving the per-config-
context `language` preference (default `en`, group-shared, cached via the
config store). Every chat surface except two already routes through it.

The two exceptions (see proposal.md for motivation):

- **Live status** — `src/live-status/status-engine.ts` compares against the
  module constant `THINKING = '💭 Thinking…'` for its dedup/hold logic;
  `src/live-status/reporter.ts` exports `PREPARING_RESPONSE`; the REGISTRY
  in `src/live-status/tool-status-labels.ts` holds English `label` strings
  for 32 tools plus an English `⚙️ Running …` fallback; the reporter takes
  no locale, and `src/llm-orchestrator-support.ts` creates it without one.
- **`/context`** — `src/commands/context-collector.ts` emits English
  labels/details; `src/chat/<platform>/context-renderer.ts` (×4) add
  English chrome; `src/commands/context-grid.ts` keys `SECTION_EMOJIS` by
  those English labels, and `src/chat/mattermost/context-renderer.ts` keys
  a second emoji lookup by label the same way.

`ContextSnapshot` (`src/chat/context-types.ts`) carries no locale; the
renderers are pure functions of the snapshot. Number formatting in all
renderers is `toLocaleString('en-US')`.

## Goals / Non-Goals

**Goals:**

- Route both surfaces through the existing `t()`/`getContextLanguage()`
  pipeline with zero new modules, dependencies, or persisted state.
- Byte-identical English output for `en`/unset contexts — existing en test
  expectations must keep passing unmodified.
- Keep adapters locale-blind: they keep receiving final strings (renderers
  read a locale from the snapshot, not from config).

**Non-Goals** (beyond proposal Non-goals):

- No re-layout of the `/context` tables for label width — the fixed-width
  label column (`padEnd`) stays as-is; Russian labels are short gerunds of
  comparable length, and a longer label merely widens its row.
- No per-message locale switching inside a turn; one turn resolves one
  locale.
- No pluralization engine — the fact/message counts move to two-key
  catalogs (`factSingular`/`factPlural`) rather than an ICU layer.

## Decisions

### D1: Live-status texts become `liveStatus.*` dictionary keys; the REGISTRY stores keys, not strings

`Dictionary` gains a `liveStatus` subtree: `thinking`, `preparingResponse`,
`runningTool` (slot `{tool}`), and `tools.<key>` — one key per REGISTRY
entry (32), typed so `ru.ts` must provide all of them. REGISTRY entries
keep `emoji`/`arg`/`quote` but swap `label: string` for the dictionary
key; `formatToolStatus(toolName, input, locale)` resolves text via
`t('liveStatus.tools.<key>', locale)`, and unknown tools fall back to
`t('liveStatus.runningTool', locale, { tool: humanizeToolName(toolName) })`.
Emoji, quoting, truncation, and the parallel `(+n)` suffix are untouched.

*Alternative*: per-locale label maps keyed by the English string —
rejected: stringly-typed, invisible to the `Dictionary` parity typing, and
re-creating the drift class the catalog pattern exists to prevent.

### D2: `THINKING` constant becomes an injected `idleText` in `StatusEngineDeps`

The engine's identity comparisons (`pushText` dedup, the
hold-before-revert check, `reset()`, `lastStartLabel` init) switch from the
module constant to the injected text; the reporter passes
`t('liveStatus.thinking', locale)` both to `createStatus` and the engine,
so the emitted and compared strings are the same string in every locale.

*Alternative*: resolve the locale inside the engine — rejected: the engine
is a pure DI module (injectable clock/schedule, no imports of config or
i18n); keeping it config-free preserves its determinism and its
fake-timer tests.

### D3: Reporter takes `locale?: Locale` (default `'en'`); the orchestrator resolves it once per turn

`LiveStatusReporterOptions` gains `locale`; `start()` and the engine use
the localized thinking text, `onToolStart` formats tool labels with it.
The exported `PREPARING_RESPONSE` is removed; `invokeWithLiveStatus`
resolves `locale = getContextLanguage(getConfigContextIdFromStorageContextId(invokeArgs.contextId))`
(the pattern already used in that file for error replies), passes it in
the reporter options, and calls
`placeholder(t('liveStatus.preparingResponse', locale))`. The default `'en'`
guarantees byte-identical output for any caller that passes no locale (and
for every `en`/unset context, since `getContextLanguage` defaults to `en`).
Locale is resolved once per turn — a mid-turn settings change does not
re-localize in-flight statuses, matching the turn's other locale-resolved
texts.

### D4: `/context` sections gain stable machine `id`s; `ContextSnapshot` carries the locale

`ContextSection` gains a required `id`
(`system_prompt`, `base_instructions`, `custom_instructions`,
`provider_addendum`, `memory_context`, `summary`, `known_entities`,
`conversation_history`, `tools`); `ContextSnapshot` gains `locale: Locale`.
`src/commands/context.ts` sets `snapshot.locale` from
`getContextLanguage(auth.configContextId ?? auth.storageContextId)` (same
fallback the command already uses for its error text). The collector
emits ids and resolves labels via `t('contextView.sections.<id>', locale)`;
detail strings interpolate through the catalog (`{count}`-slot singles for
facts/messages via singular/plural keys, `{active}`/`{available}` slots for
the progressive-disclosure line).

*Why ids*: both emoji lookups (`context-grid.ts` and the Mattermost
renderer's `emojiFor`) key on display labels; translating labels under
them would break the legend — exactly the coupling the proposal calls out.
Ids also give the parity-typed catalog a language-independent join point.
*Alternative*: localize in renderers only — rejected: labels originate in
the collector, chrome in the renderers; the snapshot is the one carrier
both consume, and it keeps adapters config-free per the
`multi-language-support` design.

### D5: Renderer chrome via `t('contextView.*', snapshot.locale)`; numbers stay `en-US`

Each of the four renderers localizes its chrome (header word, `tokens`
unit, `tk` suffix, `(approximate)` marker, approximate footer) through the
same `contextView.*` keys using `snapshot.locale`. Digit grouping stays
`toLocaleString('en-US')` in every locale — the spec pins this, and it
avoids locale-dependent table widths. `SECTION_EMOJIS` (both call sites)
re-keys from label to `id`.

### D6: Scope model, gating, storage — all untouched

No new persisted state: the locale is resolved live from the existing
`user_config` language key (config-context-scoped, group-shared); the
snapshot's `locale` is per-render in-memory. No new tool surface, so
capability gating and `tool_prefs` are unaffected. Because resolution
happens above the adapter layer (orchestrator for live status, command
handler for `/context`), behavior is identical across Telegram,
Mattermost, Discord, and Kontur Talk — including on Kontur Talk, where
`createStatus` is absent and the localized strings simply never render.

### D7: TDD order and hook interaction

All new/edited files under `src/` and `tests/` go through the Write/Edit
TDD hook pipeline (test first). Order, each landing with its tests:

1. `tests/i18n/` parity suite — extend expectations with the new
   `liveStatus.*`/`contextView.*` subtrees; write the `Dictionary`
   additions so `ru` parity fails until `ru.ts` is filled.
2. `tests/live-status/tool-status-labels.test.ts` — ru labels, ru
   fallback, unchanged-en assertions (existing en expectations stay
   unmodified).
3. `tests/live-status/status-engine.test.ts` — `idleText` injection
   replaces `THINKING` comparisons.
4. `tests/live-status/reporter.test.ts` — `locale` option; default-locale
   byte-identity.
5. Orchestrator wiring — ru placeholder/locale pass-through
   (`tests/llm-orchestrator*`).
6. `tests/commands/context-collector.test.ts` + `context.test.ts` — ids
   emitted, ru labels/details, `snapshot.locale` set.
7. `tests/commands/context-grid.test.ts` — legend keyed by id; same emoji
   for ru and en snapshots.
8. `tests/chat/{telegram,discord,mattermost,kontur-talk}/context-renderer.test.ts`
   — ru chrome, en snapshots unchanged, `en-US` grouping.
9. The proposal's fallback check: blank a ru key in a test to exercise the
   en-fallback-with-warn path.

## Risks / Trade-offs

- [New tool registered without a `liveStatus.tools.*` key] → the typed
  `Dictionary` forces `ru` parity at `typecheck`; even if a release slid,
  the runtime path is the generic localized `runningTool` fallback, never
  a raw key.
- [English byte-identity regresses] → existing en expectations are kept
  unmodified and treated as the contract; new tests only add `ru` cases.
- [Translated labels break the grid/legend coupling] → both emoji lookups
  re-key on machine ids, with a test asserting the same id→emoji map for
  ru and en snapshots.
- [Ru label widths misalign the fixed-column tables] → accepted (Non-Goal);
  labels are short gerunds; `padEnd` degrades gracefully (a long label
  widens only its row).
- [Mutation-ratchet churn across many touched files] → land parts 1 and 2
  in separate commits so `test:mutate:changed` measures files as they
  change; per-file baseline is monotonic.

## Migration Plan

Code-only; no schema change, no backfill — `en`/unset contexts resolve
`locale: 'en'` and render exactly today's strings. Deploy is a normal
release. Rollback = revert the release; nothing persisted was added.
