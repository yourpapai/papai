<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 9: `mcp-test` (canary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-test` — a trivial single-tool MCP plugin used as a live end-to-end **canary** for the `/mcp/plugin/<id>` → coding-agent path. It has no upstream, no credentials, no permissions, and no redaction; its `test` tool returns a fixed confirmation string.

**Architecture:** The smallest possible `mcpServer: true` plugin. `mcpServer: true` at `/mcp/plugin/mcp-test`. No `http` permission (no outbound calls), no `configRequirements`, no `mcpResponseRedaction`. The `test` tool's `execute` returns a constant string.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–8)

Read `plugins/mcp-sentry/` / `plugins/mcp-confluence/` for the shape. Carry: FULL `bun run lint` + `bun run knip` before every commit; SPDX headers; `.js` imports; knip `["files"]` ignore per new-but-unconsumed file (removed at tool registration; KEEP `index.ts": ["exports"]`); `bunx oxfmt` only changed files; `check:full`'s `test` step flakes under contention (standalone `bun test` + free `lsof -ti :9100`).

## The plugin (source: kiss `mcp/test-mcp/` — a 53-line reference/smoke-test server)

kiss's test-mcp registers one tool `test` that returns a literal string. papai equivalent: a `test` tool with no input that returns a fixed confirmation string.

- **Manifest:** `mcpServer: true`; `contributes.tools: ["test"]`; `permissions: []` (no upstream); NO `mcpResponseRedaction`, NO `providerAllowedHosts*`, NO `configRequirements`, `configKeys: []`.
- **`test` tool:** input schema `{ type:'object', properties:{}, additionalProperties:false }` (no params); `execute` returns the constant `'mcp-test ok: papai plugin MCP path is reachable'`.

## File structure

```
plugins/mcp-test/
  plugin.json     # mcpServer:true, permissions:[], no config, no redaction
  context.ts      # mcp-confluence/context.ts copy (only log+registration are used; adminConfig/httpFetch unused but harmless)
  input-schema.ts # 1 empty-object schema
  index.ts        # factory registering the single `test` tool
  README.md
tests/plugins/mcp-test.test.ts
tests/mcp-server/mcp-test-listing.test.ts
```

---

## Task 1: The full plugin (manifest + context + schema + tool + unit tests)

**Files:** `plugins/mcp-test/{plugin.json,context.ts,input-schema.ts,index.ts}`, `tests/plugins/mcp-test.test.ts`.

- [ ] **Step 1:** Copy `plugins/mcp-confluence/context.ts` → `plugins/mcp-test/context.ts` VERBATIM (the `test` tool doesn't use `httpFetch`/`adminConfig`, but `requirePluginContext` provides `log`+`registration` which it does need; the extra unused facade fields are harmless).
- [ ] **Step 2:** Create `plugins/mcp-test/plugin.json`:

```json
{
  "id": "mcp-test",
  "name": "MCP Test Canary (coding agent)",
  "version": "1.0.0",
  "description": "Canary MCP tool that confirms the plugin MCP-server path is reachable",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "contributes": { "tools": ["test"], "promptFragments": [], "configKeys": [] },
  "permissions": [],
  "defaultEnabled": false,
  "configRequirements": [],
  "activationTimeoutMs": 3000
}
```

(If the manifest schema rejects `permissions: []`, use whatever the minimal accepted value is — but `[]` should be valid; verify via the throwaway parse in Step 5.)

- [ ] **Step 3:** Create `plugins/mcp-test/input-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const testSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const
```

- [ ] **Step 4:** Write failing unit tests `tests/plugins/mcp-test.test.ts` (mirror the mock-context shape from `tests/plugins/synthetic-web-search.test.ts` or `tests/plugins/mcp-sentry.test.ts`): activate registers exactly one tool named `test`; the tool's `execute` returns the string `'mcp-test ok: papai plugin MCP path is reachable'`. Run → FAIL (module missing).
- [ ] **Step 5:** Create `plugins/mcp-test/index.ts` — license header + factory (mirror `plugins/synthetic-web-search/index.ts`'s shape, but the tool needs no httpFetch/config). In `activate(ctx)`: `const c = requirePluginContext(ctx)`; `c.registration.registerTool({ name: 'test', description: 'Canary tool: returns a fixed string confirming the plugin MCP path is reachable', inputSchema: testSchema, execute: () => 'mcp-test ok: papai plugin MCP path is reachable' })`; log on activate/deactivate. (The `execute` signature must match `RegisteredToolLike` from context.ts — `(input, runtimeContext, options) => Promise<unknown> | unknown`; returning a plain string is fine.) Validate the manifest parses via a throwaway test (delete it, don't commit).
- [ ] **Step 6:** Run `bun test tests/plugins/mcp-test.test.ts` → PASS. `bun test tests/plugins/discovery.test.ts` → green (mc-test discovered). `bun run typecheck` clean; FULL `bun run lint` → 0 errors; `bun run knip`: add `"plugins/mcp-test/index.ts": ["exports"]` to `knip.jsonc` (plugin entry); if `input-schema.ts` is flagged, it IS consumed by index.ts in the same task so it should be clean — if not, add its ignore. Must be clean.
- [ ] **Step 7:** `bunx oxfmt` changed files; commit: `git add plugins/mcp-test/ tests/plugins/mcp-test.test.ts knip.jsonc && git commit -m "feat(mcp-test): canary MCP plugin with a single test tool"`.

## Task 2: README + verification + docs + gate

**Files:** `plugins/mcp-test/README.md`, `tests/mcp-server/mcp-test-listing.test.ts`, edit `docs/architecture/coding-stack-overview.md`.

- [ ] **Step 1:** README (short — mirror the header style of `plugins/mcp-sentry/README.md`): purpose (a canary proving the `/mcp/plugin/<id>` → coding-agent path works per deploy), the single `test` tool (no input, returns a fixed string), no config, no permissions, no redaction, and enable/select steps.
- [ ] **Step 2:** `tests/mcp-server/mcp-test-listing.test.ts` mirroring `tests/mcp-server/mcp-confluence-listing.test.ts`: discover → activate → `listPluginMcpTools('mcp-test')` resolves the 1 tool `test` with an `inputSchema`; empties after deactivate. Run → PASS.
- [ ] **Step 3:** Add `mcp-test` to `docs/architecture/coding-stack-overview.md` migrated-plugins mention (the canary; ninth/last migrated plugin surface — note `mcp-npm` remains the documented sandbox-side exception).
- [ ] **Step 4:** `bun run check:full` → 12/12 green (flake caveat: standalone `bun test`, free port 9100). Commit: `feat(mcp-test): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** the single `test` canary tool; no upstream/creds/permissions/redaction; unit test + listing verification.
- **Deviations:** the returned string is papai-appropriate English (kiss returned `"Test local mcp complete"`) — cosmetic.
- **Risks:** `permissions: []` and empty `configRequirements` — Task 1 Step 5 verifies the manifest parses. (`mcp-test` has no `providerRuntime` need, so `activate` must NOT assume `providerRuntime` exists — the factory only touches `registration`/`log`.)
- **Placeholders:** none — the entire plugin is specified inline.

## Follow-ups

- This completes the migratable kiss MCP fleet (9 plugins: sentry, confluence, figma, teamcity, rag, mattermost, gitlab, youtrack, test). Remaining tracked work: **`mcp-youtrack` Plan 8b** (6 write tools), plus the carried cross-cutting follow-ups (per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset, `abortSignal` threading, figma full-simplify, teamcity envelope flattening, mattermost binary attachments, gitlab write tools, the dead `key==='key'` branch in `mcp-sentry/format.ts`) and the magi-side items (`npm_publish`, the `ask` fail-open fix).
