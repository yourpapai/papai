<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: Plugin System Implementation

**Status:** mvp_implemented
**Updated:** 2026-05-23
**Plan:** `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md`
**Spec:** `docs/superpowers/specs/2026-03-30-plugin-system-design.md`

## Completed MVP Scope

The trusted-local plugin-system MVP is implemented in this branch. It supports repository-local plugin discovery from `plugins/<plugin-id>/plugin.json`, admin approval, startup activation, context-scoped enablement, context-scoped required config gating, plugin tools, prompt fragments, commands, scheduled jobs, plugin KV, and runtime diagnostics.

Canonical migration state:

- Registered plugin migration: `src/db/migrations/039_plugins.ts`
- Registered from: `src/db/index.ts`
- Removed stale unregistered migration stub: `src/db/migrations/028_plugins.ts`

## Phase Status Matrix

| Phase / area                                         | Status           | Evidence                                                                                                                               |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: types and manifest validation               | Complete for MVP | Manifest schema, strict factory contract, declared contribution validation, and path/id hardening are covered.                         |
| Phase 2: database schema and storage                 | Complete for MVP | Plugin admin/context/KV/runtime-event storage uses canonical migration `039_plugins`.                                                  |
| Phase 3: discovery                                   | Complete for MVP | Missing directory, invalid JSON, id mismatch, unsafe entry paths, symlink rejection, and deterministic ordering are covered.           |
| Phase 4: registry and compatibility evaluation       | Complete for MVP | Durable approval state is separated from transient runtime state; compatibility is recomputed; context config eligibility is enforced. |
| Phase 5: context builder and facades                 | Complete for MVP | Tool, prompt, command, job, KV, logger, and task facade surfaces are narrow and declaration-gated.                                     |
| Phase 6: loader and lifecycle management             | Complete for MVP | Activation success/failure, timeout cleanup, strict factory loading, diagnostics, and deterministic deactivation are covered.          |
| Phase 7: tool integration                            | Complete for MVP | Plugin tools are assembled per active context with runtime provider/user facades.                                                      |
| Phase 8: prompt integration                          | Complete for MVP | Prompt fragments are context-gated, delimited, and budgeted.                                                                           |
| Phase 9: commands and interactions                   | Complete for MVP | `/plugin`, namespaced plugin commands, and `plg:` enable/disable callbacks are covered.                                                |
| Phase 10: `/config` context opt-in and plugin config | Complete for MVP | Plugin config requirements render in `/config`; sensitive values are masked; missing required config gates exposure.                   |
| Phase 11: startup and shutdown integration           | Complete for MVP | Startup discovery/activation and shutdown deactivation are wired.                                                                      |
| Phase 12: docs and examples                          | Complete for MVP | Developer guide and hello-world example document the implemented surface.                                                              |
| Phase 13: end-to-end lifecycle tests                 | Complete for MVP | `tests/plugins/integration.test.ts` covers discover → approve → activate → opt-in → tool/prompt → deactivate plus failure paths.       |

## True Follow-Ups

- Untrusted third-party sandboxing and process isolation.
- Marketplace or package-based plugin distribution.
- Encrypted plugin secret storage.
- Hot reload or restartless approval/rejection activation.
- Provider-as-plugin migration for chat or task providers.
- Async prompt fragment support.
- Raw network/web-fetch facades for plugins, if a future security design allows them.
- Richer command menu publishing for plugin commands on platforms that support command menus.
- Optional runtime UI for plugin job status and last-run metadata.

## Validation Status

Task 9 adds final lifecycle coverage and documentation sync. Final branch validation is tracked in `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md` and should use:

```bash
bun check:full
bun security
```
