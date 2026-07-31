<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — ByokSection UX fixes via a shared settings-field shell

**Date:** 2026-07-06
**Status:** Approved (design); ready for implementation planning
**Source review:** [`docs/ux-reviews/ByokSection.md`](../../ux-reviews/ByokSection.md)
**Rubric:** [`docs/ux-reviews/RUBRIC.md`](../../ux-reviews/RUBRIC.md)

## 1. Goal

Fix all 7 findings from the ByokSection UX review. Four of them (double label,
required marker, missing `aria-live`, hand-rolled load error) also exist in
`CodingCredentialsSection` — ByokSection's near-identical twin — and the presentational
subset additionally exists in `ConfigFieldRow`. Rather than patch one section and let the
copies drift, extract the shared row structure into one presentational component and route
all three consumers through it, then apply the section-level fixes to each consumer.

**In scope:** `ByokSection`, `CodingCredentialsSection`, `ConfigFieldRow`, and a new shared
shell component. **Out of scope:** any change to the BYOK / coding-credentials / config
HTTP APIs or their Zod schemas — every fix is derivable from data already returned.

## 2. Background — the current duplication

Three files render the same "settings-field" row markup (a bordered card with a head label,
an optional masked secret + Replace, and an editor with an input + Save/Cancel):

- `client/settings/components/ConfigFieldRow.svelte` — the **cleanest** copy: single label
  with a bare `<Input>` (no redundant inner label), CSS already on the spacing tokens
  (`--gap-tight` / `--gap-inline` / `--surface-1`). Still hand-rolls a plain (non-accent)
  `*` marker (`ConfigFieldRow.svelte:138`) and has no dirty-state (`:160` `disabled={saving}`).
- `client/settings/sections/ByokSection.svelte` — inline copy; per-field Save; **double
  label** (`:178` custom head label + `:189` `Field label="New value"/"Value"`), hardcoded
  px + `--surface` in CSS (`:221-252`), plain `*` (`:178`), no dirty-state (`:203`),
  hand-rolled load error (`:157`) with no `role`.
- `client/settings/sections/CodingCredentialsSection.svelte` — inline copy; **whole-record**
  Save at the bottom (`:355-362`) plus `select`/`combobox` controls, Clear + `Confirm`, and
  cross-field logic; same double label (`:267` + `:277`/`:294`/`:314`), plain `*` (`:267`),
  no dirty-state (`:359`), hand-rolled load error (`:246`) with no `role`.

Note: `--surface` is defined as `var(--surface-1)` (`client/shared/tokens.css`), and the
hardcoded `12px`/`8px`/`10px` values equal `--gap-inline` / `--gap-tight`. So consolidating
the spacing/background onto the tokenized CSS is **value-preserving**. The shell
_additionally_ rounds the card corners (see §3.2) — an intended change that also affects the
currently-square `ConfigFieldRow` cards; it is called out in §4.1 and §6 so the re-baselined
screenshots capture it deliberately.

## 3. Architecture — `SettingsFieldShell`

New presentational component: `client/settings/components/SettingsFieldShell.svelte`
(beside `ConfigFieldRow`).

### 3.1 Why presentational-only

The two sections diverge in **save model**: ByokSection saves per field (a Save button
inside each row); CodingCredentials saves the whole record with one Save at the bottom and
adds `select`/`combobox` controls. A component that also owned "Save" would need a save-mode
strategy prop and would be leaky. The shell therefore owns **only** the structure that is
genuinely identical; save/endpoint/dirty logic stays in each consumer.

Rejected alternatives:

- **One stateful row per section** (`ByokFieldRow` + `CodingFieldRow`): leaves two copies of
  the head markup, so it does not dedupe the thing that actually drifted.
- **One do-everything row with a save-strategy prop**: over-parameterized; you would have to
  read its internals to understand any call site.

### 3.2 Interface

```
Props:
  label: string          // the field's own name, e.g. "Anthropic API Key"
  required?: boolean      // renders an accent-colored "*" after the label (default false)
  testid?: string         // data-testid on the .settings-field card

Snippets:
  head?    // trailing head content rendered after the label, right-aligned
           // (masked Secret + Replace, SegmentedControl, Clear, …)
  editor?  // wrapped by the shell in .settings-field__editor
           // (the input control + Save/Cancel buttons)
  footer?  // hint / inline error rendered below the editor
```

Rendered structure (classes preserved from today so DOM/visuals stay stable):

```svelte
<div class="settings-field" data-testid={testid}>
  <div class="settings-field__head">
    <span class="settings-field__label">{label}{#if required}<span class="settings-field__req">*</span>{/if}</span>
    {@render head?.()}
  </div>
  {#if editor}<div class="settings-field__editor">{@render editor()}</div>{/if}
  {@render footer?.()}
</div>
```

- `.settings-field__label` keeps `margin-right: auto` (from `ConfigFieldRow.svelte:208`) so
  head controls push to the right edge.
- `.settings-field__req { color: var(--accent) }` — mirrors `Field`'s `.ui-field__req`
  (`client/shared/ui/Field.svelte:62-63`), giving the themed accent asterisk.
- CSS values are the tokenized set from `ConfigFieldRow.svelte:190-222`
  (`--gap-tight`, `--gap-inline`, `--surface-1`, `flex:1; min-width:200px` on the editor
  control). Add `border-radius: var(--radius-control)` (2px, the value the inputs/buttons
  inside the card already use) so the card corners match its contents instead of being
  square.
- The shell offers **no second label slot**, so single-label is enforced by construction —
  consumers place a bare `Input`/control in `editor` with no wrapping `Field label=…`.

## 4. Fix mapping

### 4.1 Fixed once inside the shell (Byok + Coding + ConfigFieldRow)

| Finding                        | Fix in shell                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| [Med] Redundant double label   | Shell renders exactly one label (the field name); editor slot has no inner `Field label`.           |
| [Low] Hand-rolled `*` marker   | Shell renders the marker via `required` → `.settings-field__req` in `var(--accent)`.                |
| [Low] Hardcoded spacing/radius | Shell CSS uses `--gap-tight`/`--gap-inline`/`--surface-1` + `border-radius: var(--radius-control)`. |

### 4.2 Section-level (stays in each consumer)

**[High] Active BYOK state indicator — ByokSection only** (CodingCredentials has no
enable/disable toggle). Add a `Pill`
(`client/shared/ui/Pill.svelte`) beside the toggle inside `PageHeader`'s `action` snippet,
mirroring `GuestModeSection.svelte:60-84`. State derives entirely from the existing
`ByokResponse` (`enabled` / `complete` / `unreadable`):

| Condition               | `Pill tone` | dot | Text                  |
| ----------------------- | ----------- | --- | --------------------- |
| `!enabled`              | `mute`      | no  | `Central credentials` |
| `enabled && unreadable` | `danger`    | yes | `Unreadable`          |
| `enabled && !complete`  | `warn`      | yes | `Incomplete`          |
| `enabled && complete`   | `accent`    | yes | `Active`              |

The toggle button keeps its inverse action label ("Use my own credentials" /
"Use central credentials"); the Pill supplies the current-state readout the button label
cannot.

**[Med] Load-error recovery — Byok + Coding.** Split the single `error` display into two
cases (today one `<p class="status-error">{error}</p>` at `ByokSection.svelte:157` /
`CodingCredentialsSection.svelte:246` serves both, which is why a load failure loses the
toggle and shows only raw text):

- **Load failure** (`currentData === null && error !== null`): render the shared `ErrorState`
  (`client/shared/ui/ErrorState.svelte`) with `onRetry={() => void load(contextId)}`,
  matching TaskProvider/Group/Identity/Profile/AiOutput/GuestMode. `ErrorState` already
  renders a body Retry `Btn` (testid `error-retry`) and `role="alert"`. The header refresh
  `IconButton` stays.
- **Action error** (`currentData !== null && error !== null`, i.e. a failed save/toggle):
  keep the in-place `<p class="status-error">` — see the aria row below.

The existing top-of-section `<p>` must therefore be **gated to the data-present case** so
`ErrorState` and the inline line never render together.

**[Med] aria-live — Byok + Coding.** Add `role="alert"` to the data-present status-error
`<p>` and `role="status"` to the status-success `<p>`, matching
`IdentitySection.svelte:211-212`. (No literal `aria-live` attribute is used anywhere in the
codebase; `role` is the established convention.) The load-failure error needs no extra role —
`ErrorState` is already `role="alert"`.

**[Low] Dirty-state Save — the one net-new convention.** No sibling section currently
disables Save based on a draft-vs-stored diff; this introduces the pattern. Reuse the
existing `drafts` (draft values) vs `fields` (stored values) split — no new state shape.

Per-field dirtiness:

```
isDirty(field) = (drafts[field.key] ?? '') !== (field.sensitive ? '' : field.value)
```

Rationale for the sensitive baseline of `''`: `initialDrafts` seeds a sensitive field with
a stored value to `''` (`ByokSection.svelte:41`), so an untouched secret is "not dirty"
(Save disabled) and typing anything makes it dirty. A missing/unset secret also starts `''`,
so its Save stays disabled until the user types — preventing an empty save.

- **ByokSection (per-field Save):** `disabled={!isDirty(field) || savingKey === field.key || loading || toggling}`.
- **CodingCredentialsSection (whole-record Save):** `formDirty = fields.some(isDirty)`;
  `disabled={!formDirty || saving || loading || clearing}`. Cross-field auto-updates in
  `onSelectChange` already write to `drafts`, so they correctly flip `formDirty`. The
  bottom **Clear** button is unaffected (not gated on dirtiness).
- **ConfigFieldRow (per-field Save, non-enum only):** `disabled={!isDirty || saving}`.
  Enum fields (`SegmentedControl`) save on change and have no Save button, so dirty-state
  does not apply there.

## 5. Per-consumer wiring notes

- **ByokSection** (`:174-216`): wrap each row body in `SettingsFieldShell` with
  `label={field.label}`, `required={field.required}`, `testid={`byok-row-${field.key}`}`.
  `head` snippet carries the masked `Secret` + `Replace` for the sensitive-resting case;
  `editor` snippet carries the bare `Input` + per-field Save + Cancel. Add the Pill to the
  header action snippet; swap the load error for `ErrorState`; add roles to the inline
  status/success lines; apply per-field dirty-state.
- **CodingCredentialsSection** (`:261-364`): same shell wrap. The `editor` snippet varies by
  `field.control` (`select` / `combobox` / bare `Input`), and `Cancel` renders for a
  replacing sensitive field. The bottom `.settings-field__actions` (Clear + whole-record
  Save) stays outside the shell. Swap the load error for `ErrorState`; add roles; apply
  `formDirty` to the bottom Save.
- **ConfigFieldRow** (`:110-178`): both the enum and non-enum branches wrap their row in the
  shell. Enum branch: `head` = `SegmentedControl` + Clear, no `editor`. Non-enum branch:
  `head` = masked `Secret` + Replace + Clear, `editor` = `Input` + Save + Cancel. Move the
  inline hint/error into `footer`. Adopt the `required` prop (accent marker) and non-enum
  dirty-state. The `.settings-field*` styles move out of this file into the shell.

## 6. Testing & visual-regression

- **New:** `SettingsFieldShell.stories.svelte` covering: plain field, required field
  (accent asterisk), sensitive-resting (masked + Replace via `head`), editor-open, and a
  `footer` hint/error. Generate its baseline with `bun shoot -g SettingsFieldShell`.
- **Re-baseline (intended diffs, not regressions):** ByokSection, CodingCredentialsSection,
  and the ConfigFieldRow-backed stories (ProfileSection, AiOutputSection, TaskProviderSection
  — they render config fields through `ConfigFieldRow`). Expected visual changes: (a) the
  redundant `NEW VALUE` / `VALUE` sub-label removed (Byok/Coding); (b) the required `*` now
  accent-colored (all three); (c) the card corners now rounded `2px` (all three); (d)
  ByokSection header now shows a state Pill; (e) ByokSection/Coding error stories now render
  `ErrorState` (icon + title + Retry) instead of a bare red line. The implementation plan
  must call these out explicitly so a reviewer approves the new baselines deliberately.
- **Unit tests (new behavior only):** dirty-state — Save disabled when the draft equals the
  stored value; a sensitive field's Save disabled while the input is empty and enabled after
  typing; CodingCredentials `formDirty` true after any single field changes. Follow the
  existing settings component test patterns; prefer DI where available (`tests/CLAUDE.md`).
- No API/schema tests change — no API/schema changes.

## 7. Risks & mitigations

- **Svelte scoped-style migration.** Moving `.settings-field*` into the shell changes which
  component's scope hash the classes carry. Mitigation: keep identical class names and
  token-equal values; rely on the re-baselined screenshots to confirm no unintended shift.
- **CodingCredentials editor variety.** The `select`/`combobox`/`datalist` controls and
  cross-field resets must keep working through the `editor` snippet. Mitigation: the shell is
  agnostic to snippet contents; the section keeps all control logic; verify via its existing
  stories.
- **Dirty-state over-blocking.** A mis-scoped baseline could wrongly disable Save.
  Mitigation: explicit unit tests for the empty-secret and unchanged-value cases above.

## 8. Definition of done

- One `SettingsFieldShell` renders every settings-field row across ByokSection,
  CodingCredentialsSection, and ConfigFieldRow; no section carries its own `.settings-field*`
  CSS or a double label.
- All 7 ByokSection findings resolved; the four shared findings resolved in the twin too.
- New shell story + re-baselined consumer screenshots; dirty-state unit tests pass.
- `bun run check` (types/lint/format) and the visual suite pass.
