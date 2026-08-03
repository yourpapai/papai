<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — GroupProviderSection UX fixes (+ shared primitives & sibling convergence)

**Date:** 2026-07-03
**Source review:** [`docs/ux-reviews/GroupProviderSection.md`](../../ux-reviews/GroupProviderSection.md)
**Related review:** [`docs/ux-reviews/TaskProviderSection.md`](../../ux-reviews/TaskProviderSection.md)
**Status:** approved design; implementation plan pending (writing-plans).

## Goal

Resolve every finding in the `GroupProviderSection` UX review. The findings split into
section-local state-handling gaps and two shared-primitive accessibility gaps; the review
recommends fixing the latter at the shared level. Scope was confirmed as **maximum**: fix the
section, fix the shared primitives (every consumer inherits the improvement), and converge the
direct sibling `TaskProviderSection` so the two task-instance-binding flows behave identically.

Chosen structural approach: **fix shared concerns at the primitive, with minimal call-site churn
and no DB migration** (Approach 1 of the two considered — the alternative threaded ids through
all ~19 call sites and added a `name` DB column + migration + admin-create input, for no
meaningful gain).

## Findings → resolution map

| #   | Review finding                              | Severity | Resolution                                                         | Layer                         |
| --- | ------------------------------------------- | -------- | ------------------------------------------------------------------ | ----------------------------- |
| 1   | `Save` gives no in-flight/disabled feedback | High     | `saving` flag → `Btn disabled/busy` + "Saving…"                    | section-local                 |
| 2   | `Select` unlabeled + no focus ring          | High     | Field label via context (`aria-labelledby`) + `:focus-within` ring | shared primitive              |
| 3   | Load error is a bare red line, no retry     | Med      | `ErrorState` with `onRetry`, friendly message                      | section-local + shared helper |
| 4   | Blank body during initial load              | Med      | `.placeholder` "Loading…" while `data === null && loading`         | section-local                 |
| 5   | Empty state: full-brightness text, dead end | Med      | `.placeholder` class + "Ask an admin to create one."               | section-local                 |
| 6   | Options labeled with raw internal id        | Low      | Surface `config.baseUrl` as option `name` (fallback id)            | schema + server + client      |

Finding 2 additionally repairs the same missing-focus-ring gap latent in `Input.svelte`, and the
error work (finding 3) is generalized into a shared formatter reused by both siblings.

## Architecture

Three layers, from most shared to most local.

### Layer A — Shared primitives (client)

**A1. `Field` label association via Svelte context** — `client/shared/ui/Field.svelte`,
`client/shared/ui/Input.svelte`, `client/shared/ui/Select.svelte`.

- `Field` generates one stable id per instance from a module-level counter
  (`field-1`, `field-2`, …). These SPAs are client-rendered only, so there is no
  SSR/hydration id-mismatch concern.
- `Field` renders its label as `<span id={labelId} class="ui-field__label">` and calls
  `setContext(FIELD_LABEL_ID, labelId)` during init.
- `Input` and `Select` call `getContext(FIELD_LABEL_ID)` at init; when present they set
  `aria-labelledby={labelId}` on the native `<input>` / `<textarea>` / `<select>`. When absent
  (standalone use outside a `Field`), no attribute is added — a safe no-op.
- Context key lives in a tiny shared module (e.g. `client/shared/ui/field-context.ts`) exporting
  a typed `Symbol` key so `Field` and the controls agree on the type.
- **Blast radius:** 3 component files. **Zero** changes to the ~19 `Field` call sites. No visual
  change (attribute-only).

**A2. Keyboard focus ring** — `client/shared/ui/Input.svelte`, `client/shared/ui/Select.svelte`.

- Add a `:focus-within` outline to the `.ui-input` and `.ui-select` wrappers matching the ring
  `Btn` already uses (`Btn.svelte:74-77`): `outline: 2px solid rgba(82, 224, 138, 0.4);
outline-offset: 1px`. (Optional cleanup: promote the literal to a shared `--focus-ring` token
  reused by `Btn` too; not required for this change.)
- Focus-only styling → resting visual baselines are unaffected; only the focused-state shots
  change.

**A3. Typed fetch error + shared formatter** — `client/shared/fetcher-helpers.ts`, new
`client/shared/format-error.ts`.

- Introduce `class FetchError extends Error { readonly status: number }`. `requireOk` throws it
  instead of a plain `Error`, keeping the **same message text** (server `body.error` or
  `request failed with status <code>`), so any consumer still reading `.message` is unaffected.
- `formatFetchError(err: unknown): string` maps to plain language:
  - not a `FetchError` (thrown before/without a response — e.g. `TypeError` network failure) →
    "Couldn't reach the server. Check your connection and try again."
  - `status` 401 / 403 → "Your settings link may have expired. Send `/config` to the bot for a
    new one."
  - `status` 404 → "Not found — it may have been removed."
  - `status` 400 / 409 / 422 → pass through the underlying message (server validation text is
    meaningful and specific).
  - `status` >= 500 → "Something went wrong on the server. Try again shortly."
  - fallback → underlying message, else a generic line.
- Pure function; the primary new unit-test surface.
- Backward-compatible for debug/admin consumers that keep rendering `.message` and never call
  `formatFetchError`.

### Layer B — Schema + server (friendly instance label)

**B1. Option schema** — `client/settings/fetcher-schemas.ts:187`.

- Add `name: z.string().optional()` to `TaskInstanceOptionSchema`. Both the group and context
  responses reuse this one schema (per the comment at `:196`), so this is a single change.

**B2. Server option assembly** — `src/debug/settings/group-routes.ts:180-182` and
`src/debug/settings/context-task-instance-routes.ts:36-40`.

- Both handlers already decrypt each instance's `config` before reducing it to
  `{id, type, status}`. Include `name: config.baseUrl` (the instance-scoped "Kaneo URL" /
  "YouTrack URL" field both providers define) when present, else leave `undefined`.
- **No DB migration**: `baseUrl` already exists in the encrypted `config`; nothing new is stored.
- **Deliberate exposure trade-off:** the non-admin picker lists intentionally strip config down
  to `{id,type,status}` today. Surfacing `baseUrl` reveals the provider URL to anyone who can
  open the settings picker (including group members). Accepted as low-risk — a URL is not a
  secret and API keys remain encrypted and unexposed — but recorded here as a conscious widening.

### Layer C — Consuming sections

**C1. `GroupProviderSection.svelte` (section-local fixes)**

- **Save busy:** add `saving = $state(false)`; set it around the PATCH in `save()`; render
  `<Btn variant="primary" type="submit" disabled={saving} busy={saving}>{saving ? 'Saving…' :
'Save'}</Btn>`. Mirrors the sibling's `Bind` button.
- **Load error → `ErrorState`:** replace `<p class="status-error">{error}</p>` with
  `<ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />`, and
  restructure the body gate to the sibling's shape:
  `{#if error}<ErrorState .../>{:else if loading && data === null}<p class="placeholder">Loading…</p>{:else}…form…{/if}`,
  so the form does not render alongside an error.
- **Empty state:** `<p class="placeholder">No active task instances available. Ask an admin to
create one.</p>` (verbatim sibling copy — adds the muted `.placeholder` class and an
  actionable next step).
- **Save-path error** is also passed through `formatFetchError`.

**C2. Option label rendering (both siblings)**

- `GroupProviderSection.svelte:82` and `TaskProviderSection.svelte:126` change the option map to
  `label: \`${o.name ?? o.id} (${o.type} · ${o.status})\``. The raw id becomes a fallback only.

**C3. `TaskProviderSection.svelte` convergence**

- Inherits A1 (label) and A2 (focus ring) with no edits.
- Route its three error paths (`error` at `:110-111`, `bindError` at `:117`,
  `provisionError` at `:159`) through `formatFetchError`.
- Adopt the friendly option label (C2).
- Its loading / empty / bind-busy states already exist and are unchanged.

## Components & interfaces (summary)

- `field-context.ts` — exports `FIELD_LABEL_ID` (typed context key). Depends on nothing.
- `Field` — publishes a generated label id via context; renders labeled `<span id>`. Consumers
  unchanged.
- `Input` / `Select` — consume the context id → `aria-labelledby`; add `:focus-within` ring.
  Standalone use unaffected.
- `FetchError` (in `fetcher-helpers.ts`) — `Error` + `status`. Thrown by `requireOk`.
- `formatFetchError(err) → string` (in `format-error.ts`) — pure status→message map. Depends on
  `FetchError`.
- `TaskInstanceOptionSchema` — gains optional `name`. Server sets it from `config.baseUrl`.
- `GroupProviderSection` / `TaskProviderSection` — adopt `formatFetchError`, the friendly label,
  and (GroupProvider only) the missing loading/empty/busy/error affordances.

## Data flow

1. User opens the group/context task-provider picker.
2. Server handler decrypts each active instance's config, emits
   `{ id, type, status, name: config.baseUrl }`.
3. Client renders each option as `name ?? id (type · status)`.
4. On save, the section sets `saving`, PATCHes, and on failure passes the thrown `FetchError`
   through `formatFetchError` into either the inline status line (save path) or `ErrorState`
   (load path).
5. Keyboard focus on the `Select` shows the shared `:focus-within` ring; assistive tech announces
   the control via the `aria-labelledby` link to the `Field` label.

## Error handling

- All settings API failures become `FetchError` with a status; UI copy comes from
  `formatFetchError`, never raw exception text.
- Validation errors (4xx with a server message) still surface the server's specific text.
- Load failure renders `ErrorState` with a retry that re-runs `load(contextId)`; save failure
  renders an inline `.status-error` line (unchanged placement), just with friendly text.

## Testing

- **Unit — `format-error` spec (primary):** status table (network/offline, 401, 403, 404, 400,
  409, 422, 500, 503), the passthrough case for validation messages, and the non-`FetchError`
  fallback.
- **Story fixtures:** add `name`/`baseUrl` to the populated task-instance fixtures for both
  siblings; keep an id-only fixture to exercise the `?? id` fallback.
- **Visual (Storybook screenshots):** re-shoot both siblings. Intended baseline churn —
  GroupProvider: Error (now `ErrorState`), Loading (placeholder), Empty (copy + muted), Populated
  (friendly label), plus new Save-busy and Select-focus states; TaskProvider: Populated (label),
  Error (friendly text). Shared `Field`/`Input`/`Select` stories gain focus-state shots; resting
  shots are unchanged.
- **A11y confirmation:** verify from source and the focused-select shot that `aria-labelledby`
  resolves to the `Field` label and the `:focus-within` ring renders.

## Scope guard (explicitly out)

- No DB migration; no change to the admin instance-create flow.
- No promotion of `config` beyond `baseUrl` in picker lists.
- No unrelated refactors. The `FetchError` and `Field` context changes are additive and
  backward-compatible for existing debug/admin consumers.
  </content>
