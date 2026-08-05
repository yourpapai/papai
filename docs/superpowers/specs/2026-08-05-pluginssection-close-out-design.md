<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# PluginsSection close-out — design

**Branch:** `ui-ux-review-02`. Predecessor: `docs/superpowers/specs/2026-08-05-ux-open-findings-fixes-design.md`
(SP5), which took the backlog to 0 open across 18 sections and established the conventions this
sub-project follows — layered tasks, tests-first, and the audit-first visual loop.

## Problem

The `ux-review` pass on 2026-08-05 added the nineteenth review document,
`docs/ux-reviews/PluginsSection.md`, carrying **14 open findings** — five High, six Med, three Low.
Every other section reads 0. `PluginsSection` is the last settings section a regular user reaches
that never received the fixes the other eighteen did: it renders load failures as a bare red word,
shows raw schema enums as status copy, and stores plugin secrets through a field pattern its
siblings abandoned.

The intended end state is **0 open across 19 sections**, with `## Deferred` still listing exactly
`repos-no-edit-capability`.

Two defects were found while designing this sub-project that the review itself could not see,
because the review read only `client/`:

- `src/debug/settings/plugins-routes.ts:28` returns `hasValue` but never returns `value`, so a
  **non-sensitive** stored plugin setting is invisible in the UI — an empty text box with `(set)`
  appended to its label. Three sibling routes all return a value.
- `plugins-routes.ts:133` treats an empty submit on a sensitive field as a silent no-op returning
  `{ unchanged: true }`, and the client discards the flag, so that Save reports nothing at all.

Neither gets a new finding id. Both are fixed inside `plugins-config-field-not-shell` and
`plugins-save-no-success-feedback` respectively, and the closure task's `Resolved:` lines name them
so the record shows what was actually repaired.

## Scope

All 14 findings, one section, one sub-project.

| Finding | Severity | Disposition |
| --- | --- | --- |
| `plugins-config-field-not-shell` | High | fix |
| `plugins-load-error-no-recovery` | High | fix |
| `plugins-no-inflight-state` | High | fix |
| `plugins-raw-eligibility-strings` | High | fix |
| `plugins-validation-far-from-field` | High | fix |
| `plugins-cards-not-a-list` | Med | fix |
| `plugins-disabled-toggle-unexplained` | Med | fix |
| `plugins-hardcoded-spacing` | Med | fix |
| `plugins-head-no-trailing-alignment` | Med | fix |
| `plugins-required-not-passed-to-field` | Med | fix |
| `plugins-save-no-success-feedback` | Med | fix |
| `plugins-empty-state-dead-end` | Low | fix |
| `plugins-toggle-no-aria-pressed` | Low | fix, **by a different mechanism** (below) |
| `plugins-fixture-coverage-gap` | Low | fix |

## Architecture

### The split

`PluginsSection.svelte` (242 lines) keeps three responsibilities: fetching, with its existing
`id !== contextId` race guard (`:51-63`); rendering the four page-level states; and hosting the
shared `Confirm` dialog (`:192-204`), which stays at section level because one modal serves every
card. Everything inside the `{#each}` at `:135-188` moves to a new
`client/settings/components/PluginCard.svelte`, joining `ConfigFieldRow`, `ProviderForm` and
`RoleBindingBlock` in the directory where sibling sections already put this kind of component.

Interface:

```
PluginCard: {
  plugin: PluginEntry
  contextId: string
  onChanged: () => void                                  // mutation resolved; section re-fetches
  onRequestClear: (key: string, required: boolean) => void  // routes up to the section Confirm
}
```

The card imports `togglePlugin` and `patchPluginConfig` directly and owns its own mutation state.
Clearing is the one exception, routed up because the dialog is not the card's to own.

### Why the boundary is the fix

Today one `error` variable (`:25`) multiplexes four unrelated failures — load (`:59`), toggle
(`:71`), save (`:89`) and required-field validation (`:81`) — and renders all four at the top of the
section (`:125`). After the split that variable means exactly one thing: the load failed. It becomes
the input to `ErrorState` with a retry (`plugins-load-error-no-recovery`). Toggle and save failures
render inside the card that produced them. Validation goes to the owning field's `error` prop
(`plugins-validation-far-from-field`).

Three findings that read as separate feedback bugs are one structural bug, and the boundary is what
closes them.

In-flight state (`plugins-no-inflight-state`) likewise becomes two local booleans and one
`Record<key, boolean>` scoped to a single plugin, rather than the `pluginId::key` composite maps
the section uses today (`:49`, `:27`).

### Considered and rejected: reuse `ConfigFieldRow`

`ConfigFieldRow.svelte` is structurally close to what a plugin config row needs — it already
composes `SettingsFieldShell` + `Secret` + Replace, tracks `saving`, and carries the `markSaved`
acknowledgement idiom (`:52-68`). Reuse would mean parameterising it with injected save/clear
functions.

Rejected: it is bound to the `/settings/api/config` endpoint through `patchConfig`/`unsetConfigField`
and to `ConfigField`'s `storageKey`/`kind` shape, and it has no concept of a clear that must route
through a section-level `Confirm`. Generalising it would edit `ProfileSection`,
`TaskProviderSection` and `AiOutputSection` — three sections no finding covers — and move their
baselines. `PluginCard` duplicates the `markSaved` idiom instead, which is ~12 lines.

## Server change

`src/debug/settings/plugins-routes.ts:28-36` computes `getPluginConfig(...) ?? ''` inline to derive
`hasValue`. Hoist it to a `raw` local and add:

```ts
value: hasValue && r.sensitive ? maskSensitiveValue(raw) : raw,
```

Character-identical to `config-routes.ts:49`, `byok-field-response.ts:79` and
`coding-credentials-routes.ts:75`. `maskSensitiveValue` is already imported in this file (`:8`).

`client/settings/fetcher-schemas.ts:151` drops its `.omit({ value: true })`, so
`PluginConfigFieldSchema` becomes `StoredConfigValueSchema` outright. The base schema's `control`
and `options` members are optional, so the plugins payload stays valid without emitting them.

`patchPluginConfig` (`client/settings/fetchers.ts:190-195`) currently returns `Promise<unknown>` with
an identity parser; it gains a real return schema so `{ unchanged: true }` reaches the caller.

## Config field rendering

Each field becomes a `SettingsFieldShell` with `label={cfg.label}`, `required={cfg.required}` and
`error` bound to that field's own validation message. The shell renders the asterisk `aria-hidden`
and publishes `aria-required` through `field-context` (`SettingsFieldShell.svelte:36-40`), closing
`plugins-required-not-passed-to-field`. The `' *'` and `' (set)'` string concatenation at `:154`
disappears.

- **Sensitive field with a stored value:** resting state is `Secret` plus a `Replace` button in the
  `head` snippet, editor closed — the pattern at `CodeHostSection.svelte:296-303`. Replace opens an
  empty editor.
- **Everything else:** editor open, stored value as the draft.

That closes `plugins-config-field-not-shell` and, as a consequence of the server change, makes a
stored non-sensitive value readable for the first time.

**Save outcomes.** An `unchanged: true` response renders "No change — the stored value was the
same" rather than claiming a save that did not happen. Otherwise a transient `✓ Saved` marker
appears beside the control, using the `status-success` / `role="status"` idiom and the
`SAVED_VISIBLE_MS` self-clearing pattern from `ConfigFieldRow.svelte:57-68`
(`plugins-save-no-success-feedback`). Being transient it takes **no visual baseline** — unit
coverage only, for the reason SP5 recorded: `toHaveScreenshot()` retries until two consecutive
frames match, and an element that removes itself on a timer is a flaky gate.

**In-flight.** Save, Replace and the toggle each disable their control and pass `busy` to the
existing `Btn` prop for the duration of the request *and the reload that follows*
(`plugins-no-inflight-state`). The reload is the point: `toggle()` (`:65-73`) awaits `togglePlugin`
then `load()`, and the window where the button is live but the data is stale is exactly where a
double-click sends a contradictory second toggle.

## Eligibility copy

`eligibilityLabel` and `eligTone` (`:32-47`) move to a pure
`client/settings/lib/plugin-eligibility.ts`, following `client/settings/lib/mask-secret.ts`. It
exports a pill descriptor and an optional explanation sentence — pure functions, unit-tested without
mounting.

| Reason | Pill | Sentence |
| --- | --- | --- |
| `eligible` | `accent` "Ready" | none |
| `disabled` | `mute` "Off" | none — the button already reads "Enable" |
| `inactive` | `mute` "Unavailable" | names operator approval as the gate |
| `config_missing` | `warn` "Needs setup" | names the missing fields **by their `contextConfig` labels** |
| `capability_missing` | `warn` "Not supported here" | names the assigned provider as the cause, capability ids verbatim |

`registry-context-eligibility.ts:90-93` merges `requiredTaskCapabilities` and
`requiredChatCapabilities` into one flat list, so the client cannot tell which provider is at fault.
The sentence says "task or chat provider" rather than guessing. Capability ids stay verbatim: no
client-side label map is minted, because it would be a second source of truth that drifts silently
when a provider gains or renames a capability, and nothing would test it against the real set.

`src/plugins/eligibility-message.ts` is **not** reused. It is chat-facing (backtick-quoted plugin
ids), it still joins raw keys, it has no access to field labels, and it answers a different question
— why a command did not run.

## Accessibility

`plugins-toggle-no-aria-pressed` asks for `ariaPressed={plugin.enabled}`. **Its literal fix is
rejected**, on the precedent SP5 set for `guest-mode-toggle-not-exposed-a11y`: the button's label
already swaps between "Enable" and "Disable" (`:148`), so `aria-pressed` announces *"Disable,
pressed"* — the label naming the action and the state naming the opposite. `aria-pressed` suits
controls with a stable label.

The finding's intent — on/off exposed to assistive tech — is met the way SP5 met it: the status
`Pill` gains an id and the toggle's `ariaDescribedBy` points at it, giving "Disable, button, Ready".
The finding text records the rejection so it is not re-litigated.

That same `ariaDescribedBy`, pointed at the explanation sentence, is what makes a disabled toggle
explain itself (`plugins-disabled-toggle-unexplained`; the toggle is disabled only for `inactive`,
`:146`).

Both `Btn.ariaDescribedBy` and `Pill.id` already exist — SP5 added them. **This sub-project changes
no shared component.**

The card grid becomes `<ul>`/`<li>` and the plugin name an `<h3>` beneath `PageHeader`'s `h2`
(`PageHeader.svelte:25`), closing `plugins-cards-not-a-list`.

## Spacing and layout

`plugins-hardcoded-spacing` — `PluginsSection.svelte:208-241`, moving with the markup into
`PluginCard`:

- `.settings-plugins` `gap: 12px` → `var(--gap-inline)`
- `.settings-plugins__card` `padding: 12px` → `var(--gap-inline)`; `gap: 10px` → `var(--gap-inline)`
- `.settings-plugins__head` `gap: 12px` → `var(--gap-inline)`
- `.settings-plugins__cfg` `gap: 10px` → `var(--gap-inline)`
- `.settings-plugins__cfg-row` `gap: 8px` → `var(--gap-tight)`
- card gains `border-radius: var(--radius)`

The off-scale `10px` rounds **up** to `--gap-inline` rather than down to `--gap-tight`, matching the
sibling card in `McpSection.svelte`, which uses `--gap-inline` for the same relationship.

`plugins-head-no-trailing-alignment` — the head row gains `margin-left: auto` on the action (as
`.settings-mcp__primary-trailing` does), plus `flex-wrap` and `min-width: 0` on the name so a long
plugin name wraps instead of squeezing the pill and button.

`plugins-empty-state-dead-end` — the `EmptyState` at `:130` gains a `hint` explaining that plugins
are installed server-side by an operator. It gains **no `action`**, unlike
`KaneoAccessSection`'s "Check again": `PageHeader` already carries a Refresh control two rows up
(`:121`), and a second one inside the empty state would put the same action on screen twice.

## Fixtures and stories

`AdminPluginsApprovalSection.svelte:8` calls the same `fetchPlugins` and consumes the same
`settings-plugins-populated` scenario (`scenarios.ts:247`). Enriching that scenario in place — the
literal request of `plugins-fixture-coverage-gap` — would move a second section's baselines with no
finding driving the change.

Instead `settings-plugins-populated` stays byte-identical, and new scenario keys
(`settings-plugins-configurable`, `settings-plugins-ineligible`) land in a new
`client/stories/msw/settings-handlers-plugins.ts`, with matching stories in
`PluginsSection.stories.svelte`. `settings-handlers-personal.ts` already carries a comment recording
that it was split once to stay under the line limit; a third handler module follows its own
precedent.

Between them the new scenarios must cover: a required sensitive field with `hasValue: true`, a
non-sensitive field with a stored value, a required empty field, an `inactive` plugin (disabled
toggle), a `disabled` plugin, and a `config_missing` plugin.

Accepted trade-off: the default `Populated` story stays thin, and the representative states live in
sibling stories beside it.

The msw payloads are not schema-checked at preview boot — `assertFixturesMatchSchemas` covers only
the admin object fixtures. The check is `PluginsResponseSchema.parse` in `fetchPlugins`: a fixture
missing the newly required `value` throws at render, visibly, in the story.

## Task shape

Layered, each independently revertible:

1. Server `value` alignment + schema + `tests/debug/settings/plugins-routes.test.ts`
2. `plugin-eligibility.ts` + unit tests (pure, no UI)
3. **Extract `PluginCard` with no behaviour change**
4. Feedback: in-flight, per-field validation, `unchanged` / `✓ Saved`, section `ErrorState` + retry
5. Config rows: `SettingsFieldShell` + `Secret`/Replace; new fixtures and stories land here
6. Structure & a11y: `ul`/`li`, `h3`, `ariaDescribedBy` wiring
7. Spacing tokens, head alignment, empty-state hint
8. Documentation closure, last and alone

Task 3 is the load-bearing checkpoint: a pure extraction that moves zero pixels is the cheapest
proof the boundary did not change rendering, and every later task inherits that confidence. It is
also the only task in the list whose expected audit result is "no shots moved".

## Verification

### Behavioural tests

Component tests run with **`bun run test:client`**. Not `bun test tests/client/…`: `bunfig.toml:8`
lists `tests/client/**` in `pathIgnorePatterns`, so the direct form reports success without
executing anything.

`tests/client/settings/sections/PluginsSection.test.ts` is 400 lines / 13 tests, and this design
deliberately changes what several of them assert — `renders eligibility as a Pill, toggle/save as
Btn, config via Field/Input` (`:222`) and `saving an empty required plugin config shows an error and
does not POST` (`:201`) both encode the current behaviour. Roughly six tests move to the new
`tests/client/settings/components/PluginCard.test.ts` or get rewritten; the section file keeps
page-level coverage.

Each task writes its test first. Assertions:

- the route returns a masked value for a sensitive field and the verbatim value for a
  non-sensitive one
- `plugin-eligibility.ts` maps each of the five eligibility shapes to its pill and sentence, and
  resolves `missingKeys` to `contextConfig` labels
- `PluginCard` disables the toggle and marks it `busy` across the mutation and the reload
- a required empty field renders its error on the field, and does not POST
- an `unchanged: true` response renders the no-change copy; a normal save renders `✓ Saved` and
  clears it
- a sensitive field with `hasValue` renders `Secret` + Replace, not an empty input
- the section renders `ErrorState` with a working retry on load failure
- the toggle's `aria-describedby` resolves to the pill, and to the explanation when present

The server task touches `src/`, which is in the mutation ratchet's scope
(`test:mutate:changed` gates PRs), so its route tests must kill mutants rather than merely execute
the added line.

### Visual baselines

Per task, the SP5 loop:

1. `bun run visual:audit` **first** — the failure list is the prediction, recorded in the task report
2. `bun shoot -g PluginsSection` — scoped re-shoot only. Bare `bun shoot` is
   `playwright test --update-snapshots=all` and rewrites every baseline; it is never run
3. read every changed PNG and confirm it matches the prediction and the finding's intent
4. `bun run visual:audit` again for green

A green audit after a re-shoot is vacuous alone; it is meaningful only with steps 1 and 3. A shot
that moves without being predicted is a defect, not a baseline update.

`PluginsSection.spec.ts` currently holds nine shots — four generated state stories plus five manual
interaction/narrow shots added during the review. Tasks 4-7 move most of them; task 5 adds new ones
for the new stories.

## Documentation closure

Runs last and alone: a `Resolved:` line cites the commit that fixed the finding, and that hash does
not exist until the fix is committed.

- All 14 findings move to `Status: fixed` with `Resolved:` lines citing the earlier hashes.
- `plugins-toggle-no-aria-pressed` carries the recorded rationale for rejecting its literal fix.
- The `Resolved:` lines for `plugins-config-field-not-shell` and `plugins-save-no-success-feedback`
  name the two server-side defects fixed inside them.
- `bun run ux:backlog` regenerates `_BACKLOG.md`. Never hand-edited: the currency test in
  `tests/scripts/ux-backlog.test.ts` fails if the committed file and the generator disagree.

Expected generated end state: **0 open finding(s) across 19 section(s)**, all three severity buckets
reading `_None._`, and `## Deferred` containing exactly `repos-no-edit-capability`.

## Constraints

- Everything stays on `ui-ux-review-02`. No merge into master, no push.
- Never add a lint-disable or type-ignore comment; never pass `--no-verify`.
- Formatter is `oxfmt`, invoked as `bun run format`. Not prettier.
- Import paths use the `.js` extension even for TypeScript sources.
- `docs/ux-reviews/_BACKLOG.md` is generated; regenerate with `bun run ux:backlog`.
- Status vocabulary, exact strings: `open`, `fixed`, `superseded`, `wont-fix`, `deferred`. Any
  non-`open` status requires a non-empty `- **Resolved:**` line.

## Out of scope

- Enriching `settings-plugins-populated` itself, and any change to `AdminPluginsApprovalSection`.
- Sanitizing error text in the other 17 `ErrorState` consumers.
- Generalising `ConfigFieldRow` to serve both endpoints.
- A client-side capability label map, or human labels in the eligibility payload.
- Re-running the `ux-review` skill against the fixed section. Review is a separate, human-initiated
  session; this sub-project closes findings, it does not re-audit.
- The whole-branch code review and the `finishing-a-development-branch` handoff. Both remain the
  user's scope decision.
