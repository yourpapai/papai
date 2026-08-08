<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2026 07 08 plugin core separation phase 0 1 foundation toolgate

**Status:** not_implemented
**Generated:** 2026-08-07
**Plan:** `docs/superpowers/plans/2026-07-08-plugin-core-separation-phase-0-1-foundation-toolgate.md`

## Completed

- Design spec exists (docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md) — planning artifact only, no code implemented
- applyWhoMayUseFilter function exists in src/llm-orchestrator-tools.ts (pre-refactor form, still using the hardcoded ACP_SESSION_ACTION_TOOLS set at lines 44,61)

## Remaining

- Task 1: ToolGatePort — create src/ports/tool-gate.ts (ToolGate type, ToolGateRegistry interface, createToolGateRegistry factory, toolGateRegistry singleton) + tests/ports/tool-gate.test.ts
- Task 2: Add gate?: 'operator' to PluginTool in src/plugins/runtime-types.ts; create src/plugins/tool-gate-registration.ts (registerToolGates bridge) + tests/plugins/tool-gate-registration.test.ts
- Task 3: Call registerToolGates(pluginId, contributions.tools) inside buildPluginToolSet in src/plugins/contributions.ts
- Task 4: Refactor applyWhoMayUseFilter in src/llm-orchestrator-tools.ts to accept gateRegistry param and delete ACP_SESSION_ACTION_TOOLS; create tests/llm-orchestrator-who-may-use.test.ts
- Task 5: Add gate?: 'operator' to local Tool type in plugins/acp/tools.ts; declare gate: 'operator' on start_session, finish_session, cancel_session, answer_permission (plugins/acp/session-tools.ts) and continue_session (plugins/acp/continue-tool.ts); create tests/plugins/acp-tool-gates.test.ts
- Task 6: Create tests/architecture-guard.test.ts (src/ports/** feature-agnostic scan + no plugin_acp__/ACP_SESSION_ACTION_TOOLS in llm-orchestrator-tools.ts)
- Task 7: Full verification — bun test, bun check:full, optional manual spot-check (requires re-approving the acp plugin in settings UI)

## Suggested Next Steps

1. Execute tasks in plan order with TDD: Task 1 (ports/tool-gate.ts + failing test first), then Task 2 (gate on PluginTool + registerToolGates bridge)
2. Task 3: wire registerToolGates into buildPluginToolSet and run bun test tests/plugins/ to confirm no regression
3. Task 4: registry-driven applyWhoMayUseFilter — delete any existing old-behavior test, write tests/llm-orchestrator-who-may-use.test.ts, remove ACP_SESSION_ACTION_TOOLS, verify rg 'ACP_SESSION_ACTION_TOOLS' src tests returns nothing
4. Task 5: declare gate: 'operator' on the five acp session-action tools; note this changes the plugin manifest hash so acp must be re-approved in the settings UI before a manual check
5. Task 6: add tests/architecture-guard.test.ts as the ratcheting regression fence
6. Task 7: run bun test and bun check:full; fix format issues with bun run format and re-run before committing
