<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Review Remediation - Phase 3: Full Provider Catalog Refactor

**Date:** 2026-05-26
**Status:** Proposed
**Parent:** [`2026-05-26-multi-provider-phase-2-db-integrity-first.md`](./2026-05-26-multi-provider-phase-2-db-integrity-first.md)
**Depends on:** Phase 1 hardening and Phase 2 integrity cleanup
**Ships independently:** No; this is a coordinated provider architecture refactor

## Summary

Finish the multi-provider abstraction by making chat and task provider metadata catalog-driven, schema-driven, and trait-driven. This phase removes hard-coded provider dropdowns, closes the plugin task-provider credential gap, removes provider-name checks from tool assembly, standardizes instance config keys, and prepares provider construction for future non-stateless providers.

The goal is not to add a new provider. The goal is to make adding the next provider boring.

## Goals

- Add a platform provider catalog and `/api/platform-provider-types` endpoint.
- Make task provider descriptors static and stop instantiating providers just to read capabilities.
- Replace provider-name checks in tools with explicit capabilities or provider traits.
- Standardize provider instance config around `baseUrl` and migrate legacy `url` values.
- Define and implement a complete credential model for plugin-contributed task providers.
- Make `/setup`, `/config`, and the wizard consume provider descriptors instead of hard-coded Kaneo/YouTrack unions.
- Make masking schema-driven for both platform and task instance configs.
- Introduce provider lifecycle expectations and optional resolver caching/pooling for providers that are not cheap stateless HTTP wrappers.

## Non-Goals

- Rewriting existing Kaneo or YouTrack operation implementations.
- Building a marketplace or loading third-party untrusted provider packages.
- Exposing raw DB, raw chat providers, raw task providers, or secrets to plugins.
- Changing the LLM-facing tool names except where a provider-specific tool is intentionally renamed or trait-gated.
- Adding cross-platform user identity merging.

## Catalog Model

### Provider Descriptor Shape

Introduce a shared descriptor shape for both chat and task provider catalogs:

```typescript
type ProviderConfigField = {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  scope: 'instance' | 'context'
}

type ProviderDescriptor<Capability extends string, Trait extends string> = {
  type: string
  displayName: string
  source: 'builtin' | { plugin: string }
  instanceConfigSchema: readonly ProviderConfigField[]
  contextConfigSchema: readonly ProviderConfigField[]
  capabilities: ReadonlySet<Capability>
  traits: ReadonlySet<Trait>
}
```

Task providers use task capabilities and task traits. Platform providers use chat capabilities and chat traits.

The split between `instanceConfigSchema` and `contextConfigSchema` is required because base URLs and bot tokens belong to the instance, while user tokens or workspace IDs may belong to a context.

### Builtin Task Provider Descriptors

Kaneo:

- Instance config: `baseUrl` required, `internalUrl` optional.
- Context config: `kaneo_apikey` required, `kaneo_workspace_id` required or auto-provisioned.
- Traits: `workspace-scoped`, `task-label-read-requires-provider-specific-api` if still needed after trait review.

YouTrack:

- Instance config: `baseUrl` required.
- Context config: `youtrack_token` required.
- Traits: `supports-command-language`, `custom-fields`.

The existing `CONFIG_REQUIREMENTS` exported by provider classes should either become descriptor input or be removed to avoid duplicate sources of truth.

### Builtin Platform Provider Descriptors

Telegram:

- Instance config: `token` required, sensitive.
- Capabilities/traits from the adapter's static metadata.

Mattermost:

- Instance config: `baseUrl` required, `token` required/sensitive.

Discord:

- Instance config: `token` required/sensitive.

The admin Instances page must render platform create/update forms from `/api/platform-provider-types`, just as task types are rendered from `/api/task-provider-types`.

## Plugin Task Provider Credentials

### Decision

Plugin task providers may declare both instance-level config and context-level config:

- `providerConfigSchema` becomes or maps to `instanceConfigSchema`.
- A new manifest field, for example `providerContextConfigSchema`, declares per-context credentials required to resolve the provider for a user/group.

If backward compatibility is needed for existing plugins, keep `providerConfigSchema` as the instance schema and default `providerContextConfigSchema` to empty.

### Storage

Context-level plugin provider credentials should reuse the existing plugin config namespacing:

```text
user_config.key = plugin:<pluginId>:provider:<key>
```

The API should be exposed through existing `/config` and setup flows, not through the admin instance form. Admins configure instance fields; users or group managers configure context credentials.

### Resolver Behavior

`TaskProviderResolver.resolve(contextId)` builds config in this order:

1. Load assigned task instance.
2. Load descriptor for `instance.type`.
3. Validate required instance config from `task_instances.config`.
4. Validate required context config from `user_config` or plugin config storage.
5. Merge instance and context config into the factory input.
6. Return provider or `null` with structured missing-config diagnostics.

Builtins should use the same path as plugin providers. Kaneo/YouTrack-specific builders may remain as small adapters until their config keys are fully descriptor-driven.

## Trait-Driven Tool Assembly

Remove direct provider-name checks from tool construction.

Current examples:

- `provider.name === 'kaneo'` in label helpers.
- `provider.name === 'youtrack'` for `apply_youtrack_command`.

Replacement options:

- Add explicit task capabilities when the tool can be generalized, such as `tasks.commands`.
- Add task traits when behavior is provider-family-specific but not a capability, such as `command-language:youtrack` or `task-labels:separate-read-api`.
- Rename provider-specific tools only if they expose provider-specific semantics. For example, `apply_youtrack_command` can stay YouTrack-named but must be gated by a descriptor trait, not by `provider.name`.

Provider names remain identifiers for logging and registry lookup. They must not be used as behavioral feature flags.

## Static Capabilities

`listTaskProviderTypes()` must not instantiate built-in providers with empty config to read `.capabilities`.

Refactor provider registry to store metadata next to factories:

```typescript
type TaskProviderRegistration = {
  factory: TaskProviderFactory
  descriptor: TaskProviderTypeDescriptor
}
```

`createProvider(type, config)` uses the factory. Catalog endpoints use descriptors only.

This makes catalog GET safe for providers that perform validation, allocate clients, open sockets, or read config during construction.

## Config Key Standardization

Standardize instance config keys:

- Use `baseUrl` for all URL-bearing providers.
- Use `internalUrl` only when a provider needs a separate internal API URL.
- Stop writing new `url` fields in bootstrap.

Migration:

- For every platform/task instance config, if `baseUrl` is absent and `url` is present, copy `url` to `baseUrl`.
- Preserve `url` for one compatibility release if desired, but runtime code should write and display `baseUrl` only.
- Remove `resolveBaseUrl(config['baseUrl'] ?? config['url'])` fallback after the compatibility window.

## Wizard And Config Refactor

Replace hard-coded task provider unions in `src/wizard/engine.ts`, `src/wizard/steps.ts`, and `src/wizard/state.ts` with descriptor-driven steps.

Required behavior:

- Setup asks the user to select a task instance as today.
- The assigned task instance type resolves to a descriptor.
- Wizard steps are generated from `contextConfigSchema` plus general preferences like timezone.
- `/config` lists fields from the descriptor, not from `ConfigKey` hard-coded maps.
- Builtin sensitive fields retain current masking behavior.
- Plugin provider context credentials appear in the same config editor flow.

`ConfigKey` can remain for core built-in preference keys, but provider context config should not be blocked by a closed union. The config editor needs a typed field model that can represent builtin and plugin/provider dynamic keys safely.

## Schema-Driven Masking

Replace key-regex masking for instance config with descriptor-aware masking:

- Platform instance GET masks according to the platform descriptor's `instanceConfigSchema.sensitive` fields.
- Task instance GET masks according to the task descriptor's `instanceConfigSchema.sensitive` fields.
- Unknown fields default to masked for safety when the descriptor is unavailable or the provider type is unknown.

The existing regex may remain as a defensive fallback, but it must not be the primary masking mechanism.

## Provider Lifecycle And Resolver Caching

Document provider factory expectations:

- Factories should be cheap and side-effect-free unless the registration declares lifecycle behavior.
- Providers that own sockets, SDK clients, or expensive resources must expose lifecycle or be pooled by the resolver.

Add optional resolver caching keyed by:

```text
contextId + taskInstanceId + taskInstance config version/hash + context config version/hash
```

Phase 1 invalidation already clears tool caches. Provider cache invalidation must additionally respond to task instance config/status changes and context credential changes.

If no expensive providers exist yet, implement only the descriptor/lifecycle contract and leave pooling as a documented extension point.

## API Changes

Add:

```text
GET /api/platform-provider-types
GET /api/task-provider-types
```

Update existing task provider type response to include separate instance/context schemas and traits. Existing clients should be migrated with the admin UI in the same phase.

Potential response shape:

```json
{
  "type": "youtrack",
  "displayName": "YouTrack",
  "source": "builtin",
  "instanceConfigSchema": [
    { "key": "baseUrl", "label": "YouTrack URL", "required": true, "sensitive": false, "scope": "instance" }
  ],
  "contextConfigSchema": [
    { "key": "youtrack_token", "label": "YouTrack Token", "required": true, "sensitive": true, "scope": "context" }
  ],
  "capabilities": ["tasks.commands"],
  "traits": ["custom-fields", "command-language:youtrack"]
}
```

## Error Handling

| Condition                                                   | Behavior                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Descriptor missing for assigned provider type               | Resolver returns `null`; logs unknown provider type; setup/admin shows provider unavailable |
| Required instance config missing                            | Admin API rejects activation or resolver reports instance misconfigured                     |
| Required context config missing                             | LLM turn replies with `/setup` guidance listing descriptor labels                           |
| Unknown config field in admin form                          | Reject or preserve based on descriptor strictness; prefer reject for builtins               |
| Unknown provider type in persisted task instance            | Keep row readable, mask all config fields, block resolution                                 |
| Plugin provider disabled/unregistered after instance exists | Instance remains listed as unavailable; resolution returns `null`                           |

## Testing Strategy

- Registry tests: built-in task/platform descriptors are returned without constructing providers.
- Registry tests: contributed task provider descriptors include instance and context config schemas.
- Resolver tests: builtins and plugin providers resolve through descriptor-driven config merging.
- Resolver tests: missing plugin context credential returns missing-config behavior before factory invocation.
- Config editor tests: dynamic provider context fields render, validate, mask, and save.
- Wizard tests: wizard steps are descriptor-driven and no longer hard-code Kaneo/YouTrack unions.
- Admin client tests: platform provider dropdown renders from `/api/platform-provider-types`.
- Masking tests: sensitive descriptor fields are masked even if their key is `credential`; unknown fields default safe.
- Tool builder tests: provider-name spoofing does not enable Kaneo/YouTrack-specific behavior; capabilities/traits do.
- Migration tests: `url` is copied to `baseUrl` and new bootstrap writes `baseUrl`.
- Verification commands: focused suites, `bun test:client` for admin/config UI, `bun typecheck`, `bun lint:agent-strict -- <touched files>`.

## Acceptance Criteria

- Admin platform and task forms are fully descriptor-driven.
- Catalog endpoints do not instantiate providers to compute descriptors.
- Builtin and plugin task providers use the same resolver path for instance and context config requirements.
- Plugin-contributed task providers can declare and collect per-context credentials through setup/config.
- Tool exposure uses capabilities/traits, not provider-name string comparisons.
- New instance config writes use `baseUrl`; existing `url` rows are migrated or compatibility-tracked.
- Sensitive config masking is schema-driven and safe for unknown fields.

## Rollout Notes

This is the broadest phase and should not be mixed with Phase 2 table rebuilds. Land it only after the current dashboard and DB integrity behavior is stable. Because it touches setup, config, admin UI, plugins, resolver, and tool assembly, implementation should be split into small PRs behind descriptor compatibility shims where possible.
