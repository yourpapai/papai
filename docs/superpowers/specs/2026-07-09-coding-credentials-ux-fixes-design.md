<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Coding-cluster credential UX fixes

**Date:** 2026-07-09
**Source review:** [`docs/ux-reviews/CodingCredentialsSection.md`](../../ux-reviews/CodingCredentialsSection.md)
**Status:** approved design, pending implementation plan

## Problem

The UX review of `CodingCredentialsSection` found that its select/combobox controls
bypass the design system: raw `<select>` / `<input list>` elements styled by a one-off
`.coding-select` class that (a) uses the field card's own background token so controls
blend into their card, (b) carries no app focus ring, and (c) sits off the shared
font/radius/padding scale. Investigation showed the **same byte-identical
`.coding-select` block is triplicated** across the whole coding cluster —
`CodingCredentialsSection`, `CodeHostSection`, `CodingMcpSection` — so the defect is a
shared root cause, not a local one.

The review also found the Storybook stories serve the wrong (`forge`) fixture shape, so
the real `agent-provider` form is never screenshotted, and the `fields: []` empty fixture
shows a dead-end (helper text over a disabled Save) that cannot occur in production.

## Scope

In scope (confirmed with stakeholder):

- **Whole-cluster** migration of the raw selects/combobox to shared primitives.
- **H1** — repoint the `CodingCredentialsSection` stories to realistic `agent-provider`
  fixtures (populated + realistic empty).
- **Empty-state guard** in `CodingCredentialsSection`.
- **Model-suggestion hint** in `CodingCredentialsSection`.

Out of scope:

- Dynamic-field helper text for the Auth method / Base URL reveals (review's last Low
  finding) — deliberately deferred.
- Any change to `CodeHostSection` / `CodingMcpSection` beyond the mechanical primitive
  swap.

## Approach

Enhance the existing shared primitives and migrate all three sections onto them (chosen
over a shared-CSS-only fix, which would leave two parallel select implementations, and
over extending `Input` for the combobox, which would widen `Input`'s API for one caller).

### 1. Shared primitives

**`client/shared/ui/Select.svelte` — add optional `placeholder` prop.**

- New prop `placeholder?: string`. When set, render a leading
  `<option value="" disabled>{placeholder}</option>` before the mapped options (visible
  while `value === ''`). Replaces `CodingMcpSection`'s hand-rolled disabled option.
- No change for existing callers (prop optional). Testid stays on the inner native
  `<select>`; caret, `--raised` background, `--radius-control`, mono 12px, `:focus-within`
  ring, and `disabled` opacity are unchanged.

**`client/shared/ui/Combobox.svelte` — new primitive** (model field; no shared equivalent
exists today — `datalist` currently appears only in `CodingCredentialsSection`).

- Props: `value: string`, `options: { value: string; label?: string }[]`,
  `onInput?: (v: string) => void`, `placeholder?: string`, `disabled?: boolean`,
  `testid?: string`.
- Reads the field label id from context via `getFieldLabelId()` (same as `Select` /
  `Input`) so it stays accessible inside `SettingsFieldShell`.
- Markup mirrors `Input`: a `.ui-combobox` wrapper (border, `--raised` background,
  `--radius-control`, `:focus-within` → `--focus-ring`) containing `<input list={autoId}>`
  and a sibling `<datalist id={autoId}>` of option values. Inner input styled like
  `Input`'s (transparent, mono 12px).
- Ships with a Storybook story so the primitive is covered by the visual harness.

### 2. Section migrations

Each migration deletes that section's `.coding-select` style block.

- **`CodingCredentialsSection`** — select branch →
  `<Select options={selectOptionsFor(field).map((o) => ({ value: o, label: o }))}
onChange={(v) => onSelectChange(field, v)} disabled={saving || loading}
testid={`coding-select-${field.key}`} />` (preserves the agent→provider cross-field
  reset). Combobox branch → `<Combobox options={modelOptions}
  onInput={(v) => updateDraft(field.key, v)}
  placeholder="model id (leave blank for the agent default)"
  testid={`coding-combobox-${field.key}`} />`.
- **`CodeHostSection`** — select branch → `<Select>` with
  `onChange={(v) => updateDraft(field.key, v)}`; existing draft-initialization (the
  "empty `<select>` renders the first option" default) left untouched.
- **`CodingMcpSection`** — select branch →
  `<Select placeholder="Select an MCP server…"
disabled={saving || loading || catalogEmpty}
onChange={(v) => updateDraft(field.key, v)}>`.

All existing testids (`coding-select-*`, `coding-mcp-select-*`, `coding-combobox-*`) stay
on the inner elements, so component and visual specs keep resolving. In particular the
component test queries `[data-testid="coding-select-agent"]` as an `HTMLSelectElement` and
reads `.options` / sets `.value` / dispatches `change` — all of which continue to work
because the testid remains on the native `<select>` rendered by the primitive.

### 3. Content / robustness fixes (`CodingCredentialsSection` only)

- **Empty-state guard** — render the fields grid + actions row only when
  `fields.length > 0`; otherwise show a single `.placeholder` line ("No provider fields
  available — try Refresh.") and no disabled Save. Reuses the `.placeholder` style already
  in the file. Defensive (the server always returns the field skeleton) but removes the
  dead-end.
- **Model-suggestion hint** — a conditional `Caption` under the model combobox, shown when
  suggestions are unavailable because the key is not yet saved (reusing the existing
  visibility condition from the model-loading `$effect`, ~lines 221–242 — no new state):
  "Save your API key to load model suggestions."

## Fixtures & stories (H1)

`client/stories/msw/settings-handlers-personal.ts`:

- **`codingCredentialsPopulated`** → `namespace: 'agent-provider'`,
  `configured/complete: true`, real field skeleton from `FIELDS_META['agent-provider']`:
  `agent` (select, `claude`), `provider` (select, `anthropic`), `auth_method` (select),
  `provider_api_key` (secret, `hasValue: true`, masked), `provider_base_url` (empty),
  `model` (combobox, e.g. `claude-sonnet-4`), `allowedAgents: ['claude','codex','opencode']`.
- **`codingCredentialsEmpty`** → same skeleton with `hasValue: false` / `value: ''`,
  `configured: false`, `complete: false`, `missing: ['provider_api_key']` — matching the
  real unconfigured response (not `fields: []`).
- **Add a models handler** for `/settings/api/coding-credentials/models` returning a few
  ids, wired into the populated scenario so the combobox datalist has suggestions to shoot.
- Update `scenarios.ts` only if new handler wiring requires it.

Visual spec `tests/visual/settings/sections/CodingCredentialsSection.spec.ts`: rework the
manual states from the forge fields to the agent-provider fields (focus
`coding-input-provider_api_key`, replace the API-key secret, change the agent `Select`,
hover Save when dirty, open clear-confirm), then re-shoot baselines with
`bun shoot -g CodingCredentialsSection`. Re-shoot the `CodeHostSection` /
`CodingMcpSection` baselines too, since the primitive swap changes their rendered markup.

## Testing

- **Component test** `tests/client/settings/coding-credentials-section.test.ts` (870 lines)
  — expected green after migration (testids preserved); add a case asserting the
  empty-guard `.placeholder` renders when `fields` is empty.
- **Handler schema test** `tests/client/stories/msw/settings-handlers-personal.test.ts` —
  update expectations to the new agent-provider fixture shape.
- **New `Combobox`** — render/onInput unit test alongside the other `shared/ui` primitives,
  plus the story.
- **Sibling sections** — run existing `CodeHostSection` / `CodingMcpSection` tests to
  confirm the placeholder option and option counts still match.
- **Gates** — `bun run format` (oxfmt), typecheck, lint (`max-lines` should _decrease_ as
  three style blocks are deleted), `bun security`, and a full re-shoot of the cluster
  visual baselines.

## Touched files

- `client/shared/ui/Select.svelte` (+`placeholder` prop)
- `client/shared/ui/Combobox.svelte` (new) + `Combobox.stories.svelte` + primitive test
- `client/settings/sections/CodingCredentialsSection.svelte`
- `client/settings/sections/CodeHostSection.svelte`
- `client/settings/sections/CodingMcpSection.svelte`
- `client/stories/msw/settings-handlers-personal.ts` (+ models handler; maybe
  `scenarios.ts`)
- `tests/visual/settings/sections/CodingCredentialsSection.spec.ts` (+ re-shot baselines
  for all three cluster sections)
- `tests/client/stories/msw/settings-handlers-personal.test.ts`
- `tests/client/settings/coding-credentials-section.test.ts` (add empty-guard case)

## Risks / notes

- The primitive swap changes rendered markup for `CodeHostSection` and `CodingMcpSection`
  (un-reviewed sections), so their visual baselines and any option-count assertions must be
  re-verified, not assumed.
- `Select`'s new `placeholder` renders an extra leading `<option>`; confirm no existing
  `Select` test counts options strictly.
  </content>
