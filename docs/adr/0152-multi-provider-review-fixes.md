<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0152: Multi-Provider Review Fixes

## Status

Implemented

## Date

2026-05-28 – 2026-05-28

## Context

After the multi-provider instance model (ADR-0124) and admin surface
(ADR-0127) shipped, a review revealed two production-relevant gaps in the
debug/admin API routes and the system summary:

1. **No config validation on write**: The instance POST and PATCH routes
   persisted any JSON object as `config`, even when it was missing
   descriptor-required fields (e.g. `token` for Telegram) or contained
   malformed URL values (e.g. `"not a url"` for `baseUrl`). Invalid rows
   silently entered `platform_instances` and `task_instances`, causing
   startup warnings or runtime failures when the router tried to construct
   providers from them.

2. **Env-derived provider display in `/admin/system`**: The
   `handleAdminSystem()` function read `CHAT_PROVIDER` and `TASK_PROVIDER`
   from `process.env` to populate the `chatProvider` and `taskProvider`
   response fields. After the migration to DB-backed instances (migration
   `040`), the DB — not env — is the source of truth for active providers.
   Bootstrap env vars are only consulted when the instance tables are empty.
   Displaying stale env values was misleading and could expose unsupported
   provider strings in the admin UI.

## Decision Drivers

- **Data integrity**: Invalid instance config rows must not persist. The
  point of closest control is the admin API, not downstream provider
  construction.
- **Consistency**: POST and PATCH must enforce the same validation rules.
  PATCH replaces config wholesale; accepting invalid config on PATCH is the
  same defect as accepting it on POST.
- **Descriptor parity**: Built-in descriptor validation and contributed
  task-provider `validateConfig` must both run before any DB write, in the
  same order, for both POST and PATCH.
- **Source-of-truth alignment**: After migration `040`, the instance tables
  are the single source of truth. The admin system summary must reflect
  actual DB state, not bootstrap env vars.

## Considered Options

### Option A: Validate only on POST

Accept any config on PATCH, rely on descriptor validation at provider
construction time to catch errors.

- **Pros**: Smaller change; PATCH remains flexible for partial updates.
- **Cons**: Invalid rows still persist; errors surface at startup rather
  than at write time; inconsistent with POST validation.

### Option B: Validate on POST and PATCH with a shared helper (chosen)

Add a debug-layer validation helper that checks descriptor-required fields
and URL well-formedness. Wire it into POST and PATCH for both platform and
task instances. For task instances, run descriptor validation before the
existing contributed `validateConfig`.

- **Pros**: Invalid config never reaches the DB; consistent validation
  semantics across all write paths; descriptor and contributed validators
  compose naturally.
- **Cons**: PATCH validation checks the incoming config against the full
  descriptor, not as a partial overlay; callers must supply a complete
  config on PATCH.

### Option C: PATCH partial-config merge with validation

On PATCH, merge the incoming partial config with the existing row, then
validate the merged result.

- **Pros**: Supports partial config updates.
- **Cons**: Merged config shape is ambiguous when fields are intentionally
  cleared; the current PATCH route replaces config wholesale, not
  partially; implementing merge logic is a design change beyond the
  scope of these fixes.

### Option D: Keep env-derived admin system display

Leave `/admin/system` reading `CHAT_PROVIDER`/`TASK_PROVIDER` from env.

- **Pros**: No change needed.
- **Cons**: The response drifts from actual DB state after migration `040`;
  unsupported env values (`signal`, `jira`) leak into the admin UI as
  `unknown` rather than being derived from the real instance rows.

## Decision

**Option B** for instance config validation, plus switching the admin
system summary to DB-derived provider display.

| Topic                        | Decision                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Validation helper            | `src/debug/instance-config-validation.ts` — stateless, no DB writes, no provider construction.             |
| Platform POST                | Call `validatePlatformInstanceConfig(type, config)` before `insertPlatformInstance`.                       |
| Platform PATCH               | Call `validatePlatformInstanceConfig(existing.type, body.config)` before `updatePlatformInstance`.         |
| Task POST                    | Call `validateTaskDescriptorInstanceConfig` then `validateTaskInstanceConfig` before `insertTaskInstance`. |
| Task PATCH                   | Call both validators on `body.config` before `updateTaskInstance`.                                         |
| URL validation               | Fields whose key ends in `url` (case-insensitive) are checked for `http:` or `https:` protocol.            |
| Missing fields               | Descriptor fields marked `required: true` with blank/undefined values are reported as `missing`.           |
| Error response shape         | `{ error, type, missing?, invalidUrls? }` with status 400.                                                 |
| Admin system provider source | `listPlatformInstances()` and `listTaskInstances()` replace env var reads.                                 |
| Multi-instance display       | One unique provider type → that type; zero or multiple types → `unknown`.                                  |
| Response shape unchanged     | `chatProvider`, `taskProvider`, `debugServer`, `adminUserSet` keys remain the same.                        |

## Consequences

### Positive

- Invalid instance config is rejected before it reaches the DB, preventing
  startup warnings and runtime provider-construction failures.
- Consistent validation across POST and PATCH eliminates the path where an
  operator could overwrite valid config with invalid config via PATCH.
- Descriptor and contributed validators run in the same order for both
  write paths, preserving `validateConfig` parity.
- The admin system summary reflects actual DB state, removing the drift
  between displayed providers and active instances.
- Unsupported bootstrap env values no longer appear in the admin UI.

### Negative

- PATCH requires a complete config object; partial config updates are not
  supported. Callers must send all descriptor-required fields even when
  only changing one field.
- The `singleKnownProvider` helper returns `unknown` when zero or multiple
  provider types exist in the instance tables. A multi-type deployment
  (e.g. both Telegram and Discord instances) shows `unknown` for
  `chatProvider` in the admin summary.

### Risks

- If a provider descriptor's `instanceConfigSchema` is incomplete (missing
  a required field declaration), the validation helper will not catch that
  field's absence. Mitigation: descriptor schemas are declared alongside
  provider construction and are already exercised at startup.
- URL validation uses `new URL()` parsing, which accepts some surprising
  but technically valid URLs (e.g. `http://`). This is acceptable because
  the goal is rejecting non-HTTP garbage, not enforcing full URL quality.

## Implementation Notes

Key modules:

| File                                      | Role                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/debug/instance-config-validation.ts` | Shared validation helper: descriptor field checks, URL well-formedness, error response construction                                            |
| `src/debug/instance-routes.ts`            | Wired `validatePlatformInstanceConfig` on POST/PATCH; `validateTaskDescriptorInstanceConfig` + `validateTaskInstanceConfig` on task POST/PATCH |
| `src/debug/admin-system.ts`               | Replaced `CHAT_PROVIDER`/`TASK_PROVIDER` env reads with `listPlatformInstances()`/`listTaskInstances()` via `singleKnownProvider`              |

The helper returns `Response | null`, matching existing route helper style.
On PATCH, validation runs only when `body.config` is present; `status`-only
PATCHes bypass config validation.

No new DB migrations. No changes to the instance data model or encryption.

## Related Decisions

- ADR-0124: Multi-Provider Phase 1 — Instance Data Model — established the
  DB-backed instance tables that this validation protects.
- ADR-0127: Multi-Provider Phase 4 — Admin and Dashboard — introduced the
  instance API routes that now enforce config validation.
- ADR-0150: Multi-Provider DB Integrity — earlier integrity hardening;
  this ADR extends validation to the admin API write paths.
