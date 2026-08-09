<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AdminInstancesSection Open Findings — Design

**Goal:** Close all twelve open findings in `docs/ux-reviews/AdminInstancesSection.md` by adopting
patterns the codebase already uses, extracting the one piece with real logic into a testable pure
module.

**Scope:** `client/settings/sections/admin/AdminInstancesSection.svelte` and its story fixtures. No
shared primitive under `client/shared/ui/` is modified — every primitive this work needs
(`ErrorState`, `EmptyState`, `Field` with `required`/`error`, `Btn` with `busy`, `DataTable` with
`width`/`sortable`, `PageHeader` with `sub`) already exists and is already used elsewhere.

## Context

The review (commit `3e61cacd1`) scored the section 4 `fail` / 4 `warn` / 1 `pass` across the nine
rubric dimensions. The failures cluster: the section was written before the shared state primitives
existed and never adopted them, so it hand-rolls loading, error, and empty handling that every
sibling section gets from `ErrorState` and `EmptyState`. Most of this backlog is adoption, not
invention.

## Architecture

One new pure module; everything else is edits in place.

### `client/settings/sections/admin/instance-create.ts`

```ts
export interface InstanceCreateErrors {
  id?: string
  type?: string
}

export function validateInstanceCreate(input: {
  id: string
  type: string
  existingIds: readonly string[]
}): InstanceCreateErrors
```

Returns a per-field error map; an empty object means valid. Rules:

- `id` trimmed and empty → `'Required'`
- `id` trimmed and present in `existingIds` → `'An instance with this id already exists'`
- `type` empty → `'Required'`

The module knows nothing about platform versus task instances; each form passes its own id list.
Pure and synchronous, so it is unit-tested directly rather than through the DOM. It follows the
`mcp-posture.ts` precedent — a pure module beside the admin section that consumes it.

Per the knip `--strict` constraint established in the transcript sub-project, this module must land
in the **same commit** as its Svelte consumer: knip analyses production entry points only, so a
module imported solely by its own test reads as an unused file.

### Validation semantics

Client validation mirrors the server (`src/debug/settings/admin/instances-routes.ts:38-49`:
`id: z.string().min(1)`, `type` a fixed enum) and adds one rule the server cannot cheaply give a
good message for: a duplicate id currently reaches the database unique constraint and returns an
opaque error, while the client already holds the full instance list. No format or slug rule is
added — that would reject ids the API accepts and that may already exist in a deployment.

**When errors render.** Field errors show only for fields the operator has touched, tracked in a
per-form `Set<string>` populated on blur, with one exception: the duplicate-id error renders as soon
as the typed id collides, touched or not. A pristine form must not be pre-reddened, but an id that
is already doomed should say so before submit. The Create button is disabled whenever the error map
is non-empty, independent of touched state.

## Changes by finding

| Finding id                                | Change                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `admin-instances-loading-reads-as-empty`  | `{#if loading && rows.length === 0}` → `<p class="placeholder">Loading…</p>`, per `PluginsSection.svelte:84`      |
| `admin-instances-create-no-validation`    | `validateInstanceCreate` gates the submit button; `Field` `required`/`error` carry the reason                     |
| `admin-instances-subheads-not-headings`   | four `<div class="t-subhead">` → `<h3 class="t-subhead">`, under `PageHeader`'s `<h2>`                            |
| `admin-instances-raw-error-string`        | `ErrorState` with a written message, `detail={error}` for the raw text, `onRetry={() => void load()}`             |
| `admin-instances-delete-understates-impact` | confirm body states the operational cost, matching Stop's precedent                                             |
| `admin-instances-status-not-announced`    | `role="status"` on the success line, `role="alert"` on the inline error line                                      |
| `admin-instances-apply-unexplained`       | `PageHeader sub="Starts and stops platform connections so the running bot matches the table below."`              |
| `admin-instances-row-actions-no-busy`     | per-row pending id in `$state`; that row's button gets `busy` and `disabled`                                      |
| `admin-instances-config-fields-unshot`    | real `instanceConfigSchema` for telegram, mattermost, and kaneo in the msw fixture                                |
| `admin-instances-table-columns-misaligned` | `width` on the shared `instanceColumns`                                                                          |
| `admin-instances-hardcoded-card-padding`  | `padding: 16px` → `var(--s4)`                                                                                     |
| `admin-instances-tables-not-sortable`     | `sortable` on the id and status columns                                                                           |

### One unfiled correction, folded in

`AdminInstancesSection.svelte:330` hand-rolls the required marker as
`` `${field.label}${field.required ? ' *' : ''}` `` instead of passing `Field`'s `required` prop. The
review could not see this because no fixture rendered the config block. It sits inside Task 1's diff
and is a one-line correction to the same design-system rule that motivates half this backlog, so it
is fixed here rather than filed for a later cycle.

## Tasks

Seven tasks, each ending in a commit and its own review.

1. **Fixtures and config-field markup.** Real `instanceConfigSchema` in
   `client/stories/msw/settings-handlers-admin-2.ts` for telegram (bot token, `sensitive`),
   mattermost (server URL, access token `sensitive`), and kaneo (base URL, API key `sensitive`);
   `Field required` replaces the hand-rolled `*`. Re-shoot — this is the task that first puts the
   credential fields on film. Closes `admin-instances-config-fields-unshot`.
2. **`instance-create.ts` and validation wiring.** Unit tests for the rule module, then both create
   forms consume it. Closes `admin-instances-create-no-validation`.
3. **Loading, error, and empty.** The `PluginsSection` trio: placeholder while loading, `ErrorState`
   with `detail` and retry, `EmptyState` replacing the bare `{#snippet empty()}` strings. Closes
   `admin-instances-loading-reads-as-empty` and `admin-instances-raw-error-string`.
4. **Accessibility and copy.** `<h3>` subheads, `role="status"` / `role="alert"`, `PageHeader sub`,
   delete-confirm copy. Closes `admin-instances-subheads-not-headings`,
   `admin-instances-status-not-announced`, `admin-instances-apply-unexplained`, and
   `admin-instances-delete-understates-impact`. No logic change.
5. **Row-action busy state.** Closes `admin-instances-row-actions-no-busy`.
6. **Table polish.** Column `width`s, `sortable` on id and status, `--s4`. Closes
   `admin-instances-table-columns-misaligned`, `admin-instances-tables-not-sortable`, and
   `admin-instances-hardcoded-card-padding`.
7. **Mark the twelve findings `fixed`** in `docs/ux-reviews/AdminInstancesSection.md`, each with a
   `- **Resolved:**` line naming its commit, then regenerate the backlog with `bun run ux:backlog`.

**Ordering.** Task 1 must land before Task 2: the fixture change is what makes Task 2's validation
states visible to a screenshot. Tasks 3 through 6 are independent of each other.

## Testing

- **Unit.** `tests/client/settings/sections/admin/instance-create.test.ts` covers the rule module
  directly — blank id, blank type, duplicate id, valid input, and that a trimmed-to-empty id counts
  as blank.
- **Component.** Extend `tests/client/settings/sections/admin/AdminInstancesSection.test.ts` for the
  behaviours that need a rendered tree: the disabled Create button, the loading placeholder, and the
  per-row busy guard.
- **Command form.** Client tests must run as
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`.
  The bare form matches nothing and reports success without executing.
- **Visual.** `bun shoot -g AdminInstancesSection` for every task that changes rendering, and the new
  PNGs must actually be read, not merely regenerated. Any new spec test that calls
  `setViewportSize` goes below `@generated-end`, because `sharedPage` is worker-scoped and a viewport
  change leaks into the next test in that worker.
- **Gates.** The pre-commit hook runs lint, typecheck, format, and license headers.
  Run `bun run check:full` before Task 7.

## Constraints

- Never hand-edit `docs/ux-reviews/_BACKLOG.md`; regenerate it with `bun run ux:backlog`.
- Never hand-edit inside `@generated-begin`/`@generated-end auto-screenshots`.
- No shared primitive under `client/shared/ui/` is modified.
- Formatter is `oxfmt` via `bun run format`. Strict TypeScript, `.js` extensions in import paths.
- No lint-disable or type-ignore comments; a `max-lines` failure is a design signal to split, not to
  compress formatting.
- A finding is only marked `fixed` with a `Resolved:` line — the parser throws on a non-`open` status
  without one. There is no `partial`: a partially-fixed finding stays `open` with its text narrowed
  to the residue, keeping its id.
