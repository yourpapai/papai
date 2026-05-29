<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool `ask` permission — design

## Summary

Today each tool in a context's `tool_prefs` is a boolean: enabled or disabled. This design adds a third state, `ask`, producing a tri-state per-tool permission `allow | ask | deny`. `deny` removes the tool from the LLM's `ToolSet` (today's "disabled" behavior). `allow` exposes it normally (today's "enabled"). `ask` exposes it but suspends each call behind an inline-button prompt sent to the user; the call runs only after the user clicks **Allow**, returns a structured `permission_denied` result on **Deny**, and treats a 5-minute timeout as Deny.

The change is intentionally backwards-compatible: existing `tool_prefs` blobs are read as before via lazy migration at parse time, the `/config → 🧰 Tools` UI keeps its two-level navigation, and the orchestrator's hot path adds one optional callback and one synchronous wrap step per `ask` tool.

## Goals

- Add `ask` as a per-tool and per-domain permission, alongside the existing `allow`/`deny`.
- Make the gate synchronous: the LLM turn pauses, the user gets a one-tap Allow/Deny prompt, the turn resumes.
- Apply uniformly to built-in tools, plugin tools, and MCP tools.
- Preserve today's `/config → 🧰 Tools` UX shape (domain list → drill-in → cycle) and storage location (`tool_prefs` config key).
- Keep the orchestrator change small: one new optional `MakeToolsOptions` field, one new wrapper, no changes to the AI SDK call shape.

## Non-goals

- "Allow always" / "Deny always" persistence on the prompt itself. Decision: every `ask` call asks again; the user changes the persistent state via `/config`.
- A new SQL table or migration. `tool_prefs` continues to live in the per-context JSON config blob.
- A separate permission model for plugin tools. The existing `PLUGIN_PERMISSIONS` activation gate is unchanged; `ask` is an orthogonal per-call user gate.
- Cross-context permission inheritance. Each context has its own `tool_prefs`, same as today.
- Surviving a process restart. The pending-request registry is in-memory; a click on a stale button after restart hits an "expired" branch.

## Decisions

| Question                | Decision                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| UX                      | Synchronous inline-button prompt (Claude Code-style); the LLM turn is held open until the user clicks or the timer fires |
| Buttons                 | Two buttons only: **Allow** / **Deny**. No "always" persistence on the prompt.                                           |
| Granularity             | Per-domain default + per-tool override (mirrors today's structure, generalized from boolean to tri-state)                |
| Eligibility             | All tools: built-in (`tool-metadata.ts`-classified), plugin (`plugin_*__*`), and MCP (`mcp_*__*`)                        |
| Timeout                 | 5 minutes; timeout resolves as Deny and returns `permission_denied` to the LLM                                           |
| Prompt content          | Tool name + LLM-supplied `_permission_reason` string (no raw args)                                                       |
| Default for unset tools | `allow` (no behavior change for existing users)                                                                          |
| `askPermission` missing | Treat as Deny (safer than allow; covers proactive mode and tests)                                                        |
| Implementation locus    | Per-tool `execute` wrapping inside `applyToolPreferences()` (Approach A)                                                 |

## Architecture

```text
User message
  -> ChatRouter
  -> bot.ts -> message queue
  -> llm-orchestrator-tools.ts
       prepareLlmInvocation()
         constructs askPermission closure bound to (reply, contextId)
         calls makeTools(provider, { ..., askPermission })
       -> makeTools()
            buildTools + MCP + plugin merge
            applyToolPreferences()
              for each tool in final set:
                perm = resolveToolPermission(prefs, name)
                'deny'  -> drop
                'allow' -> keep
                'ask'   -> wrap execute with permission gate
                          extend schema with _permission_reason
       -> generateText / streamText
            on each ask-marked tool call:
              gate posts prompt via askPermission()
                 -> chat/permission-prompt.ts registers PendingRequest
                 -> reply.buttons() -> "[Allow] [Deny]"
              gate awaits Promise<'allow'|'deny'>
                 click  -> handlePermissionInteraction resolves promise
                 timer  -> resolves 'deny' after 5 min
              'allow' -> original execute runs
              'deny'  -> return { status: 'permission_denied', message }
```

The orchestrator does not change shape. The only new wire is `askPermission` flowing into `makeTools()`; everything downstream is internal to `src/tools/` and `src/chat/`.

## Storage model

### Shape

`src/tools/tool-preferences.ts`:

```ts
type Permission = 'allow' | 'ask' | 'deny'

interface ToolPrefs {
  domainDefaults: Partial<Record<ToolDomain, Permission>> // omitted = 'allow'
  toolOverrides: Record<string, Permission> // wins over domain default
}
```

`resolveToolPermission(prefs, toolName): Permission` replaces `isToolEnabled()`. Lookup order:

1. `toolOverrides[toolName]` if present
2. `domainDefaults[meta.domain]` if the tool has metadata and the domain is set
3. `'allow'` (default)

Plugin and MCP tools have no `tool-metadata.ts` entry. They are evaluated by step 1 only; absent an override they resolve to `'allow'`.

### Lazy migration at parse time

`parseToolPrefs(raw)` handles both shapes in a single pass:

- legacy `disabledDomains: ['tasks', 'projects']` → `domainDefaults: { tasks: 'deny', projects: 'deny' }`
- legacy `toolOverrides: { delete_task: false }` → `{ delete_task: 'deny' }`; `true` → `'allow'`
- new-shape strings (`'allow' | 'ask' | 'deny'`) pass through
- unknown strings → empty prefs (same fallback as corrupt JSON today)

Migrated blobs are re-serialized in the new shape the next time `setToolPrefs()` runs. No SQL change, no backfill job.

### Pruning

`pruneRedundantOverrides(prefs)` drops any per-tool override whose value equals the effective domain default for that tool. Same role as today; updated to tri-state comparison.

### Cycling

`cycleDomain(prefs, domain, domainToolNames)` and `cycleTool(prefs, toolName, _domainToolNames)` replace `toggleDomain` / `toggleTool`. The cycle is `allow → ask → deny → allow`. `cycleDomain` continues to clear per-tool overrides for tools in that domain so the bulk action wins cleanly (same rule as today's `toggleDomain`).

## Runtime gate

### Wiring

`MakeToolsOptions` (`src/tools/types.ts`) gains:

```ts
askPermission?: (req: { toolName: string; reason: string }) => Promise<'allow' | 'deny'>
```

`prepareLlmInvocation()` in `src/llm-orchestrator-tools.ts` constructs the closure per-turn:

```ts
const askPermission = (req) => askPermissionViaChat(reply, sharedContextId, req)
```

and passes it through `getOrCreateTools` → `makeTools`. When `reply` or `sharedContextId` is unavailable (e.g., proactive mode, test harnesses without a chat surface), `askPermission` is omitted and the wrapper falls back to **Deny**.

### Wrap step

`applyToolPreferences()` in `src/tools/index.ts` becomes:

```ts
for each (name, tool) in final set:
  perm = resolveToolPermission(prefs, name)
  if perm === 'deny':
    drop from set
  else if perm === 'ask':
    set inputSchema = originalSchema.extend({ _permission_reason })
    set execute = gatedExecute(tool, name, askPermission)
  // 'allow' → keep as-is
```

`gatedExecute`:

```ts
;async (input, opts) => {
  const reason = input._permission_reason
  const cleaned = { ...input }
  delete cleaned._permission_reason

  if (askPermission === undefined) {
    return buildPermissionDenied('no chat surface available')
  }
  const decision = await askPermission({ toolName, reason })
  if (decision === 'deny') {
    return buildPermissionDenied('User denied the call.')
  }
  return originalExecute(cleaned, opts)
}
```

`reason` is guaranteed present by the Zod schema (`min(1)`); no defensive default needed. `buildPermissionDenied` returns the new structured failure shape:

```ts
{ status: 'permission_denied', message: string }
```

shape-parallel to today's `confirmation_required` in `src/tools/confirmation-gate.ts`. The LLM sees it through the existing `wrapToolExecution` path and surfaces it to the user; the orchestrator continues normally.

### Cache invalidation

Today, `setCachedTools(cacheKey, tools)` caches the fully-wrapped final `ToolSet` and `setToolPrefs()` clears it via `clearCachedToolsByPrefix()`. With `ask` introduced, the wrapped `ToolSet` would close over a per-turn `askPermission`, which cannot be safely cached.

Fix: cache the _pre-permission_ tool descriptors (builtins + MCP + plugin merge, before `applyToolPreferences`) and apply preferences each turn. `applyToolPreferences` is a synchronous map over ~30 tools — cheap. `setToolPrefs()` still invalidates because the pre-permission set's composition is unchanged but the wrapping step depends on prefs, so a lighter prefs-version invalidation is equivalent. Simplest: keep the current cache key, change what is cached (`preToolPrefsSet`), and run `applyToolPreferences(preToolPrefsSet, ctx, askPermission)` every turn.

## Schema extension

For each `ask` tool, the input schema is extended at wrap time:

```ts
const extendedSchema = originalSchema.extend({
  _permission_reason: z
    .string()
    .min(1)
    .max(280)
    .describe(
      'Brief, user-facing reason this tool call is needed. ' +
        'Shown verbatim in the permission prompt. ' +
        'One sentence, present tense, no markdown.',
    ),
})
```

- Underscore prefix signals "infrastructure field, not a real arg".
- 280-char cap bounds the prompt size and chat-history footprint.
- The gate strips `_permission_reason` from `input` before forwarding so the underlying tool sees its original schema.
- If the LLM omits the field, AI SDK Zod validation rejects the call, `wrapToolExecution` turns it into a structured failure, and the LLM retries — same path as any other schema violation.

### System prompt fragment

A new fragment in `src/system-prompt.ts`, composed at the same point as the existing "Unavailable tools" line (`src/system-prompt.ts:166`):

```text
Some tools require user permission before each call. Listed tools must
include `_permission_reason` (one sentence, present tense) describing
why the call is needed:
  - delete_task
  - remove_attachment
  - …
```

Computed from the same `getToolPrefs(sharedContextId)` call already used for the unavailable-tools line, filtering to `ask` permissions. When no tool is set to `ask`, the fragment is omitted.

## Chat layer

### Module

New: `src/chat/permission-prompt.ts`.

```ts
interface PendingRequest {
  contextId: string
  toolName: string
  resolve: (decision: 'allow' | 'deny') => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingRequest>()
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string },
): Promise<'allow' | 'deny'>
```

`askPermissionViaChat`:

1. Generates an 8-char base64url request ID.
2. Posts the prompt via `reply.buttons()` with two callbacks.
3. Stores a `PendingRequest` keyed by ID.
4. Returns a `Promise<'allow' | 'deny'>` that resolves on click or timeout.
5. On timeout, edits the prompt message to `⌛ Timed out — denied` and resolves `'deny'`.

### Prompt format

```text
🔐 Run `delete_task`?

clean up the archived T-123 ticket

[✅ Allow]  [🚫 Deny]
```

Tool name in inline code; reason as a plain paragraph; two `ChatButton`s.

### Callback wire format

Following the existing `tgl:` style in `src/commands/tool-config-view.ts`:

```text
perm:a:<requestId>   # Allow
perm:d:<requestId>   # Deny
```

7-byte prefix + 8-byte ID = 15 bytes, well under the 64-byte Telegram callback cap. The context ID is **not** in the callback; the registry already has it.

### Handler

New: `src/chat/permission-interaction-handler.ts` exporting `handlePermissionInteraction(interaction, reply): Promise<boolean>`. Registered in `src/chat/interaction-router.ts` alongside `handleToolToggleInteraction`.

Steps:

1. Match `perm:[a|d]:<id>`; return `false` for non-matches so the router can dispatch other handlers.
2. Look up `id` in the pending registry.
3. Missing → "🕘 This permission request expired." reply via `replyTextPreferReplace`. Idempotent: double-clicks and post-restart clicks both land here.
4. Verify `canManageTargetContext(interaction, pending.contextId)` — reuses the same gate as `handleToolToggleInteraction`. Failure → standard "missing group target" message.
5. Clear timer, delete from registry, resolve promise with `'allow'` or `'deny'`.
6. Edit the prompt message to a static `✅ Allowed` / `🚫 Denied` line via `replyTextPreferReplace` so the buttons stop being tappable.

### Process restart

In-memory registry; pending requests die on restart. A click on a stale button hits the "expired" branch. The LLM turn was already lost when the process died — acceptable, no recovery flow needed.

### Group contexts

The orchestrator passes the same `reply` that surfaced the original user message into `askPermissionViaChat`, so prompts land in the right thread/channel. Permission to click is gated by `canManageTargetContext`, which already encodes the personal-vs-managed-group rule.

## `/config → 🧰 Tools` UI

Files: `src/commands/tool-config-view.ts`, `src/chat/tool-toggle-interaction-handler.ts`, `src/commands/config.ts`.

### Markers

```text
🟢 allow      ❓ ask      ⭕ deny      🟡 partial (domain only)
```

`getDomainStatus()` → `getDomainSummary()` returns `'allow' | 'ask' | 'deny' | 'partial'`. A domain is `'partial'` when its tools resolve to more than one distinct permission.

### Button cycle

Tapping a domain or tool cycles `allow → ask → deny → allow`. Single tap, no nested menu. The button label shows the _current_ state; the next tap advances. `toggleDomain` / `toggleTool` → `cycleDomain` / `cycleTool`.

### Domain-cycle semantics

`cycleDomain` sets `domainDefaults[domain]` to the next state and clears per-tool overrides for tools in that domain — same bulk-wins rule as today.

### Drill-in view

Same two-level navigation. Tool rows show `🟢 / ❓ / ⭕` + risk emoji + tool name. Tapping cycles.

### Callback wire format

Unchanged: `tgl:dom:`, `tgl:tool:`, plus compact variants. Only the handler semantics change (toggle → 3-state cycle).

### External pseudo-domain

A new ungrouped section appears in the domain list when any plugin or MCP tools are present:

```text
🟢 External — N tools
[✏️ Edit External]
```

- Drill-in lists `plugin_*__*` and `mcp_*__*` names (those without `tool-metadata.ts` entries).
- No bulk-toggle button for External — only the Edit drill-in — because there's no shared domain metadata.
- Per-tool cycling works the same.

### Footer hint

One line at the bottom of the domain list so users discover the new state without a help command:

```text
🟢 = always allowed   ❓ = ask each time   ⭕ = blocked
```

### `/config` summary

`src/commands/config.ts:163-165` shows a count of disabled tools today. Replace with:

```text
🧰 Tools — N blocked, M ask
```

So `ask` is visible at the top level before opening the section.

## Testing

All tests follow `tests/CLAUDE.md` conventions: DI-first, helpers from `tests/utils/test-helpers.ts`, common mocks reset by `tests/mock-reset.ts`.

### `tests/tools/tool-preferences.test.ts` (extend)

- `resolveToolPermission`: default `allow`; domain default applied; per-tool override wins
- `parseToolPrefs`: legacy `disabledDomains` + boolean `toolOverrides` migrate to tri-state
- `parseToolPrefs`: new tri-state shape round-trips through serialize/parse
- `parseToolPrefs`: corrupt JSON → empty prefs
- `pruneRedundantOverrides`: drops overrides matching effective domain default
- `cycleDomain` / `cycleTool`: `allow → ask → deny → allow`
- `cycleDomain`: clears per-tool overrides in that domain
- `getDomainSummary`: returns `'partial'` only when tools disagree

### `tests/tools/permission-gate.test.ts` (new)

- `ask` tool, `askPermission` resolves `'allow'` → original execute runs, `_permission_reason` stripped from forwarded input
- `ask` tool, `askPermission` resolves `'deny'` → returns `{ status: 'permission_denied', ... }`, original execute not called
- `ask` tool, `askPermission` undefined → Deny (safe fallback)
- Schema extension: `_permission_reason` required, min 1, max 280
- `deny` tools removed from set (preserved today's behavior)
- `allow` tools unwrapped (preserved today's behavior)

### `tests/chat/permission-prompt.test.ts` (new)

- `askPermissionViaChat` posts buttons via injected `reply`, registers pending
- `handlePermissionInteraction` with `perm:a:<id>` → resolves `'allow'`, clears timer, edits message
- `handlePermissionInteraction` with `perm:d:<id>` → resolves `'deny'`
- Stale ID → "expired" reply, no resolve
- `canManageTargetContext` rejection → standard error reply, no resolve
- Timeout fires → resolves `'deny'`, drops from registry; subsequent click hits stale path
- Double-click (second click after resolve) → idempotent "expired" reply

### `tests/commands/tool-config-view.test.ts` (extend or new)

- 3-state markers render correctly (allow / ask / deny / partial)
- External pseudo-domain appears only when plugin/MCP tools present
- External pseudo-domain has no bulk-toggle button, only Edit drill-in
- `/config` summary line counts blocked and ask separately

### `tests/system-prompt.test.ts` (extend)

- When tools are marked `ask`, system prompt includes the `_permission_reason` instruction listing those tool names
- When no tool is `ask`, the fragment is omitted

### `tests/llm-orchestrator-tools.test.ts` (extend)

- `prepareLlmInvocation` threads `askPermission` into `makeTools` when a `reply` is available
- Caching: pre-permission descriptors cached; `applyToolPreferences` runs each turn so the per-turn `askPermission` is captured fresh

### Manual / E2E

No new Docker-backed suite. The message-queue/orchestrator interaction is exercised by the unit-level gate and prompt tests. The visible UX change (3-state cycle, ask prompt) is smoke-checked against a live Telegram instance before merge.

## Open follow-ups (out of scope for this spec)

- "Allow always" / "Deny always" buttons that update `tool_prefs` from the prompt itself.
- Configurable timeout (currently a hard-coded 5 min constant).
- Persisting pending requests across restarts.
- A telemetry counter for `permission_denied` outcomes (would slot into `src/usage/` if useful).
