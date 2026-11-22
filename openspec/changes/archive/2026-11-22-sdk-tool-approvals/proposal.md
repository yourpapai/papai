<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal

## Why

An `ask`-gated tool call is denied today by `gatedExecute` (`src/tools/permission-gate.ts:128`) returning a fabricated `{ status: 'permission_denied' }` **tool result**. The model never learns the user declined — it sees a failed tool and re-plans, often re-calling the same tool with a reworded `_permission_reason`. The pinned AI SDK (`ai` 7.0.179) has a native approval hook, so the last hand-rolled piece of the tool path can move onto it.

## What Changes

- Pass one per-invocation `toolApproval` resolver to `generateText`: tools whose resolved `tool_prefs` permission is `ask` await the existing chat confirmation (same buttons, same 5-minute timeout) and return `approved` or `{ type: 'denied', reason }`; every other exposed tool returns `not-applicable`.
- Approval runs **before** execution, inside the same `generateText` call: an allowed call executes unchanged; a denied call never executes and the SDK emits an `execution-denied` tool result the model can read. No second model call, no turn split.
- Remove `gatedExecute`; assembly exposes `ask` tools through the resolver instead of wrapping each `execute`, and tool execution stops producing the `permission_denied` result shape.
- Keep `_permission_reason` as the model-authored reason shown in the prompt; strip it before execution, as today.
- `tool_prefs` resolution is unchanged (`allow`/`ask`/`deny`, most-specific-wins); `deny` still removes the tool at assembly, and an `ask` tool with no chat surface still ends in a denial.
- Parity: a denial still surfaces as `permission_denied` in tool-terminal analytics and still counts as a tool failure for the verified-completion verdict.

## Capabilities

### New Capabilities

- `tool-permissions`: the durable contract for how a resolved permission becomes runtime behavior — `allow`, `ask` (prompt, timeout, no-surface denial), `deny` (removal), the approval boundary before execution, and what the model observes on a denial. Without it, the approval point (before vs inside execution), denial visibility, and the timeout/no-surface outcomes stay implicit in code and can regress silently.

### Modified Capabilities

None. No spec under `openspec/specs/` covers papai's tool permissions; the behavior lives in `src/tools/` and is documented in `docs/architecture/tools.md`.

## Non-goals

- SDK `user-approval` suspension and approval-replay turns (approvals that outlive the model call); the awaited resolver already gives model-visible denials.
- Persisting pending approvals across restart, an expiry policy beyond the current 5-minute deny timeout, or any settings-UI surface.
- Provider-executed approvals and signed approvals (`experimental_toolApprovalSecret`) — papai executes every tool itself.
- Changing `tool_prefs` semantics, presets, the guest-mode read-only toolset, `/stop`, or the confirmation prompt's content and masking.
- Removing `_permission_reason`.

## Impact

- Code: `src/tools/{permission-gate,index,tool-preferences,types}.ts`, `src/llm-orchestrator-{tools,types,invoke,tool-terminal}.ts`, `src/chat/permission-prompt.ts` (decision plumbing only), and their tests.
- Scope: `tool_prefs` stays keyed by the config context id derived from the turn's storage context (group-shared across a group's threads, per-DM otherwise); pending approval state is in-memory and thread-isolated. No per-user, platform-instance, task-instance, guest-mode, or durable permission change; every platform instance (Telegram, Mattermost, Discord, Kontur Talk) shares the same resolver. No DB migration, no new dependency, no settings-UI field.
- Docs: `docs/architecture/tools.md`, `src/tools/CLAUDE.md`, and the tool-permission prose in `docs/architecture/behaviors.md`.
