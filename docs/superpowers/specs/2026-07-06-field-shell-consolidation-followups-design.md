<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Field-shell consolidation follow-ups

**Date:** 2026-07-06
**Status:** Approved (design); ready for implementation planning
**Predecessor:** [`2026-07-06-byok-section-field-shell-design.md`](./2026-07-06-byok-section-field-shell-design.md) — introduced `SettingsFieldShell` and migrated ByokSection, CodingCredentialsSection, ConfigFieldRow. This spec finishes that consolidation and fixes a save-feedback bug the final review of that work surfaced.

## 1. Goal

Three follow-ups from the predecessor's final review:

- **A. Consolidation** — the two remaining hand-rolled `.settings-field*` copies (`CodeHostSection`, `AdminPluginsConfigSection`) route through `SettingsFieldShell`, so no settings-field row markup lives outside the shell.
- **B. Save-feedback bug** — a save whose PATCH succeeds but whose immediate reload fails currently shows a success line **and** an error line. The success line must be suppressed when the reload fails.
- **C. Test gaps** — add the `role`/dirty/double-label assertions the predecessor deferred, plus reload-failure coverage.

**In scope:** `CodeHostSection`, `AdminPluginsConfigSection`, and the `load()`/save-flow of the sections that show a post-save status (`ByokSection`, `CodingCredentialsSection`, `CodeHostSection`, `AdminPluginsConfigSection`). **Out of scope:** the `SettingsFieldShell` component itself (unchanged), any HTTP route or Zod schema, and extracting a shared _section_ component (the shared **shell** is the correct dedup boundary — CodeHost and CodingCredentials diverge in cross-field logic, so a shared section would be a leaky abstraction).

## 2. Part A — Shell migration

### 2.1 CodeHostSection — full twin treatment

`CodeHostSection` is a near-exact twin of `CodingCredentialsSection` (shares `fetchCodingCredentials`/`patchCodingCredentials` with `namespace: 'forge'`; whole-record Save; `select` control; Secret+Replace; Clear+Confirm). It receives the **identical treatment applied to CodingCredentialsSection** in the predecessor:

- Rows via `<SettingsFieldShell label={field.label} required={field.required} editorOpen={editorOpen(field)} testid={`coding-row-${field.key}`}>`, with `head` = masked Secret + Replace (when sensitive/hasValue/!editorOpen) and `editor` = a `{#if field.control === 'select'}` `<select class="coding-select">` branch else a plain `{:else}` `<Input>` + Cancel-when-sensitive/hasValue. The `shouldShowField` gate (conditional `instance_url`) and the `{@const}` pattern stay. The third editor branch becomes a plain `{:else}` (the shell's `editorOpen` prop gates the whole editor slot), matching the CodingCredentials migration.
- Load-error split: inline `<p class="status-error" role="alert">` gated `currentData !== null`; `{:else if currentData === null && error !== null}<ErrorState message={error} onRetry={() => void load(contextId)} />`; unreadable `<p>` gets `role="alert"`; success `<p>` gets `role="status"`.
- Whole-record dirty-state: `const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))`; bottom Save `disabled={!formDirty || saving || loading || clearing}`; Clear unchanged.
- CSS: delete the `.settings-field*` rules (owned by the shell); keep `.settings-byok-fields`, `.settings-field__actions`; set `.coding-select` to `flex: 1; min-width: 200px` (from `width: 100%`).

**Dirty-state nuance (CodeHost only):** `initialDrafts` defaults an empty `select` to its first option (`f.options?.[0]`) while the stored `value` is `''`. So for an **unconfigured** code host, `formDirty` is `true` on load — the visible `kind` selection genuinely differs from the unset stored state, so an enabled Save is correct (saving persists the shown default). For a **configured** host, all drafts equal their stored values, so Save is disabled until a change. The plan's dirty test must use a configured fixture to assert the disabled→enabled transition.

### 2.2 AdminPluginsConfigSection — migrate onto the shell (partial fit)

Admin-only, per-field save, nested `plugin-block → keys`. Each key row migrates from its hand-rolled `.settings-field` card to `<SettingsFieldShell>`:

- `testid={`plugin-config-key-${plugin.pluginId}-${keyState.key}`}` on the shell card.
- `head` snippet: the masked `Secret` (or `<span class="placeholder">unset</span>` when `value === null`) **plus the existing `<span class="badge-required">required</span>`** when `keyState.required`. Keep the badge — do **not** use the shell's accent-asterisk `required` prop (preserves admin UX and the badge assertion in the existing test).
- `editor` snippet: the `<Input>` + Save + Clear buttons, **without** the wrapping `<Field label="New value">` (this removes the double label). Wire the `Input`'s accessible name through the shell's label id (already provided by `SettingsFieldShell` via field-context — no extra work).
- Per-field dirty-state: Save `disabled` when the draft is blank — `disabled={(drafts[draftKey(plugin.pluginId, keyState.key)] ?? '').trim() === ''}`. This makes the existing silent `if (value.trim() === '') return` guard visible as a disabled control.
- `role="alert"`/`role="status"` on the section's status `<p>` lines.
- CSS: delete the `.settings-field`, `.settings-field__head`, `.settings-field__label` rules; keep `.plugin-block*`, `.badge-required`. The old `.settings-field__editor-row` (its own `align-items: center` row) is replaced by the shell's `.settings-field__editor` (`align-items: end`) — a small intended vertical-alignment shift, re-baselined.

This section has no `ErrorState`/whole-record concerns (it is per-field, list-of-plugins shaped); the migration is structural + roles + dirty-state only.

## 3. Part B — Suppress success on reload failure

**Root cause:** each section's `load()` returns `Promise<void>` and swallows fetch errors (sets `error`, does not rethrow). The save handlers then set the success `status` unconditionally after `await load()`. When the post-save reload fails, both `error` and `status` end up set and both render.

**Fix (uniform):** change `load()` to `Promise<boolean>` — return `true` on success, `false` on the catch path (and `false` on the early `id !== contextId` bail where present). Callers set the success `status` **only when the reload returned `true`**; on `false`, `load()`'s `error` is shown and no success line appears.

Call sites to update (verified present):

| Section                            | Handlers                      |
| ---------------------------------- | ----------------------------- |
| `ByokSection.svelte`               | `save()`                      |
| `CodingCredentialsSection.svelte`  | `saveAll()`, `confirmClear()` |
| `CodeHostSection.svelte`           | `saveAll()`, `confirmClear()` |
| `AdminPluginsConfigSection.svelte` | `save()`, `confirmClear()`    |

`ConfigFieldRow.svelte` is unaffected — it delegates reload to the parent via `onSaved()` and sets no status of its own.

Ordering note: `save()`/`saveAll()` set `status` _after_ `await load()` (just gate it on the boolean). The `confirmClear()` handlers currently set `status` _before_ `await load()`, so they must be **reordered** — reload first, then set the cleared-status only when the reload returned `true`.

Example shape (`ByokSection.save`):

```ts
await patchByok({ contextId, values: { [field.key]: drafts[field.key] ?? '' } })
const ok = await load(contextId)
if (ok) status = `${field.label} saved.`
// if !ok, load() has set `error`; no success line
```

Note the operation semantics: the PATCH did persist, but the UI could not refresh to a confirmed state, so surfacing the reload error (not a success) is the honest signal — the header refresh/retry lets the user reload. This is the "show reload error only" decision.

## 4. Part C — Test coverage

Follow the existing client-test idiom (`mount`/`unmount` + `setMockFetch` + `drain`); run with the client runner (`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`).

- **CodeHostSection** (`tests/client/settings/code-host-section.test.ts`): dirty-gated Save (configured fixture: disabled → enabled after a change); `ErrorState`+retry on load failure (`error-retry` testid); `role="alert"` on an error line and `role="status"` on the success line; a **double-label-gone** assertion (no `New value`/`Value` sub-label text node in a row).
- **AdminPluginsConfigSection** (`tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`): Save disabled while the input is blank and enabled after typing; the `required` badge still renders; no `New value` sub-label; `role` on status lines.
- **CodingCredentialsSection**: add the missing `role="alert"` assertion on its error line (the predecessor only tested `role="status"`).
- **Reload-failure** (one per fixed section — Byok, CodingCredentials, CodeHost, AdminPluginsConfig): mock PATCH → 200 then the follow-up GET → 500; assert the error line renders and **no** success line (`p[role="status"]`) appears.

No API/schema tests change (no API/schema changes).

## 5. Visual re-baseline

Re-shoot `CodeHostSection` and `AdminPluginsConfigSection` stories (`bun shoot -g CodeHostSection`, `bun shoot -g AdminPluginsConfigSection`). Intended diffs: double-label removed; accent `*` on CodeHost required fields (CodeHost uses the shell's `required`; AdminPluginsConfig keeps its badge, so no asterisk there); rounded `2px` card corners; AdminPluginsConfig editor row alignment shift (`center`→`end`). `.storybook-shots/` is gitignored (ephemeral baselines) — screenshots are for visual verification only, not committed.

## 6. Risks & mitigations

- **CodeHost defaulted-select dirty-state** (§2.1): could look like "Save enabled for no reason" on an unconfigured host. Mitigation: it is correct (visible default ≠ unset stored); documented, and the dirty test uses a configured fixture.
- **AdminPluginsConfig alignment shift**: `align-items: center`→`end`. Mitigation: re-baselined screenshot; admin-only surface.
- **`load()` signature change**: every caller must be updated in lockstep or a caller ignores the boolean. Mitigation: TypeScript return-type change surfaces unhandled call sites; the reload-failure tests assert the behavior end-to-end.
- **Existing save tests starting non-dirty**: adding dirty-gating could disable a Save a test clicks without a prior change. Mitigation: audit each section's existing save tests; they change a field before saving (verified pattern in the predecessor), and CodeHost's dirty test uses a configured fixture.

## 7. Definition of done

- No `.settings-field*` row markup or CSS remains outside `SettingsFieldShell` in `CodeHostSection`/`AdminPluginsConfigSection`.
- CodeHostSection matches its CodingCredentials twin (ErrorState+retry, roles, whole-record dirty-state).
- AdminPluginsConfigSection uses the shell (single label, badge kept, per-field dirty-state, roles).
- No section shows a success line when its post-save reload fails.
- New tests (dirty, roles, double-label-gone, reload-failure) pass; re-baselined screenshots reviewed; `bun run check` and the affected client suites pass.
