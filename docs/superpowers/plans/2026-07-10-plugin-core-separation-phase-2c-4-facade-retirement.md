<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2c-4 — Retire the `coding.secrets` Plugin Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-orphaned plugin-side coding-secrets/repos facade — `src/plugins/coding-secrets-facade.ts`, the `codingSecrets`/`codingRepos` fields on `PluginToolRuntimeContext`, and the `coding.secrets` plugin permission — completing the leak removal that the acp→module migration (Phase 2c-3c) unblocked.

**Architecture:** The acp plugin was the sole consumer of this facade, and it now lives inside the `coding` trusted module calling the coding resolvers directly (via its own module-local `RuntimeContext`, built ungated by `src/modules/coding/acp/runtime-context.ts`). Nothing in production reads `PluginToolRuntimeContext.codingSecrets`/`.codingRepos` anymore, and no remaining bundled plugin declares `coding.secrets`. The removal is therefore a coordinated, type-error-driven deletion: the type fields, their sole construction site, the facade file, the permission enum member, and the facade's tests all come out together; a few plugin test stubs that only fill the type shape are trimmed in lockstep.

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions); Zod v4; `bun:test`; oxlint/oxfmt; knip.

---

## Context for the implementer (read before starting)

- This is a **removal**, not a feature. TDD "write a failing test first" does not apply — the safety net is: TypeScript catches every dangling reference (removing a type field breaks its construction site and any object literal that sets it), `knip` catches the orphaned facade file/exports, and the full existing suite catches regressions. Your job is to make the coordinated deletion and prove the suite + `check:full` stay green.
- **The removal is atomic.** You cannot remove the `PluginToolRuntimeContext.codingSecrets`/`.codingRepos` type fields without simultaneously removing their construction (`src/plugins/tool-runtime.ts`), the facade file they call, and every object literal that sets those keys (three plugin test stubs) — otherwise typecheck fails mid-way. Do all of Task 1's edits, THEN verify. Expect transient typecheck errors between edits; that's fine — only the end state must be green.
- **Do NOT touch anything under `src/modules/coding/**`or`tests/modules/coding/**`.** Those use a _separate, identically-named_ `RuntimeContext` type (`src/modules/coding/acp/tools.ts`), built by `buildRuntimeContext` in `src/modules/coding/acp/runtime-context.ts` — it is the module's own ungated context and is completely unrelated to the plugin `PluginToolRuntimeContext` being gutted here. Confusing the two is the main hazard.
- **Do NOT touch `src/debug/transcript-viewer.ts`** or the `'acp'` kv/admin-config namespace — unrelated to this facade.

### Verified removal surface (from recon)

**Delete (whole files):**

- `src/plugins/coding-secrets-facade.ts` (exports `buildCodingSecretsFacade`, `buildCodingReposFacade`)
- `tests/plugins/coding-secrets-facade.test.ts`
- `tests/plugins/coding-repos-facade.test.ts`

**Edit:**

- `src/plugins/tool-runtime.ts` — import (line ~10) + the `codingSecrets`/`codingRepos` properties (lines ~230-236) in `buildPluginToolRuntimeContext`'s returned object.
- `src/plugins/runtime-types.ts` — the `codingSecrets` field (lines ~56-71), the `codingRepos` field (lines ~72-75), and the now-unused `CodingRepoEntry` type (lines ~32-39) on/around `PluginToolRuntimeContext`.
- `src/plugins/types.ts` — remove `'coding.secrets'` from `PLUGIN_PERMISSIONS` (line ~57); the `z.enum(PLUGIN_PERMISSIONS)` manifest schema (line ~170) updates automatically.
- `tests/plugins/audio-transcribe.test.ts` (~209,219), `tests/plugins/synthetic-web-search.test.ts` (~110,120), `tests/plugins/attachment-transform.test.ts` (~116,126) — remove the `codingSecrets`/`codingRepos` stub keys from each fake `PluginToolRuntimeContext` object.
- `tests/plugins/deny.test.ts` (~line 11) — swap the `'acp'`/`'coding.secrets'` example strings for still-live values.
- `docs/architecture/coding-sessions.md` (~lines 12, 18, 86) — reword the `coding.secrets`-gated phrasing (Task 2).

**Confirmed safe / no action:** all four remaining bundled plugins (`audio-transcribe`, `synthetic-web-search`, `task-provider-kaneo`, `task-provider-youtrack`) declare no `coding.secrets` and never read `codingSecrets`/`codingRepos`; everything under `src/modules/coding/**` + `tests/modules/coding/**` uses the separate module-local type.

---

## File Structure

No new files. Net effect: 3 files deleted, 6 files edited (5 code/test + 1 doc). `CodingRepoEntry` disappears with its only two consumers.

---

## Task 1: Coordinated facade removal (atomic)

**Files:**

- Delete: `src/plugins/coding-secrets-facade.ts`, `tests/plugins/coding-secrets-facade.test.ts`, `tests/plugins/coding-repos-facade.test.ts`
- Modify: `src/plugins/tool-runtime.ts`, `src/plugins/runtime-types.ts`, `src/plugins/types.ts`, `tests/plugins/audio-transcribe.test.ts`, `tests/plugins/synthetic-web-search.test.ts`, `tests/plugins/attachment-transform.test.ts`, `tests/plugins/deny.test.ts`

- [ ] **Step 1: Confirm no production consumers remain (safety re-check)**

Run: `rg -n "\.codingSecrets|\.codingRepos|coding-secrets-facade|buildCodingSecretsFacade|buildCodingReposFacade|'coding\.secrets'|CodingRepoEntry" src client`
Expected: matches ONLY in `src/plugins/coding-secrets-facade.ts`, `src/plugins/tool-runtime.ts`, `src/plugins/runtime-types.ts`, `src/plugins/types.ts` (the removal targets). If ANY `src/`/`client/` file OTHER than these references them, STOP and report — the removal is not safe as planned. (Reminder: `src/modules/coding/**` hits are the _module-local_ type — those use `RuntimeContext`, not `PluginToolRuntimeContext`; they should NOT appear for `coding-secrets-facade`/`buildCoding*Facade`/`'coding.secrets'`. If a `src/modules/coding/**` file appears only for a bare `.codingSecrets`/`.codingRepos` property access, that is the module's own type — leave it.)

- [ ] **Step 2: Delete the facade and its two test files**

```bash
git rm src/plugins/coding-secrets-facade.ts tests/plugins/coding-secrets-facade.test.ts tests/plugins/coding-repos-facade.test.ts
```

- [ ] **Step 3: Remove the facade import + construction in `src/plugins/tool-runtime.ts`**

Remove the import line:

```ts
import { buildCodingReposFacade, buildCodingSecretsFacade } from './coding-secrets-facade.js'
```

And remove the two properties from the object returned by `buildPluginToolRuntimeContext` (verbatim block to delete):

```ts
    codingSecrets: buildCodingSecretsFacade(
      pluginId,
      runtime.storageContextId,
      permissions.has('coding.secrets'),
      runtime.chatUserId,
    ),
    codingRepos: buildCodingReposFacade(pluginId, runtime.storageContextId, permissions.has('coding.secrets')),
```

Leave the rest of the returned object intact (the surrounding properties like `kv`, `adminConfig`, `attachments`, etc. stay). After this edit, `permissions.has('coding.secrets')` no longer appears anywhere in `tool-runtime.ts` — verify with `rg -n "coding" src/plugins/tool-runtime.ts` (expect no hits).

- [ ] **Step 4: Remove the type fields + `CodingRepoEntry` in `src/plugins/runtime-types.ts`**

Delete the `codingSecrets` block (the full `codingSecrets: { resolve()… resolveMcpToken() }` object-type field, ~lines 56-71) and the `codingRepos` block (`codingRepos: { list()…; get(name) }`, ~lines 72-75) from the `PluginToolRuntimeContext` type. Then delete the now-unused `CodingRepoEntry` type:

```ts
/** Repo record surfaced to plugins via the `codingRepos` facade. */
export type CodingRepoEntry = {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  additionalEgressDomains?: string[]
}
```

Check whether `CodingRepoEntry` is re-exported from `src/plugins/types.ts` (recon noted `types.ts:28-41` re-exports runtime types type-only). If `types.ts` re-exports `CodingRepoEntry`, remove that re-export line too. Verify: `rg -n "CodingRepoEntry" src client tests` → zero hits after this step.

- [ ] **Step 5: Remove the `coding.secrets` permission in `src/plugins/types.ts`**

In the `PLUGIN_PERMISSIONS` array, delete the `'coding.secrets',` entry:

```ts
export const PLUGIN_PERMISSIONS = [
  'storage',
  'scheduler',
  'commands',
  'tasks.read',
  'tasks.write',
  'provider.task',
  'identity',
  'http',
  'attachments.read',
  'coding.secrets', // ← delete this line
] as const
```

The `z.enum(PLUGIN_PERMISSIONS)` manifest schema and the `PluginPermission` union both derive from this array, so they update automatically.

- [ ] **Step 6: Trim the three plugin test stubs**

In each of `tests/plugins/audio-transcribe.test.ts`, `tests/plugins/synthetic-web-search.test.ts`, `tests/plugins/attachment-transform.test.ts`, find the fake `PluginToolRuntimeContext` object each builds and delete its `codingSecrets: { … }` and `codingRepos: { … }` stub properties (the recon located them near lines 209/219, 110/120, and 116/126 respectively — but locate them precisely by searching each file for `codingSecrets`/`codingRepos`). Remove ONLY those two keys per object; leave the rest of each stub intact. These were only present to satisfy the type; with the fields gone they'd be excess-property type errors.

- [ ] **Step 7: Update `tests/plugins/deny.test.ts`**

This suite tests the generic `deny(pluginId, permission)` helper using `'acp'`/`'coding.secrets'` as example strings. Replace them with still-live values so the test doesn't reference retired concepts — e.g. use an existing plugin id and a surviving permission like `'storage'` or `'http'`:

```ts
expect(() =>
  deny('audio-transcribe', 'storage'),
).toThrow(/* keep the existing matcher, updating the permission/plugin name in the expected message if it asserts on the string */)
```

Match the existing test's assertion shape exactly; only swap the example plugin id + permission string (and any expected-message substring that embeds them). Do not change what `deny` does or how it's asserted.

- [ ] **Step 8: Typecheck + knip (the primary safety nets)**

Run: `bun run typecheck`
Expected: clean. (A dangling reference anywhere would surface here.)

Run: `bun run knip`
Expected: clean — confirms the facade file is gone with no orphaned exports and nothing else went unused.

If typecheck reports a reference you didn't expect (e.g. another consumer), STOP and report it rather than forcing the change.

- [ ] **Step 9: Lint + format + full suite + guard**

Run: `bun run lint` (clean), `bun run format:check` (run `bun run format` if needed).
Run: `bun test` — the full suite must pass with the facade tests removed and stubs trimmed. Report pass/fail counts.
Run: `bun test tests/architecture-guard.test.ts` — must PASS (this removal only makes core more feature-agnostic).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(plugins): retire coding.secrets facade + PluginToolRuntimeContext coding fields"
```

Before committing, `git status` should show exactly: 3 deletions (`coding-secrets-facade.ts` + its 2 tests) and edits to `tool-runtime.ts`, `runtime-types.ts`, `types.ts`, and the 4 test files (`audio-transcribe`, `synthetic-web-search`, `attachment-transform`, `deny`). Nothing else.

> Note on the TDD pre-write hook: `runtime-types.ts`/`types.ts` are edits to existing files (not new files), so the hook should allow them. If the hook blocks a pure-type edit for lack of a companion test, do NOT add a throwaway test to game it — report it; the change is validated by typecheck and the consuming suites.

---

## Task 2: Docs reword + final verification

**Files:**

- Modify: `docs/architecture/coding-sessions.md`

- [ ] **Step 1: Reword the stale `coding.secrets` phrasing**

Read `docs/architecture/coding-sessions.md` around lines 12, 18, 86. It describes the coding module's `codingSecrets` capability as "`coding.secrets`-gated" — but that permission string no longer exists, and the module's `buildRuntimeContext` calls the resolvers **directly, ungated** (the module is trusted / statically imported, not sandboxed). Reword these references so they accurately describe the module reading coding credentials directly via the coding resolvers (no plugin permission gate), while keeping the surrounding magi/forge/operator-guardrail content intact. Keep edits minimal and accurate; do not invent new mechanisms.

After editing, verify the permission string is gone from living architecture docs: `rg -n "coding\.secrets" docs/architecture` → empty. (Historical ADR/plan/spec docs under `docs/adr/`, `docs/archive/`, `docs/superpowers/` legitimately reference it as a point-in-time record — leave those untouched.)

- [ ] **Step 2: Confirm the permission is fully gone from code**

Run: `rg -n "coding\.secrets|codingSecrets|codingRepos|coding-secrets-facade" src client`
Expected: matches ONLY under `src/modules/coding/**` for the module-local `.codingSecrets`/`.codingRepos` property names (the module's own `RuntimeContext`). ZERO hits for `coding.secrets` (the permission string), `coding-secrets-facade`, or in `src/plugins/**`.

- [ ] **Step 3: Full verification gate**

Run: `bun check:full`
Expected: 12/12 green (lint, typecheck, format:check, license-headers, knip, test, test:client, duplicates, review-loop:{lint,typecheck,format:check,test}).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/coding-sessions.md
git commit -m "docs(coding-sessions): drop stale coding.secrets permission references"
```

---

## Self-Review notes (author)

- **Spec coverage:** Phase 2c-4 as defined ("remove `codingSecrets`/`codingRepos` from `PluginToolRuntimeContext`, delete `src/plugins/coding-secrets-facade.ts`, drop `coding.secrets` from `PLUGIN_PERMISSIONS`") is fully covered by Task 1; Task 2 cleans the doc reference the removal makes stale.
- **Atomicity:** all type/construction/facade/stub edits land in one commit (Task 1) so typecheck never stays red across commits.
- **No consumer missed:** Step 1 re-verifies zero production consumers before deleting; typecheck (Step 8) + knip are the backstops.
- **Module vs plugin type:** the plan repeatedly flags that `src/modules/coding/**`'s identically-named `RuntimeContext` is a _different_ type and must not be touched — the one real hazard.
- **Behavior change:** none user-facing. Internal-only permission removal; no bundled/third-party plugin declared `coding.secrets` (it was acp-private and never advertised in the plugin developer guide), so no manifest breaks in practice. Not release-note-worthy beyond the internal refactor.
