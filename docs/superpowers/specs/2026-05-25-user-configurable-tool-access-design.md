<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User-Configurable Tool Access ("Tool Toggles") — Design

**Date:** 2026-05-25
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session

## Problem

The set of tools exposed to the LLM is currently fixed by provider capabilities and
context (DM/group, mode, S3 availability). Users have no way to narrow that set — for
safety (e.g. forbidding `delete_task`), for noise reduction, or simply because they do
not use a feature.

A naive "just drop the tool" approach has a second-order problem: the system prompt
(`src/system-prompt.ts`) is largely **static** and hard-references specific tools by
name (`web_fetch`, `save_memo`, recurring/deferred tools, destructive-action rules,
relation-type mapping…). Removing a tool while leaving its positive guidance in the
prompt instructs the agent to call something that no longer exists — confusing the
model and wasting turns.

This design lets users and group managers granularly enable/disable tools **and** keeps
the system prompt coherent with the effective tool set.

## Goals

- Per-context enable/disable of tools at **domain-group** granularity, with optional
  **per-tool overrides**.
- Surface **risk labels** (read / write / destructive / open-world) in the toggle UI to
  inform safety decisions.
- **Personal** and **group** scopes, reusing the existing personal-vs-group config
  targeting. No bot-admin global policy layer.
- **Default: all enabled / opt-out.** Zero behavior change until a user opts out;
  fully backward-compatible.
- System prompt never references a disabled (or otherwise absent) tool; additionally a
  short safety-net line lists disabled-but-available tools.
- Toggling takes effect on the next message (cache invalidated).

## Non-Goals

- No bot-admin global denylist / safety floor (can be layered later; intersects
  `system_config`).
- No new dedicated `/tools` command (toggles live inside `/config`).
- No change to provider-capability gating or the per-message tool-router; tool toggles
  are an additional filter layered on top of both.
- No per-tool argument-level restrictions (only whole-tool on/off).

## Existing Architecture (grounding)

- **Assembly:** `buildTools()` in `src/tools/tools-builder.ts` adds tools to a `ToolSet`
  gated by `provider.capabilities` + context. `makeTools()` in `src/tools/index.ts`
  wraps them (`wrapToolExecution`) and merges eligible plugin tools.
- **Single choke point:** every consumer — `llm-orchestrator-tools.ts`,
  `deferred-prompts/proactive-llm.ts`, and `commands/context-*` — calls `makeTools()`.
- **Cache:** assembled tool sets are cached per context in `src/cache.ts`
  (`getCachedTools`/`setCachedTools`/`clearCachedTools`). Group cache key is
  `${contextId}:${chatUserId}:${username}`; DM key is `${contextId}`.
- **Classification (reused):** `src/tools/tool-metadata.ts` already tags every tool with
  `domain`, `operation`, and `risk`. This is the grouping + risk-label source.
- **Per-message router (unchanged):** `src/tools/tool-router.ts` narrows the set by
  message intent at call time; transient, runs after our filter.
- **System prompt:** `buildSystemPrompt(provider, contextId)` returns
  instructions block + static `BASE_PROMPT`/`STATIC_RULES` + provider addendum + plugin
  prompt fragments.
- **Config KV:** `src/config.ts` reads/writes per-context values through
  `getCachedConfig`/`setCachedConfig`. The store accepts arbitrary string keys
  (plugin-config already uses `plugin:<id>:<key>` keys outside the `ConfigKey` union).
- **UI precedent:** `/config` (`src/commands/config.ts`) renders plugin enable/disable
  inline buttons via `buildPluginButtons` → `plg:` callbacks routed in
  `src/chat/interaction-router.ts` (line ~280) → `plugin-interaction-handler.ts`.
  Personal-vs-group targeting is provided by `startGroupSettingsSelection`.

## Design

### 1. Data model & storage (KV-JSON denylist)

Because the default is all-on, persistence is a **denylist** stored as a single JSON
value under a reserved, **non-user-visible** key (not added to `CONFIG_KEYS`, so it never
appears in the raw `/config` text dump — same approach plugin-config uses):

```jsonc
// config key: "tool_prefs"   (value: JSON string)
{
  "disabledDomains": ["web", "deferred"], // whole-domain off
  "toolOverrides": {
    // per-tool override of the domain default
    "delete_task": false, // off even though "task" domain is on
    "web_fetch": true, // on even though "web" domain is off
  },
}
```

Effective state per tool:

```
enabled(tool) = toolOverrides[tool] ?? !disabledDomains.includes(domain(tool))
```

A tool with no `tool-metadata` domain is always treated as enabled (cannot be grouped;
falls through the filter untouched).

New module **`src/tools/tool-preferences.ts`** owns this:

- `getToolPrefs(contextId): ToolPrefs` — parse JSON, tolerate missing/corrupt → empty.
- `setToolPrefs(contextId, prefs): void` — serialize + write + invalidate tool cache.
- `isToolEnabled(contextId, toolName): boolean`
- `getDisabledToolNames(contextId, allToolNames): Set<string>`
- `getDomainStatus(contextId, domain, domainToolNames): 'on' | 'off' | 'partial'`
- Toggle helpers: `toggleDomain(contextId, domain)`, `toggleTool(contextId, toolName, allNames)`
  — these update the blob and prune redundant overrides (an override equal to the domain
  default is removed to keep the blob minimal).

Personal vs group is purely a matter of which `contextId` the caller passes — identical
to how plugin context state is keyed.

### 2. Filter placement (structural enforcement)

Apply the toggle filter in **`makeTools()`**, after builtins are wrapped and plugin
tools merged, before returning. Disabled tool names are removed from the `ToolSet`.

Because the tool is physically absent from the object handed to `generateText`, a
disabled tool **cannot be invoked** — enforcement is structural; no runtime guard or
execution-time rejection is required.

Narrowing order:

```
buildTools (capabilities + context)
  -> merge plugin tools
  -> [NEW] remove user/group-disabled tools (tool-preferences)
  -> cache
  -> tool-router subset (per message, transient)  [unchanged]
```

`makeTools()` already receives `storageContextId`, which is the context key used to load
preferences.

### 3. Cache invalidation

`setToolPrefs` / `toggleDomain` / `toggleTool` must clear the cached tool set for the
context. DM keys clear directly; **group keys are prefixed** (`${contextId}:...`), so
`src/cache.ts` gains a prefix-clear (e.g. `clearCachedToolsByPrefix(contextId)`) and the
preference writer calls it. The system prompt is rebuilt every turn, so there is no
prompt-cache concern.

### 4. System-prompt coherence

Refactor `src/system-prompt.ts` so guidance is composed from fragments rather than one
static string:

- Keep an always-on **core** (identity, workflow, time, due-date formatting, output
  rules, ambiguity handling).
- Extract **domain-keyed fragments**: `recurring`, `deferred`, `web`, `memos`,
  `relations`, `destructive`, `instructions` (and any other tool-specific blocks).
- Each fragment carries the set of tool names it depends on.

`buildSystemPrompt` becomes aware of the **effective enabled tool-name set** for the
context (computed from the assembled-then-filtered set, i.e. the same set `makeTools`
produces — capability + context + user toggles, but **not** the transient per-message
router subset):

1. **Include a fragment only if ≥1 of its tools is enabled.** Positive guidance never
   references an absent tool. This also fixes pre-existing latent incoherence (e.g. the
   web-fetch block currently appears even when `web_fetch` is not assembled).
2. **Append a safety-net line** listing tools that are capability-available but
   user-disabled:
   `Unavailable tools — do not use or mention: <comma-separated names>`.
   (Omitted when nothing is disabled.)

Signature evolves to something like
`buildSystemPrompt(provider, contextId, enabledToolNames: ReadonlySet<string>)`, or a
helper that derives the enabled set from `contextId` so existing call sites stay thin.
The orchestrator already has the filtered tool set available and can pass its keys.

### 5. UI — "🧰 Tools" section in `/config`

Reuse the plugin-toggle pattern. `renderConfigForTarget` gains a Tools section and
buttons; a new `handleToolToggleInteraction` is routed in `interaction-router.ts`
alongside the `plg:` handler. Two-level navigation (Telegram inline-button budget):

- **Top level (domain list):** one entry per domain present in the assembled set, with
  status marker:
  - `🟢 Tasks` (all on) · `⭕ Web` (all off) · `🟡 Recurring` (partial — domain default
    plus some per-tool overrides).
  - Tapping the domain row toggles the whole domain; an `open` action drills in.
- **Drill-in (tool list for a domain):** per-tool buttons showing **risk label** from
  `TOOL_METADATA.risk`:
  - 📖 read · ✏️ write · ⚠️ destructive · 🌐 open-world
  - e.g. `⚠️ delete_task: on` → tap to toggle.
  - A `back` action returns to the domain list.

Callback-data scheme (base64url-encoded context id, mirroring `plg:`):

```
tgl:dom:<domain>:<ctx>     # toggle whole domain
tgl:tool:<toolName>:<ctx>  # toggle single tool
tgl:open:<domain>:<ctx>    # drill into a domain
tgl:back:<ctx>             # back to domain list
```

All tools are toggleable (no hard floor), consistent with the personal+group, no-admin
decision. The domain view may show a gentle ⚠️ hint if the user disables a core
read domain that would leave the bot unable to act, but does not block it.

Non-interactive platforms: the Tools section renders as read-only status text (same
degradation path `/config` already uses), directing users to a button-capable client.

### 6. Edge cases

- **Empty prefs** → `getToolPrefs` returns empty; filter is a no-op; prompt unchanged.
  Backward-compatibility guaranteed by snapshot test.
- **Corrupt JSON** → treated as empty prefs; `warn` log; never throws into assembly.
- **Disabled tool referenced in stored instructions / history** → harmless; the model
  cannot call it and the safety-net line discourages mention.
- **Plugin tools** → subject to the same name filter; a plugin tool can be disabled like
  any other. (Plugin _eligibility_ remains separate and upstream.)
- **Thread-scoped group contexts** → key preferences by the same context id used for
  plugin context state, so behavior matches the existing plugin model.

## Testing

- **tool-preferences:** effective-state matrix (empty = all on; domain off; override on
  over domain-off; override off over domain-on; redundant-override pruning); corrupt
  JSON tolerance.
- **makeTools filter:** disabled builtin/plugin tools absent; empty prefs produce the
  current set (backward-compat snapshot); domain-off removes exactly that domain's tools;
  per-tool override precedence.
- **cache:** toggle clears DM key and group-prefixed keys; next `makeTools` rebuilds.
- **system-prompt:** fragment inclusion/exclusion per enabled set; safety-net line lists
  exactly the disabled-but-available tools and is omitted when none; no dangling tool
  references in any fragment combination; core always present.
- **/config + interaction-router:** domain/tool/open/back callback round-trips;
  on/off/partial status rendering; risk-label rendering; personal-vs-group targeting;
  non-interactive read-only fallback.

## Open Questions / Future Work

- Bot-admin global policy floor (force-disable everywhere) — explicitly out of scope now.
- A standalone `/tools` shortcut command — deferred; `/config` section ships first.
- Optional analytics on which tools users most disable (privacy-respecting, aggregate)
  could inform defaults later.

## Files Touched (anticipated)

- **New:** `src/tools/tool-preferences.ts`, tests.
- **Edit:** `src/tools/index.ts` (`makeTools` filter), `src/cache.ts` (prefix clear),
  `src/system-prompt.ts` (fragment refactor + enabled-set awareness),
  `src/commands/config.ts` (Tools section + buttons), `src/chat/interaction-router.ts`
  (route `tgl:`), new `src/chat/tool-toggle-interaction-handler.ts` (or co-located),
  docs/CLAUDE updates.
- **Unchanged:** `src/tools/tool-metadata.ts` (consumed as-is), `tool-router.ts`,
  provider capability gating.
