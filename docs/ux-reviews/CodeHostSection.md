<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodeHostSection

**Date:** 2026-07-31
**Reviewed:** `client/settings/sections/CodeHostSection.svelte`
**States captured:** Populated, Empty, Error, Loading, secret-replace open, dirty (Save enabled), Save hover while disabled, clear-confirm dialog, long-URL overflow · desktop (1280) + ~640px narrow
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

> **Screenshot-fidelity caveat (read first).** The component fetches the **`forge`**
> namespace (`CodeHostSection.svelte:72`), whose real form is _Code host_ (select over
> `github` / `github-enterprise` / `gitlab` / `gitlab-self-hosted`), a conditional
> _Instance URL_, and an _Access token_ secret
> (`src/debug/settings/coding-credentials-fields-meta.ts:63`). **All four stories serve the
> `agent-provider` fixture instead** — the MSW handler ignores the `namespace` query
> parameter and always returns agent/provider/API-key/model fields
> (`client/stories/msw/settings-handlers-personal.ts:64`, `:90`). Every screenshot therefore
> shows _Coding agent / Model provider / Auth method / API key / Base URL / Model_ under a
> "Code host" title. This is the exact inverse of the mismatch recorded in
> [`CodingCredentialsSection.md`](./CodingCredentialsSection.md) H1 — the shared fixture was
> flipped to `agent-provider`, and the gap moved here. Findings about the forge fields are
> anchored in **source**, which the rubric treats as authoritative; the shots corroborate
> chrome only (header, four states, actions row, secret masking, focus ring, confirm dialog,
> reflow at 640). See finding H1.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Eyebrow/title/card rhythm is consistent, but nothing states whether a code host is connected, and the primary action is a 22px button in the far corner. |
| 2. Affordance & signifiers      | warn  | Controls read as controls, but the destructive Clear is a ghost button — the quietest thing on the page.                                              |
| 3. Consistency w/ design system | warn  | Reuses every shared primitive and mirrors the sibling's structure, yet drops four patterns the sibling establishes (setup helper, empty guard, field hints, hidden-field submit invariant). |
| 4. Feedback & state             | fail  | `complete`/`missing` go unrendered, validation lands only as a top banner, and the conditionally revealed Instance URL is unmarked though the server rejects it blank. |
| 5. Content & language           | fail  | The empty state is a bare form — no word on what a code host is, which token scopes it needs, or where to get one; errors leak raw `instance_url` copy. |
| 6. Accessibility                | warn  | `aria-labelledby`, `role="alert"`/`role="status"` and focus rings are wired correctly; required is a bare `*` glyph, there is no heading element, and controls are 22px tall. |
| 7. Responsive / layout          | pass  | Field cards and wrapping editor rows reflow cleanly at 640; a long self-hosted URL stays contained inside the input (verified in the long-URL shot).  |
| 8. Spacing, alignment & sizing  | warn  | The actions row declares no `gap` and does not share the field-content alignment edge; `sm` controls sit at 22px, under the 24px target floor.        |
| 9. Interaction & micro-states   | warn  | Save disabled→enabled, hover, "Saving…"/"Clearing…" and the focus ring all verified working; text inputs stay editable during save/refresh and are overwritten on reload. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] All four stories serve the `agent-provider` fixture — the forge form has zero screenshot coverage

- **Id:** code-host-forge-form-uncovered
- **Status:** open
- **Dimension:** 4. Feedback & state (+ review fidelity)
- **Where visible:** Populated, Empty, Error, Loading, and every manual state — all render _Coding agent / Model provider / Auth method / API key / Base URL / Model_ under the "Code host" title
- **Source:** `CodeHostSection.svelte:72` requests `'forge'`; the handler ignores the namespace and returns `namespace: 'agent-provider'` unconditionally (`client/stories/msw/settings-handlers-personal.ts:64`, `:73`, `:90`); the real field set is at `src/debug/settings/coding-credentials-fields-meta.ts:63`
- **Notes:** The consequence is not only review blindness — the `kind` select, the conditional `instance_url` reveal (`CodeHostSection.svelte:51`, `:102`), and the Access token field carry no visual-regression baseline at all, so a regression in this section's actual UI cannot be caught by `bun shoot`.
- **Suggested fix:** Give the handler family a namespace-aware branch (or add a dedicated forge fixture) so this section's stories return `kind` / `instance_url` / `forge_token`, plus a story with a self-hosted kind selected to cover the conditional field.

### [High] Nothing tells the user whether a code host is connected — `complete` and `missing` are never rendered

- **Id:** code-host-connection-state-hidden
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning (also 4. feedback & state)
- **Where visible:** Populated and Empty — both are an undifferentiated stack of field cards; only the presence of a Clear button hints at configured state
- **Source:** `CodeHostSection.svelte:232` consumes `currentData.configured` solely to gate the Clear button; the response's `complete` and `missing` fields are never read, and `PageHeader`'s `sub` slot is unused (`:171`, `client/shared/ui/PageHeader.svelte:16`)
- **Notes:** This is the headline question for a connection section, and the sibling at least surfaces incompleteness (`CodingCredentialsSection.svelte:273`). A `StatusPill` primitive already exists for exactly this.
- **Suggested fix:** Surface connection state in the header — e.g. a status pill reading connected-to-`kind` versus not connected, driven by `configured`/`complete`/`missing`.

### [High] The empty / first-setup state gives no guidance at all

- **Id:** code-host-empty-state-no-guidance
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** Empty, Empty — narrow 640: field cards and a disabled Save, with no explanatory copy anywhere
- **Source:** `CodeHostSection.svelte:184`–`189` renders straight into the field loop with no helper block; the sibling emits a first-setup paragraph when `!complete` (`CodingCredentialsSection.svelte:273`–`277`) and per-field hints through the shell's `footer` snippet (`:332`–`336`)
- **Notes:** An access token is not something a user has to hand — it must be generated on GitHub/GitLab with particular scopes. The form names none of that, and the token placeholder is the generic "enter a new value" (`CodeHostSection.svelte:217`).
- **Suggested fix:** Add a first-setup helper naming what the connection is for and which token scopes each forge kind needs, and give the token field a scope-specific placeholder.

### [High] The revealed Instance URL is neither marked required nor hinted, yet the server rejects it blank

- **Id:** code-host-instance-url-unmarked-required
- **Status:** open
- **Dimension:** 4. Feedback & state (also 5. content)
- **Where visible:** Selecting `github-enterprise` or `gitlab-self-hosted` (source; not reachable in the current fixtures)
- **Source:** field meta declares `required: false` (`src/debug/settings/coding-credentials-fields-meta.ts:72`) and `CodeHostSection.svelte:192`–`196` passes `required={field.required}` verbatim, with no `effectiveRequired` equivalent to the sibling's (`CodingCredentialsSection.svelte:282`); the route returns 422 when it is blank or non-`https://` (`src/debug/settings/coding-credentials-routes.ts:113`–`120`)
- **Notes:** The field also appears with an empty placeholder (`CodeHostSection.svelte:217`), so a user gets an unstarred, unexplained box that silently blocks Save.
- **Suggested fix:** Mark Instance URL required when the selected kind needs it, and give it an `https://…` example placeholder plus a line explaining why it appeared.

### [Med] Validation surfaces only as a top banner carrying raw server text — the field shell has no inline error channel

- **Id:** code-host-validation-no-inline-channel
- **Status:** open
- **Dimension:** 4. Feedback & state (also 6. accessibility)
- **Where visible:** Any 422 (e.g. blank Instance URL) — the message lands above the form, far from the offending field
- **Source:** errors render as a single `.status-error` paragraph (`CodeHostSection.svelte:177`); `SettingsFieldShell` publishes only a label id and never calls `setFieldError` (`client/settings/components/SettingsFieldShell.svelte:30`–`34`), unlike `Field.svelte:29` — so the `aria-invalid` / `aria-describedby` / invalid-border support already built into `Input` (`client/shared/ui/Input.svelte:39`–`40`, `:97`) is unreachable from this section
- **Notes:** The copy is also un-localized backend prose: "instance_url must be an https URL for self-hosted forge kinds" leaks a snake_case column name into the UI (`coding-credentials-routes.ts:117`).
- **Suggested fix:** Give the settings field shell the same error context `Field` publishes, map known 422s onto the offending field, and phrase the message in the field's own label.

### [Med] Switching back to a SaaS kind leaves a stale stored Instance URL

- **Id:** code-host-stale-instance-url-on-saas
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** Choosing `gitlab-self-hosted`, saving, then switching to `github` and saving (source)
- **Source:** `shouldShowField` hides `instance_url` (`CodeHostSection.svelte:102`–`105`) and `collectValues` skips every hidden field (`:113`), while the route merges the submitted values over the stored record (`coding-credentials-routes.ts:106`–`107`); the sibling handles precisely this class of bug by zeroing hidden fields at submit time, with a comment naming it (`CodingCredentialsSection.svelte:168`–`176`)
- **Notes:** No 422 results — `checkForgeKind` only validates the URL when the kind needs one — so the stale self-hosted URL persists invisibly against a SaaS connection the user believes is clean.
- **Suggested fix:** Clear hidden fields explicitly in the submitted payload, mirroring the sibling's submit-time invariant.

### [Med] No guard when the field list comes back empty

- **Id:** code-host-no-empty-field-list-guard
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** Not reproducible in the current fixtures; the shipped fallback would be an empty card stack above a lone Save button
- **Source:** `{#each fields}` has no `{:else}` branch (`CodeHostSection.svelte:190`–`229`), and the actions row renders unconditionally (`:231`); the sibling emits "No provider fields available — try Refresh." (`CodingCredentialsSection.svelte:270`–`271`)
- **Suggested fix:** Add the sibling's empty-fields affordance so a partial load reads as recoverable rather than as a broken form.

### [Med] Text inputs stay editable during save and refresh, then get overwritten

- **Id:** code-host-inputs-editable-during-save
- **Status:** open
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** The in-flight window after pressing Save or Refresh (Save reads "Saving…", but every text field stays live)
- **Source:** `Select` receives `disabled={saving || loading}` (`CodeHostSection.svelte:211`) while `Input` gets no equivalent — the primitive exposes no `disabled` prop at all (`client/shared/ui/Input.svelte:11`–`22`); `saveAll` reloads on success and `load` replaces `drafts` wholesale (`CodeHostSection.svelte:128`, `:76`)
- **Notes:** Anything typed during the round trip is discarded without a word, which is most likely precisely when a user is correcting the field that failed.
- **Suggested fix:** Convey busy on the inputs the way the selects already do, so in-flight edits are not silently dropped.

### [Med] Every control in the section is 22px tall — below the minimum target size

- **Id:** code-host-controls-below-min-target-size
- **Status:** open
- **Dimension:** 6. Accessibility (also 8. sizing)
- **Where visible:** Populated, Populated — narrow 640, replace-secret open: Replace, Cancel, Clear, and Save
- **Source:** all four pass `size="sm"`, which is `height: 22px` (`client/shared/ui/Btn.svelte:105`–`109`; usages at `CodeHostSection.svelte:200`, `:221`, `:235`, `:246`)
- **Notes:** WCAG 2.2 AA puts the floor at 24×24 CSS px; the header's `IconButton` clears it at 28px (`client/shared/ui/IconButton.svelte:31`–`33`), so the section is internally inconsistent too.
- **Suggested fix:** Move the section's primary and destructive actions up to the `md` size, or raise the `sm` height to the 24px floor.

### [Low] The destructive Clear is the quietest control on the page

- **Id:** code-host-clear-low-affordance
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated — "Clear" renders as flat muted text beside the filled green Save
- **Source:** `variant="ghost"` on the clear trigger (`CodeHostSection.svelte:234`), while the confirmation dialog it opens is correctly `danger` (`:260`)
- **Notes:** The dialog does the real safety work, so this is presentation only — but the entry point reads as less consequential than it is.
- **Suggested fix:** Give the trigger the `danger` variant so its weight matches the dialog it opens.

### [Low] The actions row has no gap token and no shared alignment edge with the fields

- **Id:** code-host-actions-row-no-gap-token
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated (measured: field inputs end at x=1256, Save ends at x=1280) and Populated — narrow 640 (inputs end at 616, Save at 640, flush to the edge)
- **Source:** `.settings-field__actions` declares only `display:flex; justify-content:flex-end` (`CodeHostSection.svelte:277`–`280`) — no `gap`, so the space between Clear and Save is collapsed markup whitespace rather than `--gap-tight`; the field cards inset their contents by `--gap-inline` (`client/settings/components/SettingsFieldShell.svelte:52`) while the actions row does not
- **Suggested fix:** Apply the shared inline gap token to the actions row and inset it to the same content edge as the field controls.

### [Low] Required is signalled by a bare `*`, and the section has no heading element

- **Id:** code-host-bare-required-marker-no-heading
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Populated — a green `*` after "Coding agent", "Model provider", "API key"
- **Source:** the marker is an unlabelled `<span>` (`client/settings/components/SettingsFieldShell.svelte:39`, `:69`) with no `aria-required` on the control and no text alternative; `PageHeader` renders its title as a `<div>`, not an `<h*>` (`client/shared/ui/PageHeader.svelte:24`)
- **Notes:** Both live in shared primitives, so this applies across the settings SPA rather than to this section alone.
- **Suggested fix:** Give the required marker a text alternative (and the control `aria-required`), and promote the page-header title to a real heading level.

### [Low] "Code host" names both the section and its first field, and the Instance URL label carries its qualifier inline

- **Id:** code-host-label-naming-collision
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** Source (the forge fixture is not screenshotted — see H1)
- **Source:** section title "Code host" (`CodeHostSection.svelte:171`) duplicates the `kind` field label "Code host", and `instance_url` is labelled "Instance URL (enterprise / self-hosted)" (`src/debug/settings/coding-credentials-fields-meta.ts:66`, `:74`)
- **Suggested fix:** Rename the select to something like "Provider", and move the Instance URL qualifier out of the label into helper text.
