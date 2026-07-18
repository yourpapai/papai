<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0142: Tool `ask` Permission Gate

## Status

Implemented

## Date

2026-05-29 – 2026-06-02

## Context

papai's per-tool permissions were binary: each tool in a context's `tool_prefs`
was either enabled (`allow`) or disabled (`deny`). This was too coarse for
destructive or sensitive operations (e.g. `delete_task`, `remove_attachment`)
where admins wanted the LLM to see the tool but not execute it without explicit
user confirmation each time.

The existing `tool_prefs` JSON blob stored `disabledDomains` (array of domain
names) and `toolOverrides` (map of tool name to boolean). There was no middle
ground between "always run" and "never show." Admins who wanted per-call
control had to deny the tool and invoke it manually — defeating the purpose of
LLM-driven task management.

The design spec
(`docs/archive/2026-05-29-tool-ask-permission-design.md`) and implementation
plan (`docs/archive/2026-05-29-tool-ask-permission.md`) introduced a tri-state
permission model with a synchronous inline-button prompt.

## Decision Drivers

- **Safety**: Destructive tools should not execute silently; a human must
  confirm each invocation.
- **LLM awareness**: The LLM must still see `ask`-gated tools so it can propose
  using them; the user decides at runtime.
- **Backward compatibility**: Existing `tool_prefs` blobs must keep working; no
  SQL migration or backfill.
- **Uniform application**: The gate must apply to built-in, plugin, and MCP
  tools alike.
- **Minimal orchestrator change**: One new optional callback; no change to the
  AI SDK call shape.
- **User control over persistence**: "Always allow" / "always deny" is a
  `/config` action, not a button on the prompt. Every `ask` call prompts again.

## Considered Options

### Option A: Asynchronous out-of-band approval queue

Queue tool calls for later approval; the LLM turn completes without the result
and re-enters when the user approves.

- **Pros**: Non-blocking; supports long review cycles.
- **Cons**: Breaks the synchronous LLM turn model; requires turn resumption
  logic; complex state management; poor UX for quick decisions.

### Option B: Synchronous inline-button prompt (chosen)

The LLM turn pauses, an Allow/Deny button prompt is posted, and the turn
resumes on click or timeout.

- **Pros**: Simple mental model; reuses existing `reply.buttons()` surface;
  turn completes in one shot; matches the AI SDK execution model.
- **Cons**: Blocks the turn for up to 5 minutes; in-memory registry lost on
  restart.

### Option C: Pre-approved tool whitelist in the system prompt

List approved tools in the system prompt; the LLM self-gates.

- **Pros**: No runtime gate code.
- **Cons**: The LLM can still call the tool; prompt-based gating is not a
  security boundary.

### Option D: Per-call permission in the prompt itself ("Allow always" button)

Add a third button to the prompt that persists the decision in `tool_prefs`.

- **Pros**: Fewer repeated prompts for trusted tools.
- **Cons**: Mixing one-time consent with persistent config complicates the
  prompt UX; accidental "always allow" is irreversible from the prompt; out
  of MVP scope.

## Decision

**Option B** for the prompt mechanism, with the following subsidiary decisions:

| Topic                   | Decision                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------- |
| Permission type         | Tri-state: `allow                                                                                                                                                                                   | ask | deny`. `allow`= exposed normally;`deny`= removed from ToolSet;`ask` = exposed with per-call gate. |
| Storage shape           | `ToolPrefs { domainDefaults: Partial<Record<ToolDomain, Permission>>, toolOverrides: Record<string, Permission> }`. Lazy migration from legacy `disabledDomains` + boolean overrides at parse time. |
| Resolution order        | `toolOverrides[name]` > `domainDefaults[meta.domain]` > `'allow'` default. Plugin/MCP tools (no metadata) use only steps 1 and 3.                                                                   |
| Gate location           | Per-tool `execute` wrapping inside `applyToolPreferences()` in `src/tools/index.ts`.                                                                                                                |
| Schema extension        | `ask` tools get `_permission_reason` (string, 1–280 chars) added to input schema; gate strips it before forwarding.                                                                                 |
| Prompt format           | `🔐 Run \`<tool>\`?` + reason paragraph + Allow/Deny buttons.                                                                                                                                       |
| Callback wire format    | `perm:a:<8-char-id>` (Allow), `perm:d:<8-char-id>` (Deny). 8-char base64url ID from `randomBytes(6)`.                                                                                               |
| Timeout                 | 5 minutes; resolves as Deny; prompt edited to show timeout.                                                                                                                                         |
| Missing `askPermission` | Deny (safe fallback for proactive mode and test harnesses).                                                                                                                                         |
| Cache strategy          | Cache pre-permission tool descriptors; apply `applyToolPreferences()` each turn so the per-turn `askPermission` closure is captured fresh.                                                          |
| Cycling UI              | `allow → ask → deny → allow` on each tap (domain or tool). `cycleDomain` clears per-tool overrides in that domain.                                                                                  |
| System prompt fragment  | Lists `ask`-gated tool names and instructs the LLM to include `_permission_reason`. Omitted when no tool is `ask`.                                                                                  |
| External pseudo-domain  | Plugin (`plugin_*__*`) and MCP (`mcp_*__*`) tools appear under "External" in the config UI; no bulk-toggle, only per-tool cycling.                                                                  |
| Process restart         | In-memory pending-request registry; stale clicks hit "expired" branch. No recovery flow.                                                                                                            |

## Consequences

### Positive

- Destructive tools can be exposed to the LLM without silent execution; the
  human remains in the loop per call.
- Backward-compatible: existing `tool_prefs` blobs migrate lazily at parse
  time; no SQL migration needed.
- Uniform gate for built-in, plugin, and MCP tools — no special-casing.
- Single tap to approve or deny; LLM turn completes in one shot.
- System prompt fragment ensures the LLM supplies a user-facing reason,
  improving transparency.
- Cache split keeps tool-build cache hit rate; only the lightweight
  `applyToolPreferences` runs each turn.

### Negative

- An `ask` tool blocks the LLM turn for up to 5 minutes; other queued
  messages wait.
- In-memory registry lost on process restart; a click on a stale prompt
  shows "expired" instead of executing.
- No "always allow" / "always deny" from the prompt itself — user must open
  `/config` to change persistent state.
- One more callback prefix (`perm:`) in the interaction router.

### Risks

- The 5-minute timeout is hard-coded; if users need longer review cycles,
  a configurable timeout is a follow-up.
- The in-memory registry grows with concurrent pending requests; in practice
  the LLM processes calls sequentially so the registry holds at most one entry
  at a time.
- The `_permission_reason` field is LLM-supplied and shown verbatim; a
  compromised or confused LLM could produce misleading reasons. Mitigated by
  the 280-char cap and the user's ability to deny any call.

## Implementation Notes

Key modules:

| File                                          | Role                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/permission-gate.ts`                | `gatedExecute`, `buildPermissionDenied`, `extendSchemaForAsk`, `AskPermissionFn` type                                            |
| `src/tools/tool-preferences.ts`               | Tri-state `ToolPrefs`, `resolveToolPermission`, `parseToolPrefs` (lazy migration), `cycleDomain`/`cycleTool`, `getDomainSummary` |
| `src/tools/types.ts`                          | `MakeToolsOptions.askPermission` field                                                                                           |
| `src/tools/index.ts`                          | `applyToolPreferences()` wraps `ask` tools; `buildToolDescriptors()` for pre-permission cache                                    |
| `src/llm-orchestrator-tools.ts`               | Caches descriptors; applies prefs per turn with per-turn `askPermission` closure                                                 |
| `src/llm-orchestrator.ts`                     | Constructs `askPermission` closure bound to `reply`                                                                              |
| `src/chat/permission-prompt.ts`               | Pending-request registry, `askPermissionViaChat`, 5-min timeout                                                                  |
| `src/chat/permission-interaction-handler.ts`  | `handlePermissionInteraction` for `perm:` callbacks, `canManageTargetContext` gate                                               |
| `src/chat/interaction-router.ts`              | Routes `perm:` callbacks                                                                                                         |
| `src/system-prompt.ts`                        | `ask`-tools fragment listing gated tool names                                                                                    |
| `src/commands/tool-config-view.ts`            | 3-state markers, External pseudo-domain, footer hint                                                                             |
| `src/chat/tool-toggle-interaction-handler.ts` | `cycleDomain`/`cycleTool` replaces `toggleDomain`/`toggleTool`                                                                   |
| `src/commands/config.ts`                      | Tools summary counts `blocked` and `ask` separately                                                                              |

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin tools flow through the same
  `applyToolPreferences()` gate as built-in tools.
- ADR-0009: Multi-Provider Task Tracker Support — the `tool-metadata.ts`
  domain classification that `resolveToolPermission` builds on.
- ADR-0014: Multi-Chat Provider Abstraction — `reply.buttons()` surface used
  by the permission prompt.
