<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Settings-field shell polish (a11y + robustness + cleanup)

**Date:** 2026-07-07
**Status:** Approved (design); ready for implementation planning
**Predecessors:** [`2026-07-06-byok-section-field-shell-design.md`](./2026-07-06-byok-section-field-shell-design.md), [`2026-07-06-field-shell-consolidation-followups-design.md`](./2026-07-06-field-shell-consolidation-followups-design.md). This spec closes the three optional items the second design's final review surfaced.

## 1. Goal

Three small, independent polish items on the settings-field surface:

- **A. Select/combobox accessible name** — native `<select>`/combobox controls rendered in a `SettingsFieldShell` editor slot have no accessible name (only `Input` consumes the shell's label id via field-context). Give the shell a way to hand its label id to any editor control.
- **B. `formDirty` visibility alignment** — `CodeHostSection`/`CodingCredentialsSection` compute whole-record dirtiness over all fields, including ones hidden by a control choice. Filter to visible fields.
- **C. Stray-class cleanup** — `CodingIdentitySection`'s two `<label class="settings-field__label">` reference a class with no styling effect; switch them to the app's shared `t-label`.

**In scope:** `SettingsFieldShell.svelte` (a backward-compatible snippet-signature change), `CodeHostSection.svelte`, `CodingCredentialsSection.svelte`, `CodingIdentitySection.svelte`, their tests, and a CodingIdentity visual re-baseline. **Out of scope:** any HTTP route/schema; the other shell consumers (`ByokSection`, `ConfigFieldRow`, `AdminPluginsConfigSection`) — their `Input`-based fields already get an accessible name via field-context and need no change.

## 2. Part A — Select/combobox accessible name

### 2.1 Shell change (backward-compatible)

`SettingsFieldShell` already generates a `labelId`, puts it on its `.settings-field__label` span, and publishes it via `setFieldLabelId` (which `Input` reads). Extend it to also pass the id **into** the editor snippet:

- Type: `editor?: Snippet<[string]>` (was `Snippet`).
- Render: `{@render editor?.(labelId)}` (was `{@render editor()}`).

This is backward-compatible two ways: at runtime a `{#snippet editor()}` with no params simply ignores the extra arg; at the type level a zero-parameter snippet is assignable to `Snippet<[string]>` (TS function-parameter bivariance). So `ByokSection`, `ConfigFieldRow`, and `AdminPluginsConfigSection` need no change — their `Input` controls keep getting the name via field-context, and their editor snippets ignore the new arg.

### 2.2 Consumer changes

- **CodeHostSection**: `{#snippet editor(labelId)}`; add `aria-labelledby={labelId}` to the `<select data-testid="coding-select-…">`. (Its `Input` fields already get the name via context.)
- **CodingCredentialsSection**: `{#snippet editor(labelId)}`; add `aria-labelledby={labelId}` to the `<select data-testid="coding-select-…">` **and** the combobox `<input data-testid="coding-combobox-…">`.

The `labelId` a control receives is the id of its own row's `.settings-field__label`, so the accessible name is the real field label (e.g. "Model provider").

### 2.3 Tests

For each migrated select/combobox: mount with a select-bearing fixture, read the control's `aria-labelledby`, resolve it via `target.querySelector('#' + id)`, and assert the resolved element's text is the field label. (Follow the predecessor's ByokSection `aria-labelledby` test pattern.)

## 3. Part B — `formDirty` visibility filter (defensive)

Change the two whole-record derivations to consider only visible fields:

- `CodeHostSection`: `const formDirty = $derived(fields.filter(shouldShowField).some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))`.
- `CodingCredentialsSection`: `const formDirty = $derived(fields.filter((f) => !fieldHidden(f)).some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))`.

This aligns dirtiness with the set the user can see (and, for CodeHost, with `collectValues`, which already skips `!shouldShowField`).

**Reachability note (why there is no new behavioral test):** analysis shows no _reachable_ state where a hidden field is dirty without a co-occurring visible change:

- `initialDrafts` only produces a draft that differs from the stored value for (a) sensitive-with-value fields (draft `''` vs masked value) and (b) CodeHost's empty-`select` defaulting (draft = first option vs `''`). No sensitive field is ever hidden, and the only defaulted select (`kind`) is never hidden — so on load, every hidden field's draft equals its stored value (not dirty).
- Reaching a hidden field with a stale draft requires the user to edit it while visible and then change the control that hides it — but that control change is itself a visible dirty change, so Save is legitimately enabled regardless.

The change is therefore correctness-by-construction (no observable behavior change today) that keeps the derivation robust if field-hiding logic changes later. No dedicated behavioral test is added (the failing state is unreachable); the existing dirty-state tests in both sections guard against regression — the plan must confirm they still pass.

## 4. Part C — CodingIdentitySection labels

`CodingIdentitySection.svelte` renders `<label class="settings-field__label" for="…">Policy</label>` and the same for "Member". `.settings-field__label` has never had a global rule (it was component-scoped in the old sections, now shell-scoped), so these labels fall back to default styling.

Change both to `class="t-label"` — the app's shared label class (`client/settings/settings.css`: 12px, weight 600, uppercase, `--text-muted`), which is global and applies here. Test: assert both labels carry the `t-label` class. Re-baseline the `CodingIdentitySection` story (intended change: the labels now render in the app's uppercase field-label style).

## 5. Testing & visual

- Part A: select/combobox `aria-labelledby` tests in `code-host-section.test.ts` and `coding-credentials-section.test.ts`.
- Part B: no new test (unreachable state); confirm existing dirty tests pass.
- Part C: `t-label` assertion in the CodingIdentitySection test; re-baseline `bun shoot -g CodingIdentitySection`.
- The shell change must not regress the other consumers: run the full affected client suites (`SettingsFieldShell`, `ConfigFieldRow`, `ByokSection`, `CodingCredentials`, `CodeHost`, `AdminPluginsConfig`, `CodingIdentity`) plus `bun run check`. `.storybook-shots/` is gitignored (ephemeral).

## 6. Risks & mitigations

- **Shell snippet-signature change ripples to all consumers.** Mitigation: the change is additive and backward-compatible (runtime ignores extra args; zero-param snippet assignable to `Snippet<[string]>`); the plan runs every consumer's suite to confirm no regression.
- **Part B has no test.** Mitigation: documented as unreachable; existing dirty tests guard regressions; the diff is a pure `.filter(...)` insertion.
- **Part C typography shift.** Mitigation: re-baselined screenshot; `t-label` is the established app convention for field labels.

## 7. Definition of done

- Native selects/comboboxes in CodeHost/Coding have an `aria-labelledby` pointing at their field label; asserted by tests.
- `formDirty` in both sections filters to visible fields; existing dirty tests still pass.
- CodingIdentity's Policy/Member labels use `t-label`; re-baselined.
- Other shell consumers unaffected; `bun run check` and all affected client suites pass.
