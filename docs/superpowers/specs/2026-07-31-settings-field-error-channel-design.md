<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings field error channel — `SettingsFieldShell` ↔ `Field` parity

**Date:** 2026-07-31
**Status:** Design approved, pending spec review

## Problem

Validation errors in the settings SPA's coding sections land as a single banner above the
form, far from the field that caused them, in backend vocabulary.

`Field.svelte:29` publishes `setFieldError({ errorId, invalid })` to its descendant
controls. `SettingsFieldShell.svelte:34` publishes only `setFieldLabelId`. The
`aria-invalid` / `aria-describedby` / invalid-border support already built into `Input`
(`client/shared/ui/Input.svelte:38`–`40`, `:97`) is therefore **unreachable from every
section built on the settings shell** — `CodeHostSection`, `CodingCredentialsSection`,
`ConfigFieldRow`, `AdminPluginsConfigSection`.

Consumers hand-roll the missing channel in the `footer` snippet. `ConfigFieldRow.svelte:133`–`140`
and `:173`–`180` are byte-identical error+hint blocks, and `CodingCredentialsSection.svelte:334`
rolls a third hint class of its own (`.field-hint`, `:392`).

Two controls cannot show invalid state at all: `Select.svelte` and `Combobox.svelte` never
call `getFieldError()`.

Downstream, the server gives the client nothing to attribute an error with. Every failure is
a flat `{ error: string }` (`src/debug/settings/coding-credentials-routes.ts:111`–`165`), so
`CodeHostSection.svelte:131` can only assign it to a section-wide banner. The text leaks the
column name — `instance_url must be an https URL for self-hosted forge kinds` — which the
review flagged as un-localized backend prose.

This is the `[Med]` finding "Validation surfaces only as a top banner carrying raw server text
— the field shell has no inline error channel" of the CodeHostSection UX review
([`docs/ux-reviews/CodeHostSection.md`](../../ux-reviews/CodeHostSection.md)).

### Why only these two sections need the server's help

`field` earns its keep only on **whole-record submits**. `CodeHostSection` and
`CodingCredentialsSection` PATCH every field at once (`collectValues()` → `saveAll`,
`CodeHostSection.svelte:107`–`135`), which is precisely why they cannot attribute a failure.

Every other field-shaped screen saves one field per request — `ConfigFieldRow` PATCHes
`{ key, value }` and already renders its error inline in that row's own footer. The caller
already knows which field it sent. This is why the scope below is not an arbitrary slice: it
is the exact set of endpoints with the problem.

## Scope

Sub-project **B** of four decomposed from that review. **C** (control target size floor) and
**A** (namespace-aware story fixtures) are complete. **D** (CodeHostSection's remaining
section-local fixes) is tracked separately and is not addressed here; it inherits the error
channel this sub-project builds.

In scope: the nine field-attributable 422s in `coding-credentials-routes.ts`, the shared
error-body transport, `SettingsFieldShell`, `Select`, `Combobox`, and the two coding sections
as first consumers.

Out of scope, with reasons:

- **The other 60 settings 422s.** A sweep counts 69 `settingsJson(422, …)` across 15 route
  files (124 error responses of all statuses across 17). Most are Zod body-parse failures (`invalid request`) or entity-level errors
  (`unknown plugin`, `unknown config field`) with no offending form field. The rest belong to
  per-field endpoints that never needed attribution (above).
- **The two cross-field 422s** — `incompatible agent/provider` (`:143`) and
  `oauth-subscription requires the anthropic provider` (`:162`). Neither field is wrong on
  its own, so any attribution is a heuristic. If the user just changed `agent` and gets
  `incompatible agent/provider`, a red border on `provider` points at the control they did
  not touch. A banner is the honest rendering of "these two fields disagree."
- **The four `mcp` 422s** (`:183`, `:186`, `:198`, `:203`). `CodingMcpSection` is not a field
  loop over `FIELDS_META`; `servers` is a single composite field.
- **Making `SegmentedControl` context-aware.** See the accepted asymmetry in section 3.

## Design

### 1. Server: nine 422s gain a `field` key and lose the column name

The field's label supplies the subject, so the message no longer names its own column. Keys
verified against `FIELDS_META` (`src/debug/settings/coding-credentials-fields-meta.ts:17`–`79`).

| Line  | Current message                                                | `field`             | New message                                            |
| ----- | -------------------------------------------------------------- | ------------------- | ------------------------------------------------------ |
| `111` | `unknown forge kind: ${kindRaw}`                                | `kind`              | `unsupported code host`                                |
| `116` | `instance_url must be an https URL for self-hosted forge kinds` | `instance_url`      | `required for self-hosted code hosts, and must start with https://` |
| `130` | `unknown agent: ${agentRaw}`                                    | `agent`             | `unsupported coding agent`                             |
| `133` | `unknown provider: ${providerRaw}`                              | `provider`          | `unsupported model provider`                           |
| `146` | `openai-compatible requires a base URL`                         | `provider_base_url` | `required for the openai-compatible provider`          |
| `150` | `model too long (max 200)`                                      | `model`             | `too long (max 200 characters)`                        |
| `155` | `model contains control characters`                             | `model`             | `contains control characters`                          |
| `159` | `unknown auth method: ${methodRaw}`                             | `auth_method`       | `unsupported auth method`                              |
| `165` | `oauth-subscription does not use a base URL`                    | `provider_base_url` | `leave blank when auth method is oauth-subscription`   |

The echoed user value is dropped in every case, because each of these fields is a select or a
text input whose current value the user is already looking at.

Messages stay lowercase without a trailing period, matching the file's existing style.

`field` is **optional** on the wire. No other route, SPA, or error response changes.
`plugins-routes.ts:79` already attaches an extra key (`missingKeys`) to a 422 body, so an
enriched error body is an established shape rather than a new one.

### 2. Transport: `field` reaches the client

`client/shared/fetcher-helpers.ts`, additive only:

- `ErrorBodySchema` gains `field: z.string().optional()`.
- `FetchError` gains `readonly field: string | undefined`, set in `requireOk` from the parsed
  body.

The settings, admin, and debug SPAs share this module. All three ignore the new property, so
none are affected.

### 3. `SettingsFieldShell` gains the channel `Field` already has

Two new props, `error?: string` and `hint?: string`, and a `setFieldError` call mirroring
`Field.svelte:29`–`34`:

```ts
const errorId = `settings-field-err-${uid}`
setFieldError({
  errorId,
  get invalid() {
    return error !== undefined && error !== ''
  },
})
```

rendered after the editor and before the footer:

```svelte
{#if error}<p class="settings-field__error" id={errorId} role="alert">{error}</p>
{:else if hint}<p class="settings-field__hint">{hint}</p>{/if}
{@render footer?.()}
```

The getter is required, not a convenience: it is what makes the descendant control track the
shell's live `error` prop rather than its value at init.

The `footer` snippet stays for arbitrary content. The shell's own `.settings-field__error` and
`.settings-field__hint` rules absorb the two ad-hoc classes now living in consumers
(`ConfigFieldRow.svelte:195`, `CodingCredentialsSection.svelte:392`).

Those rules follow the **settings** type scale, not `Field`'s: `font-size: 12px` with
`--text-muted` for the hint and `--danger` for the error, plus `margin: 0`. `Field` uses 10px
`--fg-hint`, but both settings consumers already use 12px `--text-muted`
(`ConfigFieldRow.svelte:195`, `CodingCredentialsSection.svelte:392`), and adopting `Field`'s
scale would restyle every migrated hint for no reason. Parity here means the same *channel*,
not the same pixels — the two shells serve different SPAs with different scales.

`margin: 0` is deliberate: the shell is a `display: grid` with `gap: var(--gap-tight)`
(`:50`–`51`), so a default paragraph margin would double the spacing. Only
`CodingCredentialsSection`'s hint already zeroes it, so `ConfigFieldRow`'s hint will lose a
default `<p>` margin — a visible, intended baseline change.

Its *error* changes a little more. `ConfigFieldRow` renders errors with the global
`.status-error`, which sets `color: var(--danger)` and nothing else
(`client/settings/settings.css:91`), leaving the text at the inherited body size with a default
paragraph margin. Under the shell's rule it keeps the danger colour but adopts 12px and
`margin: 0` — which is the point: the error finally matches the hint sitting beside it. See
acceptance 5.

Migrations that follow from this: the byte-identical error blocks at
`ConfigFieldRow.svelte:134` and `:174` collapse into the `error` prop, and
`CodingCredentialsSection.svelte:333`–`335`'s conditional hint becomes the `hint` prop.

**One asymmetry is accepted deliberately.** `ConfigFieldRow`'s enum branch passes
`ariaDescribedBy={hintId}` to `SegmentedControl` (`:123`) using an id it generates itself. The
shell cannot hand that id back: context set by a child is not visible in the parent's snippet
scope, which is exactly why the shell already passes `labelId` as a snippet *argument*
(`editor?: Snippet<[string]>`). That branch therefore keeps its hint in `footer` with its own
id, and only its error block migrates. Resolving it properly means making `SegmentedControl`
read the field context — a primitive redesign, not parity, and out of scope here.

### 4. `Select` and `Combobox` learn invalid state

Both gain exactly what `Input` already has (`Input.svelte:38`–`40`, `:97`):

```ts
const fieldError = getFieldError()
const invalid = $derived(fieldError?.invalid ?? false)
const describedBy = $derived(invalid ? fieldError?.errorId : undefined)
```

plus `aria-invalid`, `aria-describedby`, and a `--invalid` rule setting `border-color:
var(--danger)`.

This is load-bearing, not polish: `kind`, `agent`, `provider`, and `auth_method` are selects
and `model` is a combobox, so five of the nine errors above would otherwise render text with
no visual anchor.

### 5. Section wiring

Identical in `CodeHostSection` and `CodingCredentialsSection`:

```ts
let errorField: string | null = $state(null)
// in each catch: errorField = err instanceof FetchError ? (err.field ?? null) : null
const inlineField = $derived(
  fields.some((f) => f.key === errorField && shouldShowField(f)) ? errorField : null,
)
```

The banner (`CodeHostSection.svelte:177`, `CodingCredentialsSection.svelte:259`) renders only
when `inlineField === null`; each shell receives
`error={inlineField === field.key ? error : undefined}`.

The `shouldShowField` guard is what keeps an error from disappearing: a `field` naming a
hidden or unknown key — a hidden `instance_url`, or a stale client against a newer server —
falls back to the banner rather than being routed to a shell that is not on screen.
`CodingCredentialsSection` has no `shouldShowField`; there the membership test is against its
rendered field list alone.

Both `error` and `errorField` reset together wherever `error` resets today
(`CodeHostSection.svelte:68`, `:123`).

### 6. Verification

**Unit — server.** The route tests asserting the nine old strings are updated to assert both
the new message and the `field` key. One test per converted branch.

**Unit — transport.** `ErrorBodySchema` parses a body with and without `field`; `requireOk`
throws a `FetchError` carrying it; a body with no `field` yields `undefined` rather than
throwing.

**Unit — shell.** `SettingsFieldShell` renders the error with `role="alert"` and the hint
otherwise; error wins when both are passed; an `Input` in the `editor` snippet receives
`aria-invalid="true"` and an `aria-describedby` pointing at the rendered error's id. The last
assertion is the one that proves the context actually reaches the control.

**Unit — controls.** `Select` and `Combobox` each set `aria-invalid` and the invalid class
under a field error, and neither does when there is none.

**Visual.** The fixture layer has **no `http.patch` on `/settings/api/coding-credentials`
today** — this adds the first, returning 422 with a `field`, behind a new scenario key. A spec
state below `// @generated-end auto-screenshots` in
`tests/visual/settings/sections/CodeHostSection.spec.ts` selects `gitlab-self-hosted`, presses
Save, and screenshots the inline error. A `SettingsFieldShell` story and spec state cover the
shell's error rendering directly.

Note for whoever writes that handler: sub-project A's `isNamespace` guard reads the **query
string**, but PATCH carries `namespace` in the JSON **body**, so the guard does not apply to
it. That is safe here because only one family registers a PATCH per scenario. It is recorded
so the absent guard reads as deliberate rather than forgotten.

**Acceptance:**

1. `bun run check` passes.
2. A 422 naming a field renders inline under that field, with `aria-invalid` and
   `aria-describedby` on the control and a danger border — verified for a select, a combobox,
   and a text input.
3. A 422 with no `field`, or one naming a hidden or unknown field, still renders in the top
   banner.
4. No message rendered under a field label repeats that field's column name.
5. `CodingCredentialsSection`'s baselines are unchanged by the migration off its hand-rolled
   hint, whose style the shell reproduces exactly. The regenerated shots are read, and there are
   no differences.

   `ConfigFieldRow`'s styling does change — its hint loses a default `<p>` margin and its error
   additionally drops to 12px — but that change is **not observable in any screenshot**:
   `ConfigFieldRow` has no stories file and no visual spec, and no story renders it with a hint
   or an error. Its verification is therefore unit-test-only, and must reach the input/else
   branch as well as the enum branch. Adding the missing story is out of scope here and is
   recorded as a follow-up.

## What this does not fix

`CodeHostSection`'s remaining findings — the unrendered `complete`/`missing`, the absent
first-setup guidance, the unmarked-but-server-required `instance_url`, the stale stored
instance URL, inputs left editable during save — stay open under sub-project D. This builds
the channel D needs to mark and explain `instance_url` inline.

The top banner keeps its raw server text for unattributed errors. Those messages
(`incompatible agent/provider`, the mcp errors) are already free of column names.

## Alternatives considered

**Client-side inference from the message.** Match the snake_case key out of the server's
prose and route on that. No server change, but it string-matches backend copy that is not a
contract, and it breaks silently the moment a message is reworded — including by the copy
rewrite in section 1.

**Client-side copy map keyed by namespace + field**, with the server message as fallback.
Best localization story, and the only option that fully removes backend prose from the UI.
Rejected because it creates a second source of truth that goes stale without a failing test
when a server validation rule changes.

**Publish the error context from the shell but leave rendering to consumers.** Smaller shell,
but it preserves the duplication that motivated this work — every consumer keeps its own error
markup and its own class, and the third one to appear invents a fourth style.

**Sweep every settings 422.** Rejected on the evidence in Scope: of 69, roughly eight would
render any differently, while the copy rewrite would become an audit across 17 files.
