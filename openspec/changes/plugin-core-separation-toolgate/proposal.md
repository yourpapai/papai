<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Plugin tool-gate port (core separation phase 0/1)

## Why

`applyWhoMayUseFilter` (`src/llm-orchestrator-tools.ts:44,61`) gates ACP
session-action tools via a hardcoded `ACP_SESSION_ACTION_TOOLS` set —
core orchestration code naming a specific plugin's tools. The
plugin-core-separation design (Phase 0/1) decouples this: plugins declare
`gate: 'operator'` on their tools, a `ToolGateRegistry` port collects
them, and the who-may-use filter becomes registry-driven. The plugin
system shipped without this foundation; the hardcoded set remains a
layering violation and a per-plugin edit point.

## What Changes

- New `src/ports/tool-gate.ts`: `ToolGate` type, `ToolGateRegistry`
  interface, `createToolGateRegistry` factory + singleton; tests.
- `gate?: 'operator'` added to `PluginTool` (`src/plugins/runtime-types.ts`)
  and a `registerToolGates` bridge
  (`src/plugins/tool-gate-registration.ts`) invoked from
  `buildPluginToolSet` in `src/plugins/contributions.ts`.
- `applyWhoMayUseFilter` refactored to accept the gate registry;
  `ACP_SESSION_ACTION_TOOLS` deleted.
- `gate: 'operator'` declared on the ACP plugin's five session-action
  tools (`start_session`, `finish_session`, `cancel_session`,
  `answer_permission`, `continue_session`) — this changes the plugin
  manifest hash, so the acp plugin must be re-approved in the settings UI.
- New ratcheting `tests/architecture-guard.test.ts`: `src/ports/**` stays
  feature-agnostic; no `plugin_acp__` / `ACP_SESSION_ACTION_TOOLS`
  references in `llm-orchestrator-tools.ts`.

## Capabilities

### New Capabilities

- `plugin-tool-gate-port` — registry-driven operator gating of
  plugin-contributed tools, replacing core's hardcoded per-plugin sets.

### Modified Capabilities

None. `openspec/specs/` has no entries for plugin/tool surfaces.

## Non-goals

- No new gate kinds beyond `'operator'`; no per-tool permission changes
  for other plugins.
- No changes to `tool_prefs` resolution — the gate is orthogonal (who-may-use
  guardrails, not per-context permissions).
- No Phase 2+ separation work (modules/ports/composition beyond
  `ports/tool-gate.ts`) — that lives on the `plugin-core-separation`
  branch under the sibling hermetic changes.
- No settings-UI changes (only the re-approval note for the acp plugin).

## Impact

- **Code:** new `src/ports/tool-gate.ts`,
  `src/plugins/tool-gate-registration.ts`, guard test; edits to
  `src/plugins/runtime-types.ts`, `src/plugins/contributions.ts`,
  `src/llm-orchestrator-tools.ts`, `plugins/acp/tools.ts`,
  `plugins/acp/session-tools.ts`, `plugins/acp/continue-tool.ts`.
- **Plugin manifest:** acp manifest hash changes → settings-UI
  re-approval required after deploy.
- **Scope model / DB / deps:** none.
- **Tool gating:** same effective behavior (operator guardrails on the
  same five tools), delivered via registry instead of a hardcoded set.
- **Legacy:** adopts
  `docs/superpowers/plans/2026-07-08-plugin-core-separation-phase-0-1-foundation-toolgate.md`
  - its `remaining/` brief (delete-on-adopt); the parent design spec moves
    to `docs/archive/` (arc now fully tracked by this and the two hermetic
    changes).
