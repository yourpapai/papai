<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Plugin tool-gate port (core separation phase 0/1)

## Decisions

### D1: Port before registry consumer

`src/ports/tool-gate.ts` defines the feature-agnostic contract
(`ToolGate`, `ToolGateRegistry`, `createToolGateRegistry`, singleton).
Ports stay feature-agnostic — no `acp`, no plugin ids — enforced by the
new architecture-guard test (D5). This matches the separation design's
phase ordering: the port lands on master first, consumers follow.

### D2: Declaration on the plugin, collection in contributions

`gate?: 'operator'` is declared on `PluginTool` (runtime types) and on the
acp plugin's local `Tool` type for its five session-action tools.
`registerToolGates(pluginId, contributions.tools)` runs inside
`buildPluginToolSet`, so every plugin's gated tools register at
contribution-build time with no core edit per plugin. Adding the flag
changes the acp manifest hash: the plugin must be re-approved in the
settings UI after deploy (operator action; noted in tasks).

### D3: Registry-driven filter, same behavior

`applyWhoMayUseFilter(tools, whoMayUse, chatUserId, gateRegistry)` keeps
today's exact semantics — operator-allowlisted members keep gated tools,
everyone else loses them — but reads the gated set from the registry
instead of `ACP_SESSION_ACTION_TOOLS` (deleted). Grep for
`ACP_SESSION_ACTION_TOOLS` and `plugin_acp__` in
`llm-orchestrator-tools.ts` must return nothing.

### D4: Drift-check outcome

Runbook inventory's "shipped under different shape (`plugins/`)" applies
to the broader separation design, not this plan: the plugin system exists
but the toolgate foundation is genuinely absent (hardcoded set at
`src/llm-orchestrator-tools.ts:44`, no `src/ports/`). Code check wins;
Lane 1 stands.

### D5: Ratcheting guard

`tests/architecture-guard.test.ts` scans that `src/ports/**` contains no
feature references and core orchestration contains no plugin-specific
identifiers — a failing-loud fence so the violation cannot regrow.

### D6: Hooks/TDD and scope

Every task is test-first per the plan order (failing port test →
implementation → bridge → wiring → filter refactor → declarations →
guard). No DB, no scope-model impact, no `tool_prefs` change, no new
dependencies.
