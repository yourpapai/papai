<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0345: Settings Field Error Channel — Server-Attributed 422s Routed Inline Under the Offending Field

## Status

Accepted

## Date

2026-07-31

## Context

Server-side validation failures in the settings SPA rendered as a single top-of-section banner, disconnected from the control the user must fix. Nine field-attributable 422 responses in `src/debug/settings/coding-credentials-routes.ts` embedded the offending column name in the message prose (e.g. `instance_url must be an https URL for self-hosted forge kinds`), which reads as implementation noise in the UI. Meanwhile the shared `Field.svelte` primitive already supported `aria-invalid`/`aria-describedby` via a field-error context — but only for `Input`, and the settings sections had migrated off `Field` onto the presentational `SettingsFieldShell` (ADR-0256), which published no error context at all. `ConfigFieldRow` and `CodingCredentialsSection` also hand-rolled byte-identical error/hint footer markup.

The design (`docs/superpowers/specs/2026-07-31-settings-field-error-channel-design.md`) and plan (`docs/superpowers/plans/2026-07-31-settings-field-error-channel.md`) resolved this end to end: attribute the error at the server, carry it through the fetch layer, publish it from the shell, generalize the invalid-state wiring across controls, and route an attributed error inline under its field while keeping the banner for everything else.

## Decision Drivers

- **Attribute errors to fields at the source.** The server knows which value it rejected; a `field` key on the 422 body (`{ error: string, field?: string }`) is the wire contract, and messages drop the column name from prose.
- **Reuse the existing accessibility machinery.** `Field.svelte`'s `FieldErrorContext` already gives `Input` `aria-invalid`/`aria-describedby`; the fix is publishing that context from `SettingsFieldShell` too, not inventing a second channel.
- **Extract, don't triplicate.** Rather than copying `Input`'s four error lines into `Select` and `Combobox` verbatim, extract `useFieldInvalid()` in `client/shared/ui/field-context.ts` and move all three controls onto it.
- **Live, getter-based reactivity without runes in `.ts` modules.** `useFieldInvalid` returns plain getters that read through the context object's own `invalid` getter, so controls track the shell's live `error` prop without needing `$state`/`$derived` outside components.
- **Inline or banner, never both.** Each section resolves the attributed field against the fields actually on screen (visibility predicate differs per section); unknown or hidden keys fall back to the banner rather than vanishing.
- **Copy discipline.** The nine new server messages are exact, lowercase, period-free strings; no message rendered under a field repeats that field's column name.

## Considered Options

### Option 1 — Server-attributed 422s + shell-published field-error context + `useFieldInvalid` helper (chosen)

Add `field` to nine 422 bodies; carry it on `FetchError`; give `SettingsFieldShell` `error`/`hint` props that publish the existing field-error context; extract `useFieldInvalid()` for `Input`/`Select`/`Combobox`; route attributed errors inline in both whole-record-submit sections with banner fallback.

- **Pros:** errors land where the fix happens; one wire contract; deduplicates the error/hint markup that had drifted across `ConfigFieldRow`; the invalid state reaches all three control types; additive — unattributed errors behave exactly as before.
- **Cons:** touches the server route, the shared fetcher (settings/admin/debug SPAs), three UI primitives, and both sections; `inlineField` resolution is duplicated as parallel copies in the two sections.

### Option 2 — Shared `.svelte.ts` rune module for the sections' `inlineField` resolution

Extract the five lines of `errorField` state + `$derived` resolution into a shared rune module used by both sections.

- **Pros:** single copy of the resolution logic.
- **Cons:** the sections differ in their visibility predicate (`shouldShowField` vs `!fieldHidden`); `$state`/`$derived` only stay reactive inside a component or a `.svelte.ts` module — a pattern the settings SPA uses nowhere today; a new module for five lines used twice costs more than it saves. Rejected in favor of deliberate parallel copies.

### Option 3 — Verbatim copies of `Input`'s error lines into `Select` and `Combobox`

Give each control its own four-line copy of the error-context read.

- **Pros:** no new shared helper.
- **Cons:** third verbatim copy of the same lines; the copy count heading for three is exactly when extraction pays. Rejected in favor of `useFieldInvalid()`.

### Option 4 — Banner-only with field name kept in the prose

Keep the single top banner and leave column names in messages.

- **Pros:** zero client changes.
- **Cons:** leaves the UX problem unsolved and exposes internal column names to users. Rejected.

## Decision

Implement Option 1 as planned:

1. **Server** (`src/debug/settings/coding-credentials-routes.ts`): nine 422s gain a `field` key (`kind`, `instance_url`, `agent`, `provider`, `provider_base_url`, `model`, `auth_method`) with rewritten prose; cross-field errors (`incompatible agent/provider`, `oauth-subscription requires the anthropic provider`), the four `mcp` 422s, and `invalid request` stay unattributed.
2. **Transport** (`client/shared/fetcher-helpers.ts`): `ErrorBodySchema` widens with `field: z.string().optional()`; new exported `errorFieldFrom()`; `FetchError` carries `field` and `requireOk` populates it. Additive only — admin/debug SPA callers unaffected.
3. **Shell** (`client/settings/components/SettingsFieldShell.svelte`): new optional `error`/`hint` props; error renders with `role="alert"` and suppresses the hint; the shell publishes `setFieldError` with a getter-based `invalid` so descendant controls track the live prop; error and label ids share one instance counter.
4. **Controls** (`client/shared/ui/`): `useFieldInvalid()` extracted into `field-context.ts`; `Input` moved onto it; `Select` and `Combobox` gain `aria-invalid`/`aria-describedby` plus `.ui-select--invalid`/`.ui-combobox--invalid` danger borders.
5. **Consumers**: `ConfigFieldRow` and `CodingCredentialsSection` migrate their hand-rolled error/hint footer markup onto the shell props (the enum branch's hint stays in its footer — `SegmentedControl` needs the parent's hint id for `ariaDescribedBy`, which the shell cannot hand back to a snippet scope).
6. **Sections**: `CodeHostSection` and `CodingCredentialsSection` record `errorField` from `FetchError`, resolve `inlineField` against visible fields, gate the banner on `inlineField === null`, and pass `error` to the matching shell.
7. **Coverage**: new MSW `forgeSaveErrorHandlers` + `settings-code-host-save-error` scenario, a `Save validation error` story, and a Playwright interaction test that asserts the message renders under the Instance URL field before screenshotting.

## Consequences

### Positive

- Validation errors render under the field that caused them, with `aria-invalid`, `aria-describedby`, and a danger border on inputs, selects, and comboboxes alike.
- The banner is reserved for genuinely record-level failures (cross-field incompatibilities, unattributed errors, hidden/unknown field keys) — never double-rendered.
- Server messages no longer leak column names into UI prose.
- `ConfigFieldRow`'s byte-identical error/hint blocks are gone; the error now renders at the shell's 12px muted/danger parity instead of inherited body size.
- The `useFieldInvalid` seam is reusable by any future control that needs the enclosing field's error state.

### Negative

- `inlineField` resolution is deliberately duplicated in two sections; a third whole-record-submit section should re-evaluate extracting a `.svelte.ts` rune module.
- The shell cannot hand its generated error id to a parent's snippet scope, so `ConfigFieldRow`'s enum branch keeps a local footer hint — a known, documented asymmetry.
- The change is additive on the wire but widens `ErrorBodySchema` in a module shared by three SPAs; any future conflicting `field` key semantics on other endpoints would collide.
- `src/debug/settings/coding-credentials-routes.ts` sits near the 300-line `max-lines` budget; wrapping changes there must be checked against it.

### Risks

- Visual parity for `CodingCredentialsSection` relied on the shell's hint rule exactly reproducing the deleted `.field-hint` style; any drift there is a baseline regression, guarded by the unchanged-baselines acceptance criterion and the interaction screenshot test that fails loudly via `toBeVisible` before baselining.

## Related Decisions

- ADR-0256: BYOK Settings Field Shell — introduced the presentational `SettingsFieldShell` this ADR extends with the error channel
- ADR-0257: Field Shell Consolidation Followups
- ADR-0277: Coding Credentials UX Fixes — the sections whose error routing this ADR defines
- ADR-0238: Storybook Agent Screenshot Pipeline — visual-baseline verification mechanism used for acceptance

## References

- Plan: `docs/superpowers/plans/2026-07-31-settings-field-error-channel.md`
- Design spec: `docs/superpowers/specs/2026-07-31-settings-field-error-channel-design.md`
- Server: `src/debug/settings/coding-credentials-routes.ts:111-167`
- Transport: `client/shared/fetcher-helpers.ts:16,45`
- Helper: `client/shared/ui/field-context.ts:56`
- Sections: `client/settings/sections/CodeHostSection.svelte:79,264,291`, `client/settings/sections/CodingCredentialsSection.svelte:59,293,321`
