<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Plugin tool-gate port (core separation phase 0/1)

## 1. Port

- [ ] 1.1 Failing `tests/ports/tool-gate.test.ts`, then
      `src/ports/tool-gate.ts` (`ToolGate`, `ToolGateRegistry`,
      `createToolGateRegistry`, singleton).
      Verify: `bun test tests/ports/tool-gate.test.ts`

## 2. Declaration + bridge

- [ ] 2.1 Failing `tests/plugins/tool-gate-registration.test.ts`, then
      `gate?: 'operator'` on `PluginTool` in
      `src/plugins/runtime-types.ts` and
      `src/plugins/tool-gate-registration.ts` (`registerToolGates`).
      Verify: `bun test tests/plugins/tool-gate-registration.test.ts`
- [ ] 2.2 Call `registerToolGates(pluginId, contributions.tools)` inside
      `buildPluginToolSet` (`src/plugins/contributions.ts`).
      Verify: `bun test tests/plugins/` (no regression)

## 3. Registry-driven filter

- [ ] 3.1 Write `tests/llm-orchestrator-who-may-use.test.ts` (registry
      drives gating; behavior identical); refactor
      `applyWhoMayUseFilter` to accept the registry; delete
      `ACP_SESSION_ACTION_TOOLS`.
      Verify: `bun test tests/llm-orchestrator*` and
      `rg 'ACP_SESSION_ACTION_TOOLS' src tests` returns nothing

## 4. acp declarations

- [ ] 4.1 Failing `tests/plugins/acp-tool-gates.test.ts`, then
      `gate: 'operator'` on `start_session`, `finish_session`,
      `cancel_session`, `answer_permission` (`plugins/acp/session-tools.ts`)
      and `continue_session` (`plugins/acp/continue-tool.ts`), plus the
      local `Tool` type in `plugins/acp/tools.ts`.
      Verify: `bun test tests/plugins/`
- [ ] 4.2 Operator note: acp manifest hash changes → re-approve the acp
      plugin in the settings UI after deploy.
      Verify: manual spot-check (optional pre-merge)

## 5. Guard + gate

- [ ] 5.1 Create `tests/architecture-guard.test.ts` (`src/ports/**`
      feature-agnostic; no `plugin_acp__` / `ACP_SESSION_ACTION_TOOLS` in
      `llm-orchestrator-tools.ts`).
      Verify: `bun test tests/architecture-guard.test.ts`
- [ ] 5.2 Full `bun test`, `bun run check:full` (typecheck, lint,
      format:check); run `bun run format` before committing.
      Verify: all pass
