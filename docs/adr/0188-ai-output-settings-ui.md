<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0188: AI Output Settings UI

## Status

Implemented

## Date

2026-06-09

## Context

Three context-scoped settings control what the bot emits to chat beyond its main reply (the "AI execution details" message produced by `createAiProgressReporter`): `ai_tool_visibility` (`on`/`off`, default `off`), `ai_reasoning_visibility` (`on`/`off`, default `off`), and `ai_output_detail_level` (`sanitized`/`raw`, default `sanitized`).

The **read** path was already fully wired: `getAiOutputSettings(contextId)` (`src/ai-output-settings.ts`) reads the three keys via `getCachedConfig`, and the orchestrator consumes them through `createProgressReporterForContext` (`src/llm-orchestrator.ts`), resolving group threads to the parent group context. The **write** path, however, had been removed when the retired in-chat `/config` callback flow (`gsel:`/`cfg:`) was deleted as configuration moved to the settings web UI — and an equivalent control was never rebuilt there. The keys were effectively read-only: they always resolved to their parser defaults, so the bot only ever sent its main reply. The only way to change them was a direct DB write to `user_config`.

Additionally, ADR-0144 (`docs/adr/0144-ai-output-visibility.md`) was marked "Implemented" but referenced a `setAiOutputSetting()` that no longer existed in `src/`; it predated the chat-config removal and was stale. Correcting it was part of this work.

## Decision Drivers

- **No orchestrator or read-side change.** The read path already worked; only the write path was missing. Lighting up the write path into the same cache `getAiOutputSettings` reads is sufficient — no orchestrator wiring.
- **Reuse the generic config pipeline.** The existing `GET`/`PATCH /settings/api/config` route already handles scope resolution, CSRF, validation, and persistence via `setConfigValue`; extending it avoids a new endpoint and its own auth surface.
- **Personal + group editability.** A group setting must apply to everyone in the group, matching how the orchestrator already resolves settings to the parent group context. No special gating of `raw` in groups.
- **Three independent controls, not a verbosity preset.** A single preset cannot express combinations such as tools-on/reasoning-off; two toggles plus a selector is the minimal expressive model.
- **Backward-compatible extension.** An absent `control` descriptor must keep the exact current text/secret behavior so `ProfileSection` and `TaskProviderSection` (the two existing `ConfigFieldRow` consumers) are unchanged at runtime.
- **`required: false` is mandatory.** `getRequiredProviderConfigKeysForContext` returns every field where `required && kind !== 'preference'`, and the orchestrator treats those as "context not fully configured." A `required: true` ai-output field would wrongly block the bot.

## Considered Options

### Option A: Extend the generic `ConfigField` pipeline with typed enum controls (chosen)

Add optional `control?: 'text' | 'toggle' | 'select'` and `options?: readonly { value, label }[]` to `ConfigField`, plus a new `'ai-output'` kind. Register the three keys so the existing GET/PATCH config route accepts them, and render them through a new `AiOutputSection` using the existing `SegmentedControl`.

- **Pros:** Additive and backward-compatible — absent `control` is a no-op for existing sections; reuses the route, CSRF, scope resolution, and validation; the enum validation is generic and reusable for any future enum config field.
- **Cons:** Touches the shared `ConfigField` type (6 files), so the change's blast radius is wider than a dedicated route; the generic `ConfigFieldRow` gains a render branch it must not regress.

### Option B: Dedicated section + dedicated route

A new `/settings/api/ai-output` endpoint with its own handler, schema, and validation.

- **Pros:** Zero changes to the generic pipeline; fully isolated.
- **Cons:** Duplicates auth/CSRF/scope/validation plumbing; a new endpoint is a larger surface to secure and test; the three keys are just config values, so a dedicated route is ceremony for no semantic gain.

### Option C: Dedicated section reusing the config route

A new `AiOutputSection` that calls the generic `/settings/api/config` but with bespoke client-side field handling, leaving `ConfigField` unextended.

- **Pros:** Smaller server change than A.
- **Cons:** The GET response would not carry `control`/`options`, so the client would need a hardcoded enum map keyed by storage key — duplicating the option list in two places and risking drift; no server-side enum validation (only client-side).

## Decision

Implement Option A. Six coordinated changes make the three keys editable through the generic config pipeline:

### 1. Typed `ConfigField` controls and the `AiOutputConfigKey` allow-list (`src/types/config.ts`)

`ConfigField` gains optional `control?: 'text' | 'toggle' | 'select'` and `options?: readonly ConfigFieldOption[]`, and the `kind` union gains `'ai-output'`. A new `AiOutputConfigKey = 'ai_tool_visibility' | 'ai_reasoning_visibility' | 'ai_output_detail_level'` is added to the `ConfigKey` union and to `ALL_CONFIG_KEYS`. Making the keys first-class `ConfigKey`s causes `isConfigKey`/`isAllowedDynamicConfigKey` to return true for them, which is what lets `getConfigKeysForContext` preload them into the cache `getAiOutputSettings` reads.

### 2. `AI_OUTPUT_FIELDS` surfaced from every context (`src/config-keys.ts`)

A new `AI_OUTPUT_FIELDS: readonly ConfigField[]` constant declares the three fields with `kind: 'ai-output'`, `required: false`, `sensitive: false`, and their `control`/`options`. It is appended (`...AI_OUTPUT_FIELDS`) to every return path of `getConfigFieldsForContext`, so the fields appear in both personal and group contexts regardless of task-instance state. The key constants are imported from `src/ai-output-settings.js` to keep the storage-key strings in one place.

### 3. Generic enum validation (`src/config-editor/validation.ts`)

`validateConfigField` gains a rule: when `field.options` is defined, the value must equal one of the option values, else it returns `{ valid: false, error: '<label> must be one of: <allowed>' }`. The existing `required` and `timezone` rules are unchanged. This is the `422` defense-in-depth the PATCH handler relies on.

### 4. GET route forwards `control`/`options` (`src/debug/settings/config-routes.ts`)

The GET handler's explicit response object gains `control: field.control` and `options: field.options` so the client receives them. The PATCH handler is unchanged — it looks the field up, validates via `validateConfigField` (which now enforces enums), and writes via `setConfigValue`.

### 5. Client schema and enum rendering (`client/settings/fetcher-schemas.ts`, `client/settings/components/ConfigFieldRow.svelte`)

`ConfigFieldSchema` gains optional `control` (`z.enum(['text','toggle','select'])`) and `options`. `ConfigFieldRow` branches on `field.control`: `toggle`/`select` render a `SegmentedControl` whose `onChange` calls `patchConfig` immediately (save-on-change, no Save button); on error the control reverts to the last-known value and the existing inline `status-error` is shown. The `undefined`/`'text'` branch is the verbatim text/secret editor — the regression guard for Profile/TaskProvider.

### 6. New `AiOutputSection` and registration (`client/settings/sections/AiOutputSection.svelte`, `client/settings/SettingsApp.svelte`)

`AiOutputSection` mirrors `ProfileSection`: `fetchConfig(contextId)`, filter `kind === 'ai-output'`, render each via `ConfigFieldRow`, re-fetch on save. Unset keys come back as `value: ''`; the section maps an empty value to the field's first option (the default) so a control is never rendered in an indeterminate state. `SettingsApp` imports the section, renders it in the Personal `settings-group` after `ToolsSection`, and adds an `{ id: 'ai-output', label: 'AI output' }` sidebar item visible in both personal and group contexts.

### 7. ADR-0144 correction (`docs/adr/0144-ai-output-visibility.md`)

The stale `setAiOutputSetting()` reference in the file table is removed, and a note records that the write path is now the settings-web-UI AI output section via the generic config route.

## Consequences

### Positive

- No orchestrator or `getAiOutputSettings` change; storing values into the same cache the read path consumes lights up the feature end-to-end.
- The generic config pipeline (route, CSRF, scope resolution, validation) is reused — no new endpoint or auth surface.
- The extension is additive and backward-compatible: absent `control` is a no-op, so `ProfileSection` and `TaskProviderSection` are unchanged at runtime and covered by their existing tests as regression guards.
- Personal and group editability work uniformly because the fields are appended to every `getConfigFieldsForContext` return path.
- Empty value maps to the default option for display, so controls are never indeterminate; the backend still treats an absent key as the parser default.
- Generic enum validation gives a `422` defense-in-depth regardless of what the client submits.
- The pipeline proved extensible: a fourth key (`ai_live_status`, added later by the live-status feature) registered through the same `AI_OUTPUT_FIELDS` constant and rendered by the same section with no further plumbing.

### Negative

- **Defaults are not stored.** The UI maps empty→default for display only; the backend still resolves absent keys to parser defaults. A consumer reading `user_config` directly sees no row for an unset key.
- **The change touches the shared `ConfigField` type** across six files. The blast radius is contained by the additive, optional shape and the `{:else}` regression branch in `ConfigFieldRow`, but any future `ConfigField` consumer must account for the enum branch.
- **`raw` in groups is not gated.** Per the spec's YAGNI scope, there is no confirmation dialog or special gating for `raw` detail in group contexts; a group admin can set it group-wide. This is deliberate.

### Risks

- **`required: false` is load-bearing.** A future ai-output field accidentally marked `required: true` would wrongly block the bot via `getRequiredProviderConfigKeysForContext`. Mitigated in the shipped implementation by an explicit `field.kind !== 'ai-output'` filter in that function (`src/config-keys.ts`), a defense-in-depth beyond the plan's `required: false` reliance alone.
- **Option drift between client and server is impossible** because the server is the source of truth: the GET response carries `control`/`options`, and the client renders from that response, so there is no hardcoded client-side enum map to fall out of sync.

## Related Decisions

- ADR-0144: AI output visibility — the read side (`getAiOutputSettings`, parsers, defaults) and the stale `setAiOutputSetting()` write-path reference this ADR corrected.
- ADR-0136, ADR-0137, ADR-0138: Settings Web UI — access model, HTTP API, and client SPA whose generic config pipeline this work extends.
- ADR-0187: Settings page redesign — the `AiOutputSection` is surfaced within the restructured settings surface; that ADR cross-references this one.
- ADR-0208: Settings UI Advanced Grouping — later refined the Integrations group that contains the AI output section membership.

## Implementation Notes

Confirmed present in the repo:

- `src/types/config.ts` — `AiOutputConfigKey` type, `kind: 'preference' | 'provider-context' | 'plugin-context' | 'ai-output'`, and the three keys in `ALL_CONFIG_KEYS`.
- `src/config-keys.ts` — `AI_OUTPUT_FIELDS` constant with the three fields (plus the later-added `ai_live_status`), appended to every `getConfigFieldsForContext` return path; `getRequiredProviderConfigKeysForContext` filters out `kind === 'ai-output'`.
- `src/config-editor/validation.ts` — generic enum check against `field.options`.
- `src/debug/settings/config-routes.ts` — GET forwards `control: field.control` and `options: field.options`; PATCH unchanged.
- `client/settings/fetcher-schemas.ts` — `ConfigFieldSchema` with optional `control`/`options`.
- `client/settings/components/ConfigFieldRow.svelte` — `isEnum` derived branch, `SegmentedControl` rendering, `saveEnum` with revert-on-error, `cfg-seg-<key>` testids.
- `client/settings/sections/AiOutputSection.svelte` — filters `kind === 'ai-output'`, maps empty value to first option, conditionally shows the `raw` helper line only when `ai_output_detail_level` is present.
- `client/settings/SettingsApp.svelte` — `AiOutputSection` registered in the Personal group after `ToolsSection`, with an `ai-output` sidebar item.
- `docs/adr/0144-ai-output-visibility.md` — stale `setAiOutputSetting()` reference removed; write path recorded as the settings-web-UI AI output section.
