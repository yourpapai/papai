<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: AI Output Settings UI

**Date:** 2026-06-09
**Status:** Approved (pending implementation plan)

## Problem

Three context-scoped settings control what the bot emits to chat beyond its main
reply (the "AI execution details" message produced by `createAiProgressReporter`):

| storageKey                | Type                | Default     | Effect                                 |
| ------------------------- | ------------------- | ----------- | -------------------------------------- |
| `ai_tool_visibility`      | `on` / `off`        | `off`       | Whether tool calls appear in chat      |
| `ai_reasoning_visibility` | `on` / `off`        | `off`       | Whether reasoning appears in chat      |
| `ai_output_detail_level`  | `sanitized` / `raw` | `sanitized` | How shown tools/reasoning are rendered |

The **read** path is fully wired: `getAiOutputSettings(contextId)`
(`src/ai-output-settings.ts`) reads the three keys via `getCachedConfig`, and the
orchestrator consumes them through `createProgressReporterForContext`
(`src/llm-orchestrator.ts`), resolving group threads to the parent group context
via `resolveAiOutputSettingsContextId`.

The **write** path was removed. It originally lived in the retired in-chat
`/config` callback flow (`gsel:`/`cfg:`), deleted when configuration moved to the
settings web UI — but an equivalent control was never rebuilt there. Today the
keys are effectively read-only: they always resolve to their parser defaults, so
the bot only ever sends its main response. The only way to change them is a direct
DB write to `user_config`.

ADR-0144 (`docs/adr/0144-ai-output-visibility.md`) is marked "Implemented" but
references a `setAiOutputSetting()` that no longer exists in `src/`; it predates
the chat-config removal and is stale. Updating it is part of this work.

## Goal

Add a settings-web-UI surface that lets a user read and change all three keys, in
both personal and managed-group contexts, with no change to the orchestrator or to
`getAiOutputSettings`.

## Decisions (from brainstorming)

- **Control model:** three independent controls — two on/off toggles (tools,
  reasoning) plus a `sanitized`/`raw` selector. No backend semantics change. (Not
  a single "verbosity" preset; that cannot express combinations such as
  tools-on/reasoning-off.)
- **Context scope:** editable in both personal and managed-group contexts (like the
  Tools section). A group setting applies to everyone in the group; this matches how
  the orchestrator already resolves settings to the parent group context. No special
  gating of `raw` in groups.
- **Implementation approach (Approach A):** extend the generic `ConfigField`
  pipeline to support typed enum controls, then surface the three keys through it.
  Chosen over a dedicated section + dedicated route (Approach B) and a dedicated
  section reusing the config route (Approach C) because the pipeline is small and
  well-contained, and an additive, backward-compatible extension lets the existing
  GET/PATCH route, scope resolution, CSRF, and validation be reused without a new
  endpoint.

### Pipeline usage (Approach A blast radius)

The settings `ConfigField` type (`src/types/config.ts`) — distinct from
`ProviderConfigField`/`ChatProviderConfigField` — is used in 6 files:

- Server: `config-keys.ts` (producer), `config-editor/validation.ts` (validator),
  `debug/settings/config-routes.ts` (GET/PATCH `/settings/api/config`).
- Client: `fetcher-schemas.ts` (Zod schema), `components/ConfigFieldRow.svelte`
  (renderer).

The generic `<ConfigFieldRow>` renders in exactly two sections: `ProfileSection`
(filters `kind === 'preference'`) and `TaskProviderSection` (filters
`kind === 'provider-context'`). Both currently render only text/secret inputs. The
extension is additive: an absent `control` keeps the exact current text/secret
behavior, so those two sections are unchanged at runtime.

## Architecture & data flow

```
AiOutputSection.svelte ──fetchConfig──▶ GET /settings/api/config
   renders kind==='ai-output' fields via ConfigFieldRow (SegmentedControl)
   onChange ──patchConfig──▶ PATCH /settings/api/config
       → validateConfigField (new enum check) → setConfigValue (user_config)
   → getAiOutputSettings reads via getCachedConfig (already wired)
```

Making the three keys first-class `ConfigKey`s causes `isConfigKey` /
`isAllowedDynamicConfigKey` to return true for them, which is what makes
`getConfigKeysForContext` preload them into the cache that `getAiOutputSettings`
reads. They are appended in `getConfigFieldsForContext` for every context, so they
appear in both personal and group contexts.

## Components & changes (file-by-file)

### Backend

1. **`src/types/config.ts`**
   - Extend the `ConfigField` type with optional `control?: 'text' | 'toggle' |
'select'` (absent ⇒ `text`, backward-compatible) and
     `options?: readonly { value: string; label: string }[]`.
   - Add `'ai-output'` to the `ConfigField['kind']` union.
   - Add `AiOutputConfigKey = 'ai_tool_visibility' | 'ai_reasoning_visibility' |
'ai_output_detail_level'` to the `ConfigKey` union and to `ALL_CONFIG_KEYS`
     (makes `isConfigKey`/`isAllowedDynamicConfigKey` true for the three keys).

2. **`src/config-keys.ts`**
   - Add an `AI_OUTPUT_FIELDS: readonly ConfigField[]` constant: the three fields
     with `kind: 'ai-output'`, the `control`/`options` from the table below,
     `required: true`, `sensitive: false`.
   - Append `AI_OUTPUT_FIELDS` to every return path of
     `getConfigFieldsForContext` (alongside `PREFERENCE_FIELDS`), so the fields are
     always available regardless of task-instance state.

3. **`src/config-editor/validation.ts`**
   - Generic rule in `validateConfigField`: if `field.options` is defined, the value
     must equal one of the option values; reject otherwise with a clear message.
     This covers both `toggle` and `select` controls. Existing `required` and
     `timezone` rules are unchanged.

4. **`src/debug/settings/config-routes.ts`** — small change. The GET handler
   whitelists fields into an explicit response object (`key`, `storageKey`, `label`,
   `required`, `sensitive`, `kind`, `hasValue`, `value`); add `control: field.control`
   and `options: field.options` to that mapped object so the client receives them.
   The PATCH handler is unchanged — it already looks the field up, validates via
   `validateConfigField` (which now enforces enums), and writes via `setConfigValue`.

### Frontend

5. **`client/settings/fetcher-schemas.ts`**
   - Add optional `control` (`z.enum(['text','toggle','select']).optional()`) and
     `options` (`z.array(z.object({ value: z.string(), label: z.string() })).optional()`)
     to `ConfigFieldSchema`.

6. **`client/settings/components/ConfigFieldRow.svelte`**
   - Branch on `field.control`:
     - `undefined` / `'text'` → the current text/secret editor, verbatim (default
       branch is the regression guard for Profile/TaskProvider).
     - `'toggle'` / `'select'` → render a `SegmentedControl`
       (`client/shared/ui/SegmentedControl.svelte`) whose `onChange` calls
       `patchConfig` immediately (save-on-change; no Save button). On error, revert
       the control to the last-known value and show the existing inline
       `status-error`.

7. **`client/settings/sections/AiOutputSection.svelte`** — new. Mirrors
   `ProfileSection`: `fetchConfig(contextId)`, filter `kind === 'ai-output'`, render
   each via `ConfigFieldRow`, re-fetch on save. `PageHeader` eyebrow "Personal",
   title "AI output". Include a short helper line under the detail control noting
   that `raw` shows unredacted tool inputs/outputs and reasoning (informational
   only).

8. **`client/settings/SettingsApp.svelte`** — import `AiOutputSection`, render it in
   the Personal `settings-group` (after `ToolsSection`), and add a
   `{ id: 'ai-output', label: 'AI output' }` item to the Personal sidebar group
   (visible in personal and group contexts, like Profile/Tools).

## Field definitions & defaults

| storageKey                | Label           | control | options             | effective default |
| ------------------------- | --------------- | ------- | ------------------- | ----------------- |
| `ai_tool_visibility`      | Show tool calls | toggle  | `off` / `on`        | `off`             |
| `ai_reasoning_visibility` | Show reasoning  | toggle  | `off` / `on`        | `off`             |
| `ai_output_detail_level`  | Detail level    | select  | `sanitized` / `raw` | `sanitized`       |

Defaults are **not** stored. They come from the existing parsers in
`ai-output-settings.ts` when a key is absent. The UI displays the current effective
value: the fetched value when present, otherwise the parser default. The GET
response returns `value: ''` for an unset key; the section maps an empty value to
the field's default option for display so a control is never rendered in an
indeterminate state.

## Error handling

- Invalid enum value → `422` from `validateConfigField` (defense-in-depth; the UI
  only ever submits valid option values).
- Failed `patchConfig` → the control reverts to the last-known value and the inline
  `status-error` is shown, matching `ConfigFieldRow`'s existing behavior.
- Unreadable / absent stored values → fall back to parser defaults (read side is
  already tolerant via `parseVisibility`/`parseDetailLevel`).

## Testing

Per the project TDD hook pipeline, each implementation file is written test-first.

- `tests/config-editor/validation.test.ts` — enum acceptance and rejection for the
  three new fields; unaffected behavior for text/timezone fields.
- `tests/config-keys.test.ts` — `getConfigFieldsForContext` includes the three
  `ai-output` fields in personal and group contexts; the keys are allowlisted by
  `isAllowedDynamicConfigKey` and present in `getConfigKeysForContext`.
- `tests/client/settings/ConfigFieldRow.test.ts` — `toggle`/`select` render a
  `SegmentedControl` and call `patchConfig` on change; `text`/undefined still
  renders the existing input (regression guard); error path reverts the control.
- `tests/client/settings/AiOutputSection.test.ts` — fetch, filter to `ai-output`,
  render three controls, save-on-change round-trip, empty-value→default display.
- Existing `tests/ai-output-settings.test.ts` and `tests/ai-progress-reporter.test.ts`
  cover the read/render side and are left intact.

## Documentation

- Update `docs/adr/0144-ai-output-visibility.md`: correct the stale
  `setAiOutputSetting()` reference and record that the write path is now the
  settings-web-UI AI output section via the generic config route.

## Out of scope (YAGNI)

- No orchestrator or `getAiOutputSettings` changes.
- No `raw` gating or confirmation dialog (user opted against gating in groups).
- No verbosity-preset model.
- No DB migration — the three keys already exist and are parent-shared via
  migration `046`.
- No new `/settings/api/*` endpoint.
  </content>
  </invoke>
