<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# settings/debug

## Paths

- src/debug/admin-llm.ts
- src/debug/admin-plugin-config.ts
- src/debug/admin-schemas.ts
- src/debug/admin-system.ts
- src/debug/auth-routes.ts
- src/debug/billing-routes.ts
- src/debug/billing.ts
- src/debug/chat-router-runtime.ts
- src/debug/event-bus.ts
- src/debug/instance-admin-routes.ts
- src/debug/instance-config-validation.ts
- src/debug/instance-route-support.ts
- src/debug/instance-routes.ts
- src/debug/json-response.ts
- src/debug/llm-trace-collector.ts
- src/debug/log-buffer.ts
- src/debug/mcp-routes.ts
- src/debug/platform-provider-type-routes.ts
- src/debug/plugin-config-routes.ts
- src/debug/schemas.ts
- src/debug/server-route-support.ts
- src/debug/server.ts
- src/debug/settings-api-router.ts
- src/debug/settings-router.ts
- src/debug/settings-routes.ts
- src/debug/settings/admin/admin-guard.ts
- src/debug/settings/admin/instances-routes.ts
- src/debug/settings/admin/plugin-config-routes.ts
- src/debug/settings/admin/roster-plugins-routes.ts
- src/debug/settings/admin/system-access-routes.ts
- src/debug/settings/config-routes.ts
- src/debug/settings/context-task-instance-routes.ts
- src/debug/settings/group-routes.ts
- src/debug/settings/identity-routes.ts
- src/debug/settings/mcp-routes.ts
- src/debug/settings/plugins-routes.ts
- src/debug/settings/provision-routes.ts
- src/debug/settings/respond.ts
- src/debug/settings/tools-routes.ts
- src/debug/state-collector-utils.ts
- src/debug/state-collector.ts
- src/debug/stats-routes.ts
- src/debug/subject-display-name.ts
- src/debug/task-provider-type-routes.ts
- src/debug/turn-assembly.ts
- src/settings/auth-code-store.ts
- src/settings/config.ts
- src/settings/contexts.ts
- src/settings/cookies.ts
- src/settings/crypto.ts
- src/settings/issue-link.ts
- src/settings/principal.ts
- src/settings/rate-limit.ts
- src/settings/request-auth.ts
- src/settings/scope-guard.ts
- src/settings/session-store.ts

## Depends On

- chat
- deferred-prompts
- identity
- instances
- mcp/web
- memory/memos
- providers/plugins
- shared/runtime
- stats/usage
- tools

## Depended On By

- chat
- debug
- deferred-prompts
- identity
- llm-orchestrator
- memory/memos
- message-queue
- providers/plugins
- shared/runtime
- stats/usage
