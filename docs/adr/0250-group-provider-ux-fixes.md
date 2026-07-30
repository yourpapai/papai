<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0250: Group Provider Section UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-03

## Context

The `GroupProviderSection` UX review (`docs/ux-reviews/GroupProviderSection.md`) flagged six findings spanning two shared-primitive accessibility gaps and section-local state-handling gaps. The section gave no in-flight/disabled feedback on `Save`, rendered load failures as a bare red line with no retry, showed a blank body during initial load, left the empty state as full-brightness dead-end text, labeled options with raw internal ids, and left the `Select` unlabeled with no keyboard focus ring. The design (`docs/superpowers/specs/2026-07-03-group-provider-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-03-group-provider-ux-fixes.md`) chose **maximum scope**: fix the shared primitives at the source so every consumer inherits the improvement, add a friendly instance label surfaced from already-decrypted server config (no DB migration), and converge the direct sibling `TaskProviderSection` so the two task-instance-binding flows behave identically.

The chosen structural approach fixes shared concerns at the primitive with minimal call-site churn: a `Field` label association via Svelte context (`aria-labelledby`), a `:focus-within` focus ring on `Input`/`Select`, and a typed `FetchError` + pure `formatFetchError` plain-language mapper. A single optional `name` field is surfaced from each active instance's decrypted `config.baseUrl` on both the group and context task-instance routes.

## Decision Drivers

- **Fix shared concerns at the primitive, not the call site.** The ~19 `Field` consumers inherit the label association and focus ring for free; threading ids through every call site (the rejected Option 2) gained nothing.
- **No DB migration.** `baseUrl` already lives in the encrypted instance `config`; surfacing it is a read-only projection, not new storage.
- **Friendly, plain-language error copy everywhere.** Raw exception text never reaches the user; a single `formatFetchError` status→message map is reused by both siblings' load and save paths.
- **Converge the two task-instance-binding siblings.** `GroupProviderSection` adopts the loading/empty/error/busy affordances `TaskProviderSection` already had; `TaskProviderSection` adopts the friendly errors and instance label.
- **Deliberate, low-risk config widening.** Surfacing `baseUrl` reveals the provider URL to anyone who can open the picker (including group members); recorded as acceptable — a URL is not a secret and API keys remain encrypted.
- **DI-first tests + TDD.** Each task adds the failing test before the implementation; the `formatFetchError` status table is the primary new unit-test surface.

## Considered Options

### Option 1 — Shared-primitive fixes + `config.baseUrl` projection; no migration (chosen)

Introduce `FetchError` + `formatFetchError` in `client/shared/`, wire `Field`→`Input`/`Select` label association through Svelte context, add a `:focus-within` ring, add optional `name` to `TaskInstanceOptionSchema`, and project `config.baseUrl` onto both route handlers' option lists.

- **Pros:** every `Field` consumer inherits the a11y improvement for zero call-site churn; no migration; the friendly label and errors land identically on both siblings; the changes are additive and backward-compatible for existing debug/admin consumers that keep reading `.message`.
- **Cons:** exposes `baseUrl` to non-admin picker users (accepted trade-off); two shared components change, so the blast radius is wider than a section-only edit.

### Option 2 — Thread label ids through every `Field` call site; add a `name` DB column + migration + admin-create input

Pass an explicit `id`/`labelledby` prop into each `Field` invocation, and store the friendly name as a new DB column populated by the admin instance-create flow.

- **Pros:** no Svelte context magic; the name is admin-authored and authoritative.
- **Cons:** rejected in the design — ~19 call sites to edit for no functional gain over context, and a migration + admin UI for a value (`baseUrl`) that already exists decrypted in config.

### Option 3 — Section-local fixes only; leave shared primitives alone

Patch only `GroupProviderSection` with a local label id, local error formatting, and local busy state; do not touch `Field`/`Input`/`Select` or converge `TaskProviderSection`.

- **Pros:** smallest blast radius; no risk to other sections.
- **Cons:** duplicates the a11y/error logic in one section; the latent focus-ring and label gaps in every other consumer remain; the two siblings keep diverging.

## Decision

The chosen Option 1 shipped across all three layers (shared primitives, schema + server, consuming sections) in the nine planned tasks. What shipped:

1. **Typed `FetchError` (`client/shared/fetcher-helpers.ts`).** `requireOk` now throws `FetchError` (an `Error` + `readonly status`) instead of a plain `Error`, keeping the same message text so existing `.message` consumers are unaffected.
2. **`formatFetchError` mapper (`client/shared/format-error.ts`).** Pure status→message map: non-`FetchError` → connectivity message; 401/403 → expired-link; 404 → not-found; 400/409/422 → pass-through server text; 5xx → generic server message; else underlying message.
3. **`Field` label association via Svelte context (`client/shared/ui/field-context.ts` + `Field.svelte`).** `Field` generates a stable id (`ui-field-N`) from a module-level counter and publishes it via `setContext`; `Input`/`Select` read it and set `aria-labelledby`. Zero changes to `Field` call sites.
4. **`:focus-within` focus ring on `Input` and `Select`.** Matches the ring `Btn` already uses.
5. **Optional `name` on `TaskInstanceOptionSchema` (`client/settings/fetcher-schemas.ts`).** Single shared schema used by both group and context responses.
6. **Server projects `config.baseUrl` as `name` on both routes.** `context-task-instance-routes.ts` and `group-routes.ts` include `name: config['baseUrl']` in the active-instance option map; no DB migration.
7. **`GroupProviderSection` rewrite.** Split load/save state (`loadError`/`saveError`/`loading`/`saving`), `ErrorState` + retry on load failure, `Loading…` placeholder, muted empty state with actionable copy, `Btn` `disabled`/`busy` + "Saving…" on the save path, and the friendly `${name ?? id} (type · status)` option label.
8. **`TaskProviderSection` convergence.** All three error paths (`error`/`bindError`/`provisionError`) route through `formatFetchError`; the friendly option label is adopted; the inherited label + focus-ring improvements land with no edits.
9. **Story fixtures + visual re-shoot.** The populated group/context fixtures carry a friendly `name` plus an id-only fixture to exercise the `?? id` fallback.

## Consequences

### Positive

- Every `Field` consumer (~19 call sites) now has an accessible label→control link and a keyboard focus ring for free, not just the two task-instance sections.
- All settings-API failures reach the user as plain-language copy via one pure, unit-tested mapper; raw exception text never renders.
- The two task-instance-binding flows now behave identically: loading placeholder, muted empty state with an actionable next step, `ErrorState` + retry on load failure, and a disabled/busy save button.
- The friendly instance label (`baseUrl`, falling back to id) removes raw internal ids from both pickers with no migration and no admin-authoring burden.
- The changes are additive and backward-compatible: `FetchError` preserves the message contract, and `aria-labelledby`/the focus ring are attribute-only (no resting visual change).

### Negative

- **`baseUrl` is now visible to non-admin picker users** (including group members). Accepted as low-risk — a URL is not a secret and API keys remain encrypted — but it is a conscious widening of what the non-admin picker exposes.
- **The shared primitives gained capability beyond this plan.** `Field`/`field-context.ts`/`Input` were further extended with reactive error-state wiring (`setFieldError`/`getFieldError`, `aria-describedby`, `aria-invalid`) by the later ADR-0249 work; `Select.svelte` still carries the literal focus-ring value where `Input.svelte` was promoted to the shared `--focus-ring` token, leaving a minor internal inconsistency.
- **The shipped state machine is more defensive than the plan's.** Stale-context race guards, an in-data load-error branch, and `disabled={saving}` on the `Select` were added (see Implementation Notes), so the section is correct under rapid context switches but slightly more complex than the spec's gate.

### Risks

- **Focus-ring token drift.** `Input.svelte` uses `var(--focus-ring)`/`var(--focus-ring-offset)` while `Select.svelte` keeps the literal `rgba(82, 224, 138, 0.4)`. If the token value changes, the two controls' focus rings could diverge visually.
- **`config['baseUrl']` projection assumes every provider stores its URL under that key.** A provider that used a different config key would silently fall back to the raw id for its options; the label is only as friendly as the provider's config schema allows.

## Related Decisions

- **ADR-0248: ProfileSection UX Fixes** — sibling `2026-07-0` settings-section UX-fixes ADR from the same review-driven batch; shares the `formatFetchError`/`ErrorState`/busy-button conventions.
- **ADR-0249: Confirm-Dialog Retrofit and Schema Dedup** — drove the `Field` reactive error-state wiring (`setFieldError`/`getFieldError`, `aria-describedby`) layered on top of this ADR's label-context work.
- **ADR-0245: AI UX Review Workflow** — the review pipeline that produced the `GroupProviderSection`/`TaskProviderSection` UX reviews this ADR resolves.
- **ADR-0226: Backstage Phase 3.3 — Settings/Admin Sections Cleanup** — the shared `Btn`/`PageHeader`/`ErrorState`/`Field` primitives and section conventions these sections follow.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/fetcher-helpers.ts:23-35` | `FetchError` class + `requireOk` throws it (message unchanged). | `read` confirms. |
| `client/shared/format-error.ts:14-26` | `formatFetchError` pure status→message map (verbatim plan). | `read` confirms. |
| `client/shared/ui/field-context.ts:8-18` | `FIELD_LABEL_ID` symbol + `setFieldLabelId`/`getFieldLabelId`. | `read` confirms. |
| `client/shared/ui/Field.svelte:6-8,25-28,38` | Module `seq` counter, `labelId`/`errorId` gen, `setFieldLabelId`, `<span id={labelId}>`. | `read` confirms. |
| `client/shared/ui/Select.svelte:7,25,33,57-60` | `getFieldLabelId` import/consume, `aria-labelledby={labelId}`, `:focus-within` ring (literal). | `read` confirms. |
| `client/shared/ui/Input.svelte:9,37,59,75,93-96` | `getFieldLabelId` consume on `<textarea>` + `<input>`, `:focus-within` ring via `var(--focus-ring)`. | `read` confirms. |
| `client/settings/fetcher-schemas.ts:204-209` | `TaskInstanceOptionSchema` gains `name: z.string().optional()`; shared by group + context responses. | `read` confirms. |
| `src/debug/settings/context-task-instance-routes.ts:36-44` | `listActiveTaskInstanceOptions` maps `name: taskInstance.config['baseUrl']`. | `read` confirms. |
| `src/debug/settings/group-routes.ts:180-187` | Group `available` maps `name: taskInstance.config['baseUrl']`. | `read` confirms. |
| `client/settings/sections/GroupProviderSection.svelte:13,23-29,80-107` | `formatFetchError` import; split `loadError`/`saveError`/`loading`/`saving` state; `ErrorState`/`Loading…`/empty/`Btn busy` markup; friendly label. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:17,29,32,37,114,119,123,132,166` | `formatFetchError` import; `unknown` error states; load `ErrorState` + friendly bind/provision labels; convergence. | `read` confirms. |
| `client/stories/msw/settings-handlers-group.ts:83-86` | Populated group fixture with `name` + id-only `inst_bare` fallback. | `grep` confirms. |
| `client/stories/msw/settings-handlers.ts:242` | Context task-instance fixture with `name`. | `grep` confirms. |
| `tests/client/settings/sections/GroupProviderSection.test.ts:197,216,291,305,321,338` | Error-retry, busy-save, `aria-labelledby`, Select-disabled-while-saving, post-save-reload-no-takeover, stale-context race guard. | `grep` confirms. |
| `tests/debug/settings/context-task-instance-routes.test.ts:214-222` | GET surfaces `config.baseUrl` as option `name`. | `grep` confirms. |
| `tests/debug/settings/group-routes.test.ts:333-352` | Group task-instance GET surfaces `config.baseUrl` as option `name`. | `grep` confirms. |

Plan-vs-implementation divergences:

- **`Field`/`field-context.ts`/`Input` grew a second error context.** The plan's `field-context.ts` exported only `FIELD_LABEL_ID` (label association). The shipped module adds a `FIELD_ERROR` symbol with `setFieldError`/`getFieldError` (`field-context.ts:20-37`), `Field.svelte` gained an `error` prop + `errorId` + `role="alert"` (`:20,27,42`), and `Input.svelte` wires `aria-invalid`/`aria-describedby` (`:38-40,60-61,76-77`). This error-state wiring was layered on by the later ADR-0249 (Confirm-Dialog Retrofit) work; intent of this plan's label association is unchanged.
- **Focus-ring token promotion is partial.** The plan specified the literal `rgba(82, 224, 138, 0.4)` on both `Input` and `Select` (the design's optional shared-token cleanup was not adopted by the plan). Shipped: `Input.svelte:94-95` uses `var(--focus-ring)`/`var(--focus-ring-offset)` (token promoted, matching `Btn`/`Combobox`/`IconButton`), but `Select.svelte:57-60` retains the literal — a minor inconsistency between the two controls.
- **`GroupProviderSection` state machine is more defensive than the plan.** (a) A stale-context race guard `if (id !== contextId) return` gates the `data`/`loadError`/`loading` writes in `load()` (`GroupProviderSection.svelte:38,46,48`; test `:338`) — not in the plan. (b) The top-level `ErrorState` gate is `loadError !== null && data === null` (`:80`), and an extra in-data `{#if loadError !== null}<p class="status-error" role="alert" …>` branch (`:85-87`; test `:321`) keeps the form visible on a failed **post-save reload** instead of a full `ErrorState` takeover as the plan's gate would have. (c) `disabled={saving}` on the `Select` (`:99`; test `:305`) — not in the plan.
- **`TaskProviderSection` converged with matching divergences.** It gained the same stale-context race guard (`:48,57,59`), the same in-data load-error branch (`:113,118-120`), and `disabled={binding}` on its `Select` (`:134`) — none of which were in the plan's Task 8, but all consistent with the GroupProvider rewrite.
- **`config['baseUrl']` bracket access vs. the plan's `config.baseUrl`.** The plan/spec used dotted property access; shipped uses bracket access because the instance config is a `Record<string, string>`. Functionally identical.

The source plan `docs/superpowers/plans/2026-07-03-group-provider-ux-fixes.md` and design `docs/superpowers/specs/2026-07-03-group-provider-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
