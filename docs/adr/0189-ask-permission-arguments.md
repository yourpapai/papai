<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0189: Ask Permission Arguments

## Status

Implemented

## Date

2026-06-10

## Context

When a tool is configured with the `ask` permission (per-context `tool_prefs`, see ADR-0142), each invocation is gated by `gatedExecute` (`src/tools/permission-gate.ts`) which calls `AskPermissionFn` and renders a chat prompt via `askPermissionViaChat` (`src/chat/permission-prompt.ts`). Before this change the prompt showed only the tool name and an LLM-authored `_permission_reason` string — for example `🔐 Run \`delete*task\`?`followed by`Need to clean up completed tasks`. The user was asked to allow or deny a destructive or open-world action with no visibility into \_which* entity the action would target.

This was a real safety gap: a `delete_task` prompt gives the user no way to distinguish deleting task `task-123` from deleting `task-456`, and a `web_fetch` prompt hides the URL entirely. The 2026-06-10 design (`docs/superpowers/specs/2026-06-10-ask-permission-arguments-design.md`) specified extending the gate contract to carry the tool's cleaned arguments and rendering them in the prompt, with sensitive fields masked. The companion plan (`docs/superpowers/plans/2026-06-10-ask-permission-arguments.md`) is the task-by-task source of truth for the implementation described here.

## Decision Drivers

- **Informed consent:** the user must see _what_ a gated tool will act on, not just _that_ it will run, before choosing allow/deny.
- **No secret leakage:** values that look like API keys, tokens, passwords, or credentials must be masked before they reach the chat surface.
- **Readability in chat:** arguments must render as a flat key-value list (dotted keys for nested objects, comma-separated arrays) inside the existing single-button prompt, not as a JSON blob.
- **Backward compatibility:** the change is internal to the gate contract; no DB migration, no settings-UI change, no effect on already-configured `tool_prefs`.
- **No new tool surface:** the data already exists in `gatedExecute`'s `input`; the prompt is the right place to surface it rather than introducing a preview tool.

## Considered Options

### Option 1: Pass cleaned arguments through `AskPermissionFn` and format them in `formatPrompt` (chosen)

- **Pros:** Single source of truth — the same `cleaned` record `gatedExecute` already hands to `execute` is reused for display, guaranteeing the prompt reflects exactly what the tool will receive. No new tool, no extra round-trip. Masking lives next to the formatter that owns the prompt text.
- **Cons:** Widens the internal `AskPermissionFn` contract (a breaking change to three call sites). Argument formatting logic must be maintained in `permission-prompt.ts` alongside the prompt registry.

### Option 2: Keep the status quo — tool name + reason only

- **Pros:** Zero change; the gate contract stays minimal; prompt length stays bounded.
- **Cons:** Leaves the informed-consent gap open. Users must allow blind, or deny and re-ask. Unworkable for destructive tools where the target id is the only thing that matters.

### Option 3: Add a separate `preview_tool_args` meta-tool the LLM calls before `ask`-gated tools

- **Pros:** Keeps the prompt itself unchanged; the model decides when a preview is warranted.
- **Cons:** Requires an extra LLM round-trip per gated call, is non-deterministic (the model may skip it), and still needs the same masking/formatting logic to render the preview. Doubles the surface without improving on Option 1.

## Decision

Extend the `AskPermissionFn` contract to carry `args: Record<string, unknown>` and render them in the permission prompt, with sensitive-field masking and depth-capped flattening.

**1. Gate contract (`src/tools/permission-gate.ts`).** `AskPermissionFn` now accepts `{ toolName, reason, args }`. `gatedExecute` builds an `inputRecord` from the tool input, extracts `reason` via `extractReason`, strips `_permission_reason` via `omitReasonField` to produce `cleaned`, and calls `askPermission({ toolName, reason, args: cleaned })`. The same `cleaned` record is then passed to `execute`, so the runtime `_permission_reason` field never reaches the tool implementation and the prompt shows exactly the args the tool will receive. The `llm-orchestrator-tools.ts` binding needs no change — it already forwards the full request object.

**2. Argument formatting (`src/chat/permission-prompt.ts`).** A pure formatting layer is added: `isPlainObject` (excludes arrays), `flattenArguments` (dotted keys, depth capped at 3, `[Object]` sentinel beyond the cap), `formatArray` (comma-joined), `isSensitiveFieldName` (regex `/api[_-]?key|token|password|secret|credential/iu`), `maskValue` (values ≤7 chars → `***`; else first 3 + `...` + last 3), `maskSensitive` (prefix-based masking for values starting with `sk-`/`token-`/`password-`/`secret-`/`key-`), `formatValue` (null/undefined → `(empty)`; array → `formatArray`; object → `JSON.stringify`; explicit branches for function/symbol/bigint/boolean/number/string), and `formatArguments` (joins `key: value` lines with `\n`; empty → `''`). `formatValue` delegates masking to an extracted `applyMasking(str, fieldName)` helper that picks `maskValue` for sensitive field names and `maskSensitive` otherwise.

**3. Prompt assembly.** `formatPrompt(toolName, reason, args)` builds `🔐 Run \`tool\`?`, then an optional `**Arguments:**`block (omitted when`formatArguments`returns`''`), then the escaped reason last. `askPermissionViaChat`accepts`req.args`and forwards it to`formatPrompt`; the pending-request registry, 5-minute timeout, and `PromptHandle` path are unchanged.

## Consequences

### Positive

- Users see the specific target (task id, project, URL, assignee) of every `ask`-gated call before allowing or denying, closing the informed-consent gap.
- Sensitive fields are masked by default, reducing accidental secret exposure in chat history even when the LLM supplies a credential-bearing argument.
- Nested objects flatten to readable dotted keys (`assignee.name: John`); arrays render as comma-separated lists.
- No DB migration, no settings-UI change, no effect on existing `tool_prefs` — the only visible change is the enhanced prompt format.
- The `_permission_reason` runtime field is stripped before display and before `execute`, so it never leaks into the prompt or reaches the tool.

### Negative

- **Sensitive detection is heuristic.** Only field names matching `api[_-]?key|token|password|secret|credential` and values with the `sk-`/`token-`/`password-`/`secret-`/`key-` prefixes are masked. A field named `auth`, `pat`, `bearer`, or an opaque value with no recognized prefix renders in cleartext.
- **No per-value size cap in the shipped formatter.** The spec described truncating when the total prompt exceeds ~1500 characters, but the shipped `formatPrompt`/`formatArguments` do not implement a length cap; a tool returning a very large string argument (e.g., a fetched page body) could produce an oversized prompt. Platform chunking mitigates delivery, but the prompt can still grow large.
- **Masking is one-way.** A user who needs to verify a token's exact value cannot unmask it in the prompt.
- **Flattening depth is capped at 3.** Deeper structures collapse to `[Object]`, hiding detail a user might need to judge a destructive call.
- **Adds payload to every `ask`-gated prompt**, including tools whose args are trivially safe, slightly increasing prompt length and render cost.

### Risks

- A future field name not matching the sensitive regex will render in cleartext. Anyone adding credential-bearing tools should extend `isSensitiveFieldName` rather than relying on the model's reason.
- Because args are JSON-serializable from the LLM, circular references are impossible, but a tool whose schema permits an unbounded string/array argument can still blow up the prompt; the absence of a hard length cap is a latent risk tracked as a follow-up.

## Related Decisions

- ADR-0142: Tool Ask-Permission Gate — defines `gatedExecute`, `AskPermissionFn`, the `_permission_reason` field, and the `ask`/`deny`/`allow` permission tier this change extends.
- ADR-0182: Mattermost Buttons and Always-On Web Server — the self-removing permission-decision UX (`ephemeralConfirm` + `PromptHandle.remove`, `formatDecisionConfirmation`) that this prompt renders into; the argument section is appended to the same `reply.buttons(body)` payload whose callback prefix (`perm:a:`/`perm:d:`) ADR-0182 wired through `interaction-router.ts`.

## Implementation Notes

Key files, confirming presence:

- `src/tools/permission-gate.ts:92-96` — `AskPermissionFn` type carries `args: Record<string, unknown>`.
- `src/tools/permission-gate.ts:110-132` — `gatedExecute` builds `inputRecord`, extracts `reason`, omits `_permission_reason` into `cleaned`, passes `args: cleaned` to `askPermission`, then `execute(cleaned, options)`.
- `src/chat/permission-prompt.ts:15-32` — `isPlainObject` and `flattenArguments` (depth-capped at 3, dotted keys, `[Object]` sentinel).
- `src/chat/permission-prompt.ts:34-69` — `formatArray`, `isSensitiveFieldName`, `maskValue`, `maskSensitive`, `formatValue`, `applyMasking`.
- `src/chat/permission-prompt.ts:71-81` — `formatArguments` (exported).
- `src/chat/permission-prompt.ts:108-122` — `formatPrompt` (exported); skips the `**Arguments:**` section when `formatArguments` returns `''`.
- `src/chat/permission-prompt.ts:128-175` — `askPermissionViaChat` accepts `req.args` and forwards to `formatPrompt`; pending-request registry and timeout path unchanged.
- Tests: `tests/chat/permission-prompt.test.ts` (`formatArguments`/`formatPrompt` unit tests), `tests/tools/permission-gate.test.ts` (args captured and cleaned of `_permission_reason`), `tests/chat/interaction-router.test.ts` (pending permission now includes `args`).

**Divergence from the plan/spec.** The shipped `formatValue` is broader than the plan's single `String(value)` fallback: it has explicit branches for `function` → `[Function]`, `symbol` → `toString()`, `bigint`/`boolean`/`number`/`string` → masked string, and delegates masking to an extracted `applyMasking(str, fieldName)` helper. The sensitive-field and prefix regexes use the unicode `u` flag. There is no functional divergence in the prompt format or the gate contract; the prompt renders identically to the spec's example.
