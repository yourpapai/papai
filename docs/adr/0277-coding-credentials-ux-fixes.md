<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0277: Coding Credentials UX Fixes

## Status

Implemented

## Date

2026-07-09

## Context

A UX review of `CodingCredentialsSection` (`docs/ux-reviews/CodingCredentialsSection.md`) found that its select/combobox controls bypassed the design system: raw `<select>` / `<input list>` elements styled by a one-off `.coding-select` class that (a) used the field card's own background token so the controls blended into their card, (b) carried no app focus ring, and (c) sat off the shared font/radius/padding scale. Investigation showed the **same byte-identical `.coding-select` block was triplicated** across the whole coding cluster — `CodingCredentialsSection`, `CodeHostSection`, `CodingMcpSection` — so the defect was a shared root cause, not a local one.

The review also found two content defects in `CodingCredentialsSection` itself:

1. **Misleading Storybook fixtures (H1).** The stories served the wrong (`forge`) fixture shape, so the real `agent-provider` form was never screenshotted — the visual harness validated a form the section never renders, and the model combobox's `datalist` had no suggestions to shoot against. The `fields: []` empty fixture additionally painted a dead-end (helper text over a disabled Save) that cannot occur in production.
2. **Two local UX gaps.** An empty-state dead-end (the `.placeholder` helper text rendered above a disabled Save button with no fields to fill), and an opaque model-suggestion dropdown — the combobox's `datalist` is only populated once the API key is saved (the model-loading `$effect` gates on a saved key), but nothing told a first-time user *why* the dropdown was empty, so it read as broken.

The design (`docs/superpowers/specs/2026-07-09-coding-credentials-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-09-coding-credentials-ux-fixes.md`) closed all of these by enhancing the shared primitives, migrating the whole cluster onto them, repointing the fixtures to a realistic `agent-provider` shape with a models endpoint, and adding an empty-state guard plus a model-suggestion hint. Scope is client-only; no backend, schema, or route change.

## Decision Drivers

- **Fix the shared root cause, not the symptom.** The `.coding-select` block is byte-identical across three sections; a per-section CSS tweak would leave three parallel one-off implementations and the same defect re-emerging on the next section.
- **Stay on the design-system scale.** Selects/comboboxes must use the same `--raised` background, `--radius-control` / radius, mono 12px font, and `:focus-within` focus ring as the other shared primitives, so they read as the same control family inside `SettingsFieldShell`.
- **Preserve testids verbatim.** The 870-line `coding-credentials-section.test.ts` regression harness and the visual specs query `[data-testid="coding-select-agent"]` as an `HTMLSelectElement` and read `.options` / set `.value` / dispatch `change`. The migration must keep the testid on the native `<select>` rendered by the primitive so all existing assertions keep resolving.
- **No new state for the model hint.** The hint's visibility condition must reuse the existing model-loading `$effect`'s signal (a saved API key), not introduce fresh reactive state.
- **Realistic fixtures.** The Storybook fixtures must match the real `agent-provider` response skeleton (`FIELDS_META['agent-provider']`), including a models handler wired into the populated scenario so the combobox has suggestions to shoot.
- **No ripple into the backend.** The fix is presentation-only; the `agent-provider` field skeleton and the `/settings/api/coding-credentials/models` endpoint already exist server-side.

## Considered Options

### Option 1 — Enhance the shared primitives and migrate the whole cluster onto them (chosen)

Add an optional `placeholder` prop to the existing `Select` primitive (a leading disabled `<option>`), introduce a new `Combobox` primitive (an `Input`-styled shell wrapping `<input list>` + `<datalist>`, reading the field label id from context), and swap the raw controls in all three coding-cluster sections for these primitives, deleting each section's `.coding-select` style block.

- **Pros:** removes the triplication at its source; every coding-cluster control joins the design-system scale (background, radius, font, focus ring) for free; the new `Combobox` is reusable beyond the one caller; the `placeholder` prop subsumes `CodingMcpSection`'s hand-rolled disabled option; testids stay on the primitives' inner native elements, so the regression harness and visual specs keep resolving unchanged.
- **Cons:** introduces one new shared primitive (`Combobox`) plus its story and test; touches two un-reviewed sibling sections (`CodeHostSection`, `CodingMcpSection`) whose visual baselines must be re-shot.

### Option 2 — Shared-CSS-only fix (extract `.coding-select` into a common sheet)

Move the byte-identical `.coding-select` block into a shared stylesheet and keep the raw `<select>`/`<input list>` markup in all three sections.

- **Pros:** smallest diff; no new primitive; no markup change to the sibling sections.
- **Cons:** leaves two parallel select implementations (the shared `Select` primitive already used elsewhere, plus the raw `<select>` in the coding cluster); the controls still lack the design-system focus ring and caret unless re-styled inline (which re-introduces divergence); does not address the `CodingMcpSection` hand-rolled placeholder option; the combobox's `<input list>` stays unstyled relative to `Input`.

### Option 3 — Extend `Input` to cover the combobox case

Add a `list`/`options` mode to the existing `Input` primitive instead of introducing `Combobox`.

- **Pros:** no new primitive file; one fewer story/test to maintain.
- **Cons:** widens `Input`'s API for a single caller (the model field is the only `datalist` consumer today), blurring `Input`'s responsibility; `Input` has no `<datalist>` rendering today, so the change is not trivial; does nothing for the `<select>` migration, which still needs `Select`.

## Decision

The chosen Option 1 shipped across the two shared primitives, all three coding-cluster sections, the MSW fixtures + models handler, the component/handler unit tests, and the visual spec. What shipped:

1. **`Select` gains an optional `placeholder` prop** (`client/shared/ui/Select.svelte`). When set, a leading `<option value="" disabled>{placeholder}</option>` renders before the mapped options, reproducing `CodingMcpSection`'s hand-rolled disabled option via the primitive.
2. **New `Combobox` primitive** (`client/shared/ui/Combobox.svelte`). A `.ui-combobox` wrapper (border, `--raised` background, `--radius-control`, `:focus-within` → `--focus-ring`) containing `<input list={autoId}>` and a sibling `<datalist id={autoId}>` of option values; the inner input is styled like `Input`'s (transparent, mono 12px). The stable datalist id comes from a per-instance module sequence; the field label id is read from context via `getFieldLabelId()`, so it stays accessible inside `SettingsFieldShell`.
3. **`CodingCredentialsSection` migration** (`client/settings/sections/CodingCredentialsSection.svelte`). The `select` branch → `<Select>` (preserving the agent→provider cross-field reset via `onSelectChange`); the `combobox` branch → `<Combobox>`; the text/secret `Input` branch is untouched. The `.coding-select` style block is deleted and a `.field-hint` rule added in its place.
4. **Empty-state guard** (`CodingCredentialsSection`). The fields grid + actions row render only when `fields.length > 0`; otherwise a single `.placeholder` line ("No provider fields available — try Refresh.") shows and no disabled Save — removing the dead-end. Defensive (the server always returns the field skeleton) but harmless.
5. **Model-suggestion hint** (`CodingCredentialsSection`). A derived `hasSavedKey` flag (`fields.find(... provider_api_key)?.hasValue === true`) drives a conditional `<p class="field-hint">` in the `SettingsFieldShell` footer snippet: "Save your API key to load model suggestions." — shown only for the combobox field before the key is saved. No new state; the flag reuses the same signal the model-loading `$effect` gates on.
6. **`CodeHostSection` migration** (`client/settings/sections/CodeHostSection.svelte`). The `select` branch → `<Select>` with `onChange={(v) => updateDraft(field.key, v)}`; the existing draft-initialization default-first-option logic is untouched; `.coding-select` deleted.
7. **`CodingMcpSection` migration** (`client/settings/sections/CodingMcpSection.svelte`). The `select` branch → `<Select>` with `placeholder="Select an MCP server…"` (the primitive's leading disabled option replaces the hand-rolled one); `.coding-select` deleted.
8. **Realistic `agent-provider` fixtures + models handler** (`client/stories/msw/settings-handlers-personal.ts`). Populated and empty fixtures carry the real `agent-provider` skeleton (`agent`/`provider`/`auth_method` selects, `provider_api_key` secret, `provider_base_url`, `model` combobox, `allowedAgents`); a `/settings/api/coding-credentials/models` handler returns a few model ids and is wired into both the populated and empty scenarios (registered before the base `/coding-credentials` handler for MSW's most-specific-first matching).
9. **Test coverage.** `Select` placeholder-option test, three-case `Combobox` unit test (render/datalist, onInput, disabled), a models-endpoint handler-path assertion, an empty-guard component test (`.placeholder` renders, Save absent when `fields: []`), and the full pre-existing 870-line regression suite stays green (testids preserved).
10. **Visual spec rework** (`tests/visual/settings/sections/CodingCredentialsSection.spec.ts`). Manual states reworked from the forge fields to the agent-provider fields: narrow-640 Populated/Empty, base-URL input focus, API-key replace open, dirty Save hover, clear-confirm dialog.

## Consequences

### Positive

- The coding cluster's triplicated `.coding-select` block is gone; all three sections now render selects/comboboxes through the shared primitives, so they pick up the design-system background, radius, font, focus ring, and caret uniformly and diverge only in props.
- `Combobox` is now a first-class shared primitive reusable beyond the one model-field caller, with its own story and unit test in the visual/primitive harness.
- The Storybook fixtures match the real `agent-provider` response, so the visual harness validates the form users actually see, and the combobox has suggestions to shoot against (models handler wired).
- The empty-state dead-end is gone; a `fields: []` response renders a single helpful line and no action row.
- The model-suggestion dropdown is no longer opaque — a first-time user is told to save the API key before the empty dropdown reads as broken.
- Testids stayed on the primitives' inner native elements, so the 870-line regression harness and the visual specs resolved without rewrites.

### Negative

- The primitive swap changes rendered markup for `CodeHostSection` and `CodingMcpSection` (un-reviewed sibling sections), so their visual baselines had to be re-shot; the new markup (caret, focus ring) is now the contract.
- `Select`'s new `placeholder` renders an extra leading `<option>`; any caller that strictly counts options must account for it (no existing caller did — confirmed by the green option-count test).
- The empty-state guard is defensive against a shape the server does not currently emit (it always returns the field skeleton), so the guard branch is exercised by the new test but not by production traffic today.

### Risks

- **`Combobox`'s datalist id is a per-instance module sequence.** If a future caller mounts many `Combobox` instances in a list keyed by index, the ids remain unique (sequence increments per instance), but the `<datalist>` is resolved by `list={id}` string match — a manually-set duplicate id elsewhere in the DOM could shadow it. Low risk (no such caller today).
- **The model-hint wording assumes the only barrier to suggestions is an unsaved key.** If a future change makes model loading also depend on, e.g., a valid `provider_base_url`, the hint would mislead by implying saving the key alone suffices. The hint's visibility condition would need to track the real gate.
- **The empty-guard string is a UX assertion, not a server contract.** The server always returns the field skeleton; if a future server change emits `fields: []` in a legitimately-configured state, the guard would surface "try Refresh" where a different message would be more accurate.

## Related Decisions

- **ADR-0241 (Coding Credentials Clear/Reset UI)** — established the `CodingCredentialsSection` shape (whole-record save, clear-confirm dialog, testid scheme `coding-*`) this plan preserves verbatim on the migrated primitives.
- **ADR-0256 (BYOK Settings Field Shell)** — introduced `SettingsFieldShell` and the `getFieldLabelId()` context the new `Combobox` reads from; the `editor`/`head`/`footer` snippet slots the model-hint `footer` plugs into are this shell's contract.
- **ADR-0185 (BYOK LLM Credentials)** — the original BYOK/agent-provider credential model; the `agent-provider` field skeleton and `/models` endpoint the fixtures now mirror come from this lineage.
- **ADR-0272 (MCPSection UX Fixes)** and **ADR-0270 (Kaneo Access UX Fixes)** — sibling UX-fix ADRs from the same review pass, sharing the migrate-onto-shared-primitives pattern; this ADR is the coding-cluster instance of that pattern.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. The `.coding-select` CSS class is confirmed absent from all three coding-cluster sections (grep for `\.coding-select` under `client/settings/sections/*.svelte` returns no matches); the surviving `coding-select-*` references are testids on the primitives' inner elements, preserved by design.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/ui/Select.svelte:14-23` | `Props` gains `placeholder?: string`; destructured in `$props()`. | `read` confirms. |
| `client/shared/ui/Select.svelte:34-36` | `{#if placeholder}<option value="" disabled>{placeholder}</option>{/if}` rendered before the `{#each}`. | `read` confirms. |
| `client/shared/ui/Select.stories.svelte:31-40` | `Placeholder` story variant (`value: ''`, placeholder, two options). | `read` confirms. |
| `tests/client/shared/ui/Select.test.ts:105-127` | `renders a leading disabled placeholder option when placeholder is set` — asserts 3 options, first is the placeholder, `disabled`, `value=""`. | `read` confirms. |
| `client/shared/ui/Combobox.svelte:6-36` | New primitive: module-seq `listId`, `Props` (`value/options/onInput/placeholder/disabled/testid`), `getFieldLabelId()`, `handleInput`. | `read` confirms. |
| `client/shared/ui/Combobox.svelte:38-52` | `.ui-combobox` wrapper + `<input list={listId}>` + sibling `<datalist id={listId}>` of option values. | `read` confirms. |
| `client/shared/ui/Combobox.stories.svelte:17-25` | `With suggestions` + `Empty` stories. | `read` confirms. |
| `tests/client/shared/ui/Combobox.test.ts` | Three-case unit test (render/datalist option count, onInput emit, disabled attribute). | `glob` + `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:11,17` | `Combobox` + `Select` imports added to the `../../shared/ui/*` group. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:76-78` | `hasSavedKey = $derived(fields.find(... 'provider_api_key')?.hasValue === true)` — model-hint signal, no new state. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:270-272` | Empty-state guard: `{#if fields.length === 0}<p class="placeholder">No provider fields available — try Refresh.</p>{:else}…`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:297-311` | `select` branch → `<Select … testid="coding-select-${field.key}">`; `combobox` branch → `<Combobox … testid="coding-combobox-${field.key}">`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:332-336` | `footer` snippet: `{#if field.control === 'combobox' && !hasSavedKey}<p class="field-hint">Save your API key to load model suggestions.</p>{/if}`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:392-396` | `.field-hint { margin:0; color:var(--text-muted); font-size:12px; }` — `.coding-select` deleted. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:16,207-212` | `Select` import; `select` branch → `<Select onChange={(v) => updateDraft(field.key, v)} testid="coding-select-${field.key}">`. | `read` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:16,202-208` | `Select` import; `select` branch → `<Select placeholder="Select an MCP server…" disabled={saving \|\| loading} testid="coding-mcp-server-${index}">`. | `read` confirms. |
| `client/stories/msw/settings-handlers-personal.ts:27-80` | `agentProviderField`/`agentProviderFields(hasValue)` helpers build the real `agent-provider` skeleton (agent/provider/auth_method selects, provider_api_key secret, provider_base_url, model combobox, allowedAgents) for populated + empty. | `read` confirms. |
| `client/stories/msw/settings-handlers-personal.ts:82-88,92,96` | `codingModelsPopulated` (`claude-sonnet-4`, `claude-opus-4`); `/settings/api/coding-credentials/models` handler wired into both `populated` and `empty` families (registered before the base handler). | `read` confirms. |
| `tests/client/stories/msw/settings-handlers-personal.test.ts:39-43` | `codingCredentialsHandlers populated wires the models endpoint` — asserts a path includes `/settings/api/coding-credentials/models`. | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:871-888` | `shows a placeholder and no Save button when the field list is empty` — mock returns `fields: []`; asserts `.placeholder` text contains "No provider fields available" and Save is absent. | `read` confirms. |
| `tests/visual/settings/sections/CodingCredentialsSection.spec.ts:32-67` | Manual states reworked to agent-provider fields: narrow-640 Populated/Empty, base-URL input focus, API-key replace open, dirty Save hover, clear-confirm dialog. | `read` confirms. |
| `client/settings/sections/*.svelte` | `.coding-select` CSS class absent from all three coding-cluster sections (grep for `\.coding-select` under `client/settings/sections/` returns no matches). | `grep` confirms. |

Plan-vs-implementation notes:

- **Fixtures were factored into helpers instead of inline object literals.** The plan's Task 6 Step 3 showed inline `codingCredentialsPopulated` / `codingCredentialsEmpty` object literals. Shipped factors these into a `agentProviderField(key, label, overrides)` builder + an `agentProviderFields(hasValue)` array factory (`settings-handlers-personal.ts:27-62`), because the file is pressed against its `max-lines` lint limit (a trailing comment at line 300 notes handlers were split out to another file to stay under the cap). The fixture data shape, field set, `control`/`options` values, and `allowedAgents` are identical to the plan's intent; only the construction is DRYed.
- **The `Combobox` in `CodingCredentialsSection` gained a `disabled={saving || loading}` prop.** The plan's Task 3 Step 4 / Step 6 markup did not pass `disabled` to the `Combobox` (only `Select` had it). Shipped adds `disabled={saving || loading}` (`CodingCredentialsSection.svelte:310`), matching `Select`'s disable-during-load behavior. Strictly additive; no assertion depends on its absence, and it is a usability improvement (the model field is now consistent with the other fields during save/load).
- **The empty-guard test mock is multiline.** The plan's Task 3 Step 9 wrote the mock as a one-line `Promise.resolve(json({...}))`. Shipped wraps the same payload across four lines (`coding-credentials-section.test.ts:872-876`) for readability; the payload and assertions are identical.
- **`CodingMcpSection`'s testid is `coding-mcp-server-${index}`, not `coding-mcp-select-${field.key}`.** The plan's Task 5 Step 3 showed `testid="coding-mcp-select-${field.key}"`, but `CodingMcpSection` is row-based (per-server rows keyed by index, not a field grid), so the shipped primitive carries `testid="coding-mcp-server-${index}"` (`CodingMcpSection.svelte:208`) — matching the section's existing row model. This is a pre-existing testid-scheme difference from the plan's literal text, not a regression introduced by the migration; the section's own tests query the `coding-mcp-server-*` testid.

The source plan `docs/superpowers/plans/2026-07-09-coding-credentials-ux-fixes.md` and design `docs/superpowers/specs/2026-07-09-coding-credentials-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
