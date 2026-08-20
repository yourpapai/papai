<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: multi-language-support (en/ru)

## Context

All user-facing framework texts are English string literals inline at
their emit sites (command handlers, `src/bot-unauthorized-reply.ts`,
`src/ai-progress-reporter.ts`, `src/llm-orchestrator-*.ts` stop/steer
acks, `src/announcements.ts`), and the system prompt is assembled from
English fragment constants in `src/system-prompt*.ts` /
`src/completion/verified-completion.ts` with a "reply in the same
language the user used" instruction. The only per-context preference
today is `timezone` (a `PreferenceConfigKey` stored in `user_config`
keyed by config context id, normalized in `src/config.ts`, validated in
`src/config-editor/validation.ts`, surfaced in the settings UI Profile
section via `PREFERENCE_FIELDS` in `src/config-keys.ts`). No existing
module provides localization — `src/` has no i18n facility beyond
`localeCompare` sorting. See proposal.md for motivation and specs for
the behavior contract.

## Goals / Non-Goals

**Goals:**

- A typed, catalog-based i18n interface such that emit sites call a
  lookup, never inline a literal, and adding a language is a new catalog
  plus one select option.
- Language resolution that depends only on the config store (works with
  a `null` task instance, guest mode, and every platform instance).
- First-interaction picker reusing the existing `reply.buttons` +
  interaction-router machinery.

**Non-Goals** (beyond proposal Non-goals):

- No pluralization/date-formatting ICU layer — the texts are short
  fixed strings; interpolation is limited to simple named slots.
- No runtime language detection or per-message language switching; one
  config context renders in one language.
- No localization of log messages (English stays the log language) or
  of debug/settings HTTP error payloads beyond the existing UI work.

## Decisions

### D1: Hand-rolled typed catalogs in a new `src/i18n/` module — no i18n dependency

`src/i18n/types.ts` defines `Dictionary` as a nested readonly shape;
`locales/en.ts` exports a value of that shape, and `locales/ru.ts` is
typed as `Dictionary` (`satisfies`), so key drift between catalogs fails
`typecheck`, not runtime. `src/i18n/index.ts` exposes
`type Locale = 'en' | 'ru'`, `SUPPORTED_LOCALES`,
`isSupportedLocale()`, `getDictionary(locale)`, and a `t()` lookup with
en fallback. No existing module covers this (verified: no i18n facility
in `src/`). A runtime i18n framework (i18next &co.) was rejected: it
brings untyped string keys, runtime loading, and a dependency the stack
(Zod + TS strictness) already subsumes — the compile-time shape is the
whole safety story here.

### D2: `language` as a `PreferenceConfigKey` on the `timezone` pattern

`PreferenceConfigKey` gains `'language'`; `PREFERENCE_FIELDS` gains a
`select` field (`en`/`ru` options, `required: false`, default en
rendered client-side when unset). Validation in
`src/config-editor/validation.ts` rejects values outside
`SUPPORTED_LOCALES`; `normalizeConfigValue` in `src/config.ts` needs no
special case (already-generic passthrough for non-timezone keys).
Storage is the existing `user_config` KV keyed by **config context id**
(group-shared, thread-agnostic) — identical scope to `timezone`, so the
scope model is unchanged and **no drizzle migration or backfill is
needed**: absent key means `en`. A `getContextLanguage(configContextId)`
helper (mirroring `src/utils/config-timezone.ts`) is the single
resolution point, defaulting to `en` and caching via the existing
config cache.

### D3: First-interaction picker via `reply.buttons` + a `lang:` callback route

On `/start` and on the first authorized message from a context with no
stored `language`, the bot posts a localized prompt with two
`ChatButton`s (`callbackData: 'lang:en'` / `'lang:ru'`). The handler in
`src/chat/interaction-router.ts` gains a second prefix — `lang:<locale>`
— alongside `perm:`: it authorizes the actor, persists the choice via
the config store, and edits the prompt message to a confirmation.
Decisions within:

- **"Shown" flag**: a non-editable internal key (`language_prompted`,
  not listed in `PREFERENCE_FIELDS`, so it never renders in the settings
  UI) marks that the picker was already presented for the config
  context; it is set when the picker posts and cleared when a choice
  persists. An in-memory map was rejected — a restart would re-ask every
  context. Group-shared like the language itself, so one thread's picker
  answers for the group.
- **Guests never get the picker**: the choice is group-shared config,
  and guests already never mutate group state; they render in the
  group's (defaulting) language.
- **Buttonless platforms (Kontur Talk)**: `reply.buttons` is
  unavailable there; the picker is skipped entirely and the context
  stays on `en` until set in the settings UI — consistent with how
  `ask`-gated permission prompts degrade there.
- **Idempotency**: the callback validates the locale and is a no-op if
  a language is already stored (e.g. set via settings UI in the
  meantime).

### D4: System prompt assembled per locale; instruction switches from mirror-to-configured

Prompt fragment constants (`CORE_INTRO`, `RECURRING`, `DEFERRED`,
disclosure lines, group/prefs fragments, verified-completion fragments)
move into the catalogs under a `systemPrompt` subtree.
`buildSystemPrompt` (and its group/prefs/completion siblings) takes a
`Locale` resolved from the config context and looks fragments up through
the same fallback path. The current "reply in the same language the
user used" instruction is replaced by "answer in `<language name>`", so
the model's free text follows the configured language even when the
user writes in the other one. Tool names, parameter keys, and JSON
examples inside fragments stay untranslated (they are model-facing
tokens); Russian prose around them is the translation unit. Zod
`.describe()` strings stay English (proposal Non-goal).

### D5: Emit-site migration is mechanical, one surface per task

Each framework-text surface (commands, unauthorized reply, progress
reporter, stop/steer acks, announcements) swaps its literal for
`t(locale, key, slots)` with the locale resolved once per
message/turn from the config context of the incoming message. No new
tool surface exists, so capability gating and `tool_prefs` are
untouched. Behavior is identical across platform instances because
localization happens above the adapter layer — adapters keep receiving
final strings.

### D6: TDD order and hook interaction

Every new file under `src/i18n/` and `tests/i18n/` is created through
the Write/Edit TDD hook pipeline (test first: catalog shape/parity,
fallback-with-warn, `getContextLanguage` default, `lang:` route
authorization/idempotency, per-surface ru rendering), as are edits to
the gated `src/` files. Order: i18n module → config key + validation →
picker route → system-prompt fragments → command/progress/acks/announce
migration, each landing with its tests. `tests/i18n/` includes an
en/ru key-parity suite (walks the en dictionary and asserts the ru
counterpart exists) so catalog drift breaks CI even before `typecheck`
would.

## Risks / Trade-offs

- [Ru catalog drift as texts evolve] → typed `Dictionary` shape plus the
  parity test make a missing key a CI failure; runtime fallback keeps
  production safe (en text + warn).
- [Translated system-prompt fragments change model behavior subtly
  (tool-call accuracy in ru)] → fragments keep tool names/parameter
  keys/examples verbatim; system-prompt tests assert the ru assembly
  contains the same structural markers; rollout is a preference (default
  `en`), so existing contexts are unaffected until opted in.
- [Stale picker buttons after language set elsewhere] → callback is
  idempotent and re-renders the prompt message with the stored choice.
- [Mutation ratchet churn from touching many small string sites] →
  per-file mutation baseline is monotonic; land migrations in separate
  commits so `test:mutate:changed` measures files as they change.
- [`language_prompted` internal key widens the allowed-key set] → it is
  a constant in `src/types/config.ts` guarded by `isConfigKey`, never
  exposed as a `ConfigField`, and carries no sensitive value.

## Migration Plan

Code-only; no schema change, no backfill (absent `language` = `en`, so
every existing context keeps today's behavior). Deploy is a normal
release. Rollback = revert the release; stored `language` /
`language_prompted` rows are inert without the code and harmless if it
returns later.
