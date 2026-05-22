<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: Plugin System Implementation

**Status:** partially_implemented
**Updated:** 2026-05-22
**Plan:** `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md`
**Spec:** `docs/superpowers/specs/2026-03-30-plugin-system-design.md`

## Current baseline

The plugin framework is no longer unimplemented. The current branch already contains the core plugin directory, schema, startup wiring, tool/prompt hooks, admin command, config toggle surface, and developer docs.

Canonical migration state:

- Registered plugin migration: `src/db/migrations/039_plugins.ts`
- Registered from: `src/db/index.ts`
- Removed stale unregistered migration stub: `src/db/migrations/028_plugins.ts` (deleted 2026-05-22 to avoid accidental imports)

## Phase status matrix

| Phase / area | Status | Evidence / remaining gap |
| --- | --- | --- |
| Phase 1: types and manifest validation | Mostly present | `src/plugins/types.ts` exists, but tests still need directory mismatch, duplicate contributions, and contract coverage. |
| Phase 2: database schema and storage | Mostly present | `src/db/plugin-schema.ts`, `src/plugins/store.ts`, and registered migration `039_plugins` exist; `028_plugins.ts` has been removed so `039_plugins` is the canonical migration. |
| Phase 3: discovery | Partial | Discovery exists, but invalid JSON, missing dir, symlink/path escape, duplicate ID, and deterministic ordering coverage are still missing or thin. |
| Phase 4: registry and compatibility evaluation | Partial | Approval and capability checks exist, but runtime states are still persisted and required config is not yet part of context eligibility. |
| Phase 5: context builder and service facades | Partial | KV/log/tool/prompt registration exist. Jobs, commands, task/chat facades, strict thrown rejection, and deep-freeze guarantees are incomplete. |
| Phase 6: loader and lifecycle management | Partial | Import, timeout, failure isolation, and reverse deactivation exist, but success-path, cleanup, factory-shape, timeout, and reverse-order tests are incomplete. |
| Phase 7: tool integration | Partial | Tools are merged for active contexts, but plugin tool execution still lacks context-bound provider/user facades. |
| Phase 8: prompt integration | Mostly present | Prompt fragments are appended with budgets and delimiters, but active/inactive context coverage is still thin. |
| Phase 9: commands and interactions | Partial | `/plugin` and `plg:` routing exist, but admin UX, restart messaging, list/info details, and callback coverage are still thin. |
| Phase 10: `/config` context opt-in and plugin config | Partial | Plugin toggles appear, but plugin config requirements, sensitive masking, and missing-config gating are not implemented. |
| Phase 11: startup and shutdown integration | Partial | Discovery/activation/deactivation are wired in `src/index.ts`, but runtime-state re-evaluation semantics still need correction. |
| Base docs and examples | Mostly present | `docs/plugins/developer-guide.md` and `docs/plugins/examples/hello-world/` exist, but still need final runtime-contract sync. |
| Phase 13: end-to-end lifecycle tests | Missing | No discover → approve → compatibility → activate → opt-in → tool/prompt → deactivate integration coverage exists yet. |

## Missing targeted coverage

- Discovery failure-path tests for invalid manifests, missing directories, symlink/path escapes, duplicate IDs, and deterministic ordering.
- Loader lifecycle tests for cleanup, timeout handling, factory-shape validation, and reverse-order deactivation.
- Prompt/config/tool eligibility tests for active vs inactive contexts and required plugin config.
- `/plugin` admin UX and `plg:` callback coverage.
- Phase 13 end-to-end lifecycle coverage.

## Suggested next steps

1. Execute Task 2: fix registry persistence vs runtime state before adding new plugin surfaces.
2. Execute Task 3: align the plugin entry contract and context API with the approved design.
3. Continue through Tasks 4-9 in `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md`.
4. After implementation, add the missing targeted tests and the Phase 13 lifecycle suite.

## Explicit non-goals for the remaining MVP

- Untrusted third-party sandboxing.
- Encrypted plugin secret storage.
- Hot reload or restartless admin approval.
- Provider-as-plugin migration.
- Async prompt fragments.
