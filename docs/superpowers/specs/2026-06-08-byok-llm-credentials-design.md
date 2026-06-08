<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# BYOK LLM Credentials Design

## Status

Approved for implementation planning.

## Date

2026-06-08

## User Stories

1. As a bot admin, I want to enable or disable BYOK per specific user or managed group, so that only approved contexts can use their own LLM credentials.
2. As an approved user or group manager, I want to enter my own LLM API key, base URL, and model settings in the settings UI, so that my conversations use my chosen provider.
3. As an unapproved user or group, I want the bot to keep using the global LLM settings, so that existing behavior stays unchanged.
4. As a bot admin, I want visibility into which users/groups have BYOK enabled, without exposing API keys, so that I can audit configuration safely.

## Scope

This design adds admin-gated, context-scoped BYOK for LLM credentials. It covers personal config contexts and managed group config contexts. BYOK applies to all LLM calls made for an enabled context: foreground chat replies, proactive/deferred prompt generation, conversation trimming, web distillation, embeddings, and group-history lookup.

The global `system_config` LLM settings remain the default for every context where BYOK is not enabled.

Out of scope:

- billing plans or usage quotas;
- provider-specific validation beyond required fields and basic shape checks;
- external secret-vault integration;
- exposing existing API keys for viewing;
- chat-command credential setup.

## Current Context

ADR-0120 moved papai away from unrestricted per-user BYOK. Global LLM credentials now live in `system_config`, are seeded from environment variables, and are managed through the settings admin System section. Migration `036_drop_user_llm_config` removed old LLM keys from `user_config` because unrestricted per-user visibility created a security boundary problem.

The current code still has several direct global LLM reads. The main orchestrator reads through `getLlmConfig()`, while helper paths such as conversation trimming, deferred prompts, web distillation, embeddings, and group-history lookup read `system_config` directly. BYOK must introduce a shared resolver rather than patching only the main orchestrator.

The existing instance config encryption path in `src/instances/encryption.ts` uses AES-256-GCM with `INSTANCE_CONFIG_KEY`, including explicit, passphrase-derived, and host-local fallback modes. BYOK credential storage should reuse that key-resolution pattern so secret handling stays consistent with platform/task instance credentials.

## Considered Approaches

### 1. Dedicated encrypted BYOK table

Store BYOK enablement, encrypted credential payload, and status metadata in a dedicated table keyed by config context ID.

Pros:

- Keeps BYOK separate from generic `user_config` preferences.
- Avoids reintroducing the old unrestricted per-user LLM config problem.
- Gives admins a clear list of BYOK-enabled contexts.
- Makes encryption and masking rules explicit.

Cons:

- Requires a migration and a dedicated store module.

Decision: chosen.

### 2. Existing `user_config` dynamic fields

Add BYOK fields to the existing scoped settings field system and gate visibility with an admin flag.

Pros:

- Smaller backend and UI change.
- Reuses existing sensitive-field masking behavior.

Cons:

- `user_config` is generic application state, not a credential vault.
- It currently stores values plainly.
- Future code could accidentally treat BYOK keys like normal context preferences.

Decision: rejected.

### 3. Admin-managed provider presets

Let admins configure allowed base URLs and model IDs, while enabled users/groups only enter an API key.

Pros:

- Stronger operational control.
- Smaller credential surface for context managers.

Cons:

- Does not satisfy the requirement that BYOK fields mirror global settings.
- Prevents users/groups from selecting their own OpenAI-compatible endpoint and model IDs.

Decision: rejected.

## Architecture

Add BYOK as a context-scoped credential layer, separate from global `system_config` and separate from generic `user_config`.

Resolution rule:

- BYOK disabled: use global `system_config`.
- BYOK enabled and complete: use decrypted BYOK credentials for that config context.
- BYOK enabled but incomplete: block the context's LLM call with setup guidance.

BYOK fields mirror global fields:

- `llm_apikey`, required and sensitive;
- `llm_baseurl`, required;
- `main_model`, required;
- `small_model`, optional;
- `embedding_model`, optional.

Optional model fallback is context-local. In an enabled BYOK context, missing `small_model` and `embedding_model` fall back to BYOK `main_model`, not to global optional models.

## Components

### BYOK Store

Create a dedicated server module that owns:

- encrypted read/write of BYOK credential payloads;
- enable/disable state per config context ID;
- completeness checks for required fields;
- masked snapshots for settings responses;
- admin summaries with no raw secret values.

The encrypted payload uses the existing `INSTANCE_CONFIG_KEY` key-resolution behavior. Implementation extracts the AES-256-GCM payload encryption/decryption logic into a shared secret-payload crypto helper, then keeps instance config and BYOK store modules as domain-specific wrappers over that helper. The implementation must not duplicate key-derivation behavior or log secret material.

### LLM Config Resolver

Introduce a shared resolver for effective LLM configuration. It should accept a config context ID and return a typed result:

- `ok`, with `source: 'global' | 'byok'`, `llmApiKey`, `llmBaseUrl`, `mainModel`, `smallModel`, and `embeddingModel`;
- `missing`, with `source: 'global' | 'byok'` and missing required keys;
- `error`, for unreadable encrypted payloads or invalid stored data.

This resolver becomes the only runtime path for choosing LLM credentials. Direct helper reads of `system_config` should be replaced or routed through the resolver.

### Settings Admin API

Add admin endpoints for bot admins to:

- list BYOK status for known users and groups;
- enable BYOK for a config context;
- disable BYOK for a config context;
- view completeness, update time, and updater ID.

Admin responses must never include raw decrypted credential values.

### Settings Context API

Expose BYOK fields for the active context only when BYOK is enabled for that context. Existing scope authorization rules still apply:

- personal users can edit their own personal BYOK credentials;
- group managers can edit the managed group's BYOK credentials;
- context managers cannot enable BYOK themselves.

Sensitive values use replacement-only editing. A context manager may enter or replace an API key but may not reveal the existing key.

### Settings UI

Add two settings UI areas:

- an admin BYOK management section for enablement/status;
- a context BYOK credentials section for enabled contexts.

The existing global System (LLM) section remains the global credential editor and is unchanged in purpose.

### LLM Callers

Update every context-bound LLM caller to use the shared resolver:

- main orchestrator;
- proactive/deferred prompt generation;
- conversation trimming;
- web distillation;
- embeddings;
- group-history lookup.

Callers that currently lack a config context ID must receive it explicitly. Silent fallback to global settings is not allowed when BYOK is enabled for the relevant context.

## Data Flow

1. Bot admin enables BYOK for a personal or group config context.
2. User or group manager opens `/config` and sees the BYOK credential section.
3. Manager saves the required LLM API key, base URL, and main model, plus optional small and embedding models.
4. Server validates the submitted fields and writes the encrypted BYOK payload.
5. A context LLM call starts and resolves the effective config through the shared resolver.
6. Resolver returns global config, complete BYOK config, or a typed missing/error result.
7. Caller either invokes the model with the resolved credentials or reports setup guidance without falling back to global credentials.

## Error Handling

Disabled BYOK contexts keep the current global behavior. Missing global required keys still produce the existing bot-misconfigured behavior.

Enabled BYOK contexts fail closed:

- Missing required BYOK fields block the context's LLM call with a clear setup message.
- Invalid credentials or provider errors do not fall back to global credentials.
- Unreadable encrypted BYOK payloads are treated as configuration errors and logged without secret values.

Suggested user-facing message for incomplete BYOK:

```text
BYOK is enabled for this context, but required LLM settings are missing. Use /config to complete API key, base URL, and main model.
```

## Security And Privacy

- BYOK credentials are encrypted at rest using the same key material strategy as instance configs.
- API keys are never returned in plaintext after save.
- Settings responses mask sensitive values and expose only `hasValue`/masked forms.
- Logs may include config context ID, source (`global` or `byok`), and model IDs where already logged.
- Logs must never include API keys, encrypted payloads, or raw credential values.
- Admin status views show enabled/disabled, complete/incomplete, last updated, and updated by.
- Usage telemetry continues recording model and context as today. It does not add provider account identity.

## Testing

Server tests:

- BYOK disabled resolves global config.
- BYOK enabled with complete credentials resolves BYOK config.
- BYOK enabled with missing required fields returns a blocking/missing result.
- Optional `small_model` and `embedding_model` fall back to BYOK `main_model` when omitted.
- Context managers can edit enabled BYOK fields for their own personal or managed group context.
- Context managers cannot edit BYOK fields before admin enablement.
- Bot admins can enable/disable BYOK and see masked status.
- Stored secrets are encrypted at rest and masked in responses.
- Main orchestrator and representative helper paths use the resolver rather than direct `system_config` reads.

Client tests:

- Admin BYOK section lists users/groups and toggles enablement.
- Context BYOK section appears only when enabled.
- Sensitive fields use replacement-only UI and do not show raw stored secrets.
- Incomplete BYOK state is visible and actionable.

Regression tests:

- Non-BYOK users keep using global config.
- Existing global System (LLM) admin screen remains unchanged.
- Stats and anonymity routes do not expose BYOK credential content.

## Acceptance Criteria

- A bot admin can enable or disable BYOK for a selected personal or group config context.
- An enabled context manager can save the same LLM fields available globally.
- A disabled context uses global LLM settings unchanged.
- An enabled complete context uses BYOK credentials for all context LLM calls.
- An enabled incomplete context blocks LLM calls with setup guidance and does not spend global credentials.
- BYOK credentials are encrypted at rest and never displayed in plaintext after save.
- Existing global LLM configuration and non-BYOK behavior remain compatible.
