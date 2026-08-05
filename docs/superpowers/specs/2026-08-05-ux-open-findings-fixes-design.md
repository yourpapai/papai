<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX open-findings fixes — design

**Sub-project:** SP5. Scope-mate: SP4 (`docs/superpowers/specs/2026-08-04-ux-backlog-vocabulary-design.md`),
which gave the backlog the vocabulary this sub-project's closures depend on.

## Problem

SP4 left `docs/ux-reviews/_BACKLOG.md` reading **9 open findings across 18 sections** — two Med,
seven Low — and every one of those nine is an actionable UI defect rather than a bookkeeping
artefact. SP5 acts on them. Eight are fixed in `client/`; one is closed by decision once the
evidence is examined (below). The intended end state is **0 open across 18 sections**, with the
`## Deferred` section still listing `repos-no-edit-capability` — the one piece of real work that
outlives the project, which is precisely what SP4's vocabulary exists to express.

This is the first sub-project on this branch that changes `client/`. Every predecessor was
forbidden from doing so, which is why "never run `bun shoot`" held as an absolute: the
467-passing visual audit was a strict, non-mutating proof, and re-shooting baselines would have
made a subsequent audit pass by construction. SP5 moves baselines by definition, so that rule is
replaced rather than kept — see *Visual baselines*.

## Scope

Eight fixes and one closure.

| Finding | Section | Severity | Disposition |
| --- | --- | --- | --- |
| `byok-load-error-raw-message` | ByokSection | Med | fix |
| `guest-mode-toggle-not-exposed-a11y` | GuestModeSection | Med | fix |
| `ai-output-no-save-confirmation` | AiOutputSection | Low | fix |
| `byok-hardcoded-spacing` | ByokSection | Low | fix |
| `coding-credentials-conditional-fields-unexplained` | CodingCredentialsSection | Low | fix |
| `kaneo-access-empty-state-dead-end` | KaneoAccessSection | Low | fix |
| `kaneo-access-password-no-copy-rehide` | KaneoAccessSection | Low | fix |
| `members-empty-state-dead-end` | MembersSection | Low | fix |
| `profile-sparse-layout-minimal-data` | ProfileSection | Low | **wont-fix** |

### The one closure

`profile-sparse-layout-minimal-data` asks for "a lightweight visual anchor (e.g. a subtle bordered
panel/section wrapper)" under `ProfileSection`'s lone field row. Two facts, verified against the
tree, make that the wrong change:

- `client/shared/ui/Panel.svelte` has **zero consumers under `client/settings/`**. It exists with a
  story and is used nowhere in the settings SPA.
- `ProfileSection`, `AiOutputSection`, `TaskProviderSection` and `AdminPluginsConfigSection` all
  render the identical unframed `.settings-field-list`.

Framing `ProfileSection` alone would fix rubric dimension 7 (responsive/layout) by breaking
dimension 3 (consistency with the design system), introducing a card idiom that exists in exactly
one settings section. Framing all four would edit three sections no finding covers and move their
baselines — a larger sub-project than the nine fixes. The sparseness is also honest: the section
genuinely has few preferences, and `PageHeader`'s descriptive `sub` (added in `7b4210424`) already
delivered the copy half of the original finding.

Recorded as `wont-fix` — no work remains — rather than `deferred`, which would assert that framing
is real work merely blocked elsewhere. It is not; it is declined.

## Shared-component changes

Four shared components are touched. All four changes are **additive optional props whose default
rendering is byte-identical**, so no consumer that does not opt in can move.

### `ErrorState` gains `detail?: string`

`client/shared/ui/ErrorState.svelte` prints whatever `message` it is handed, and 18 sections hand
it a raw `err.message`. `byok-load-error-raw-message` is therefore a shared-component problem, but
fixing it across all 18 consumers would edit 17 sections no finding covers and re-open closed
reviews.

`ErrorState` gains an optional `detail` prop, rendered as a collapsed `<details>` beneath
`.ui-error__message` and omitted entirely when the prop is absent. The other 17 consumers keep
byte-identical output.

`ByokSection` then passes a written, user-facing sentence as `message` and the raw exception text
as `detail`, so the diagnostic string is **demoted, not discarded** — which is what the finding
asks for. The sanitizing lives in `ByokSection`; `ErrorState` stays a dumb renderer and gains no
opinion about error text.

### `ConfigFieldRow` gains a transient saved signal

`ai-output-no-save-confirmation`'s root cause is at
`client/settings/components/ConfigFieldRow.svelte:114-115`: `patchConfig` resolves, `onSaved()`
re-fetches, and nothing tells the user the save landed. The section's `onSaved` callback could set
a section-level status instead, but that renders the confirmation at the top of the section rather
than beside the control the user just touched — on a multi-row field list, that fails to identify
*which* row saved.

The signal therefore lives in `ConfigFieldRow`: on `saveEnum` resolving, a `✓ Saved` marker appears
beside the control and clears itself after roughly two seconds, using the established
`status-success` / `role="status"` idiom (27 existing occurrences under `client/settings/`) rather
than introducing toast infrastructure, of which the codebase has none.

This reaches `ProfileSection` and `TaskProviderSection`, the other two `ConfigFieldRow` consumers.
Both have the identical gap and no finding covering it. This is the one place SP5 improves a
section no finding named; it is accepted deliberately because the alternative is a worse fix for
the section that *does* have the finding. Because the marker is transient, no static baseline
moves.

### `Btn` gains `ariaDescribedBy?: string`

`Btn` already supports `ariaLabel` and `ariaPressed`. It has no way to reference a description
element, which `guest-mode-toggle-not-exposed-a11y` needs. One optional attribute, additive and
visually inert.

### `Pill` gains `id?: string`

The On/Off `Pill` must be referenceable by `aria-describedby`, and it renders a bare
`<span class="ui-pill">` with no id. The alternative — wrapping it in an id-carrying `<span>` —
is worse: `Pill` is `display: inline-flex` and sits as a direct flex child of
`.ui-page-header__action`, so a wrapper would become the flex item and introduce a line box,
risking a height shift. That would move a visual baseline for a change that is supposed to be
invisible. One optional attribute rendered on the existing span, with no wrapper and no layout
change.

## Section-local fixes

All anchors below were re-verified against the working tree while writing this spec.

### `GuestModeSection` — `guest-mode-toggle-not-exposed-a11y`

Three parts, one task:

1. The toggle-mutation error `<p>` at `:87` gains `role="alert"`, matching the load-error `<p>` at
   `:96` that already has one.
2. The help caption at `:98-100` gains an id, the On/Off `Pill` at `:64` gains an id, and the
   toggle `Btn` an `ariaDescribedBy` naming both.
3. **The finding's literal suggested fix is rejected.** It asks for `aria-pressed={enabled}`, but
   the button's label already swaps between "Enable guest mode" and "Disable guest mode"
   (`:73-79`). Combining the two announces *"Disable guest mode, pressed"* when guest mode is on:
   the label names the action, the state names the opposite, and they read as a contradiction.
   `aria-pressed` suits controls with a stable label. The finding's *intent* — the on/off value
   exposed to assistive tech — is satisfied instead by tying the existing On/Off `Pill` (`:64`) to
   the control via `aria-describedby`, giving "Disable guest mode, button, On".

   The review document records why `aria-pressed` was rejected, so a future reader does not
   re-litigate it.

### `KaneoAccessSection` — two findings, one task

- `kaneo-access-empty-state-dead-end`: the `EmptyState` at `:95-97` gains an `action` snippet.
  `EmptyState` already supports `action` (`EmptyState.svelte:13`, `:23`); no component change is
  needed. The action is a "Check again" button re-running `load(contextId)`, not a link: this is
  the personal view of a member who is not provisioned, provisioning happens asynchronously
  server-side, and the settings SPA has no members/admin destination reachable from a
  non-provisioned personal context.
- `kaneo-access-password-no-copy-rehide`: the revealed-password block at `:121-129` gains a "Hide"
  control beside the existing `CopyButton`, resetting `revealedPassword` to `null`.

  The finding's suggested fix stops there, but reveal is **destructive server-side**:
  `src/debug/settings/kaneo-credentials-routes.ts:127` calls `clearStoredPassword` before
  returning, so a second reveal 409s with "No stored password for this account". A bare Hide would
  therefore restore a "Reveal password" button that cannot work, and the user would have discarded
  the only copy of a secret to reach it. Hiding is consequently one-way in the UI too: the
  component tracks that a reveal has happened, and after Hide renders a terminal line
  ("Password hidden — it was shown once and can't be shown again.") in place of the reveal button.
  This costs one `$state` boolean and keeps the UI's affordances truthful about the server's
  reveal-once contract.

### `CodingCredentialsSection` — `coding-credentials-conditional-fields-unexplained`

`hint` props on the two conditional fields: why *Auth method* appeared (`provider === 'anthropic'`)
and why *Base URL* became required (`provider === 'openai-compatible'`). `SettingsFieldShell`
already renders `hint` with a proper id (`:25`, `:73`); no new API.

### `MembersSection` — `members-empty-state-dead-end`

`:162`: `{#snippet empty()}No members{/snippet}` becomes a one-line pointer at the add form
directly above it.

### `ByokSection` — `byok-hardcoded-spacing`

Replace one-off literals with spacing tokens across three files:

- `ByokSection.svelte:397-403` — `.row-actions { gap: 4px }` → `var(--s1)`
- `ProviderForm.svelte:98-101` — `.provider-form__field { gap: 4px }` → `var(--s1)`;
  `.provider-form__actions { gap: 8px }` → `var(--gap-tight)`
- `RoleBindingBlock.svelte:96-100` — `.role-binding { gap: 6px; padding: 8px 0 }` and
  `.role-binding__controls { gap: 8px }`

The `6px` gap has no matching spacing token. It is **rounded to `--s2`** rather than given a new
`--s1-5`: 6px exists in the system only as `--radius`, and minting a half-step to preserve one
gap would damage the scale to avoid a 2px change. That nudge is the fix doing its job, not a
regression.

## Task shape

Layered — shared components first, then sections, then documentation:

1. `ErrorState.detail`
2. `ByokSection` consumes it (sanitized message + demoted raw text)
3. `ConfigFieldRow` saved signal
4. `Btn.ariaDescribedBy` + `Pill.id` + `GuestModeSection` accessibility
5. `KaneoAccessSection` (both findings)
6. `CodingCredentialsSection` hints
7. `MembersSection` empty copy
8. `ByokSection` spacing tokens
9. Documentation closure

A shared-component change and its consumer are reviewed separately, so a reviewer judging whether
`detail` is a sound API is not simultaneously judging ByokSection's copy. The two diffs with the
widest reach (18 and 3 consumers) stay isolated and individually revertible. Baselines move in
small attributable batches, which matters because every changed PNG is inspected by hand.

## Verification

### Behavioural tests

Run with **`bun run test:client`**. Not `bun test tests/client/…`: `bunfig.toml:8` lists
`tests/client/**` in `pathIgnorePatterns`, so the direct form silently reports success without
executing anything. The `test:client` script overrides it with `--path-ignore-patterns ''`.

Most of these fixes are assertable without pixels, and each task writes its test first:

- `ErrorState` renders the `<details>` only when `detail` is passed, and output is unchanged when
  it is not
- `ConfigFieldRow` shows the saved marker after a resolved save and clears it
- `GuestModeSection`'s `aria-describedby` resolves to the caption element; the mutation-error `<p>`
  carries `role="alert"`
- `KaneoAccessSection`'s Hide control clears the revealed password and leaves the terminal
  "shown once" line rather than a re-armed Reveal button; the `EmptyState` renders its action
- `CodingCredentialsSection` renders the `hint` text on each conditional field
- `MembersSection` renders the new empty copy

### Visual baselines

The predecessor rule ("never run `bun shoot`") is replaced by an **audit-first, scoped-reshoot,
inspect-every-frame** loop, run per task:

1. `bun run visual:audit` **first**. The failure list enumerates exactly which shots the change
   moved. That list is the prediction, recorded in the task's report.
2. `bun shoot -g <Section>` to re-shoot only that section. Bare `bun shoot` is
   `playwright test --update-snapshots=all` and rewrites all 465 baselines; it is never run.
3. Read every changed PNG and confirm it matches the prediction and the finding's intent.
4. `bun run visual:audit` again for green.

A green audit after a re-shoot is vacuous on its own. It is meaningful here only in combination
with steps 1 and 3: the set of moved shots was predicted before the re-shoot, and each moved image
was inspected afterwards. A shot that moves without being predicted is a defect, not a baseline
update.

`playwright.config.ts:34-41` sets audit-mode `threshold: 0.02` and sets neither `maxDiffPixels` nor
`maxDiffPixelRatio`, so both default to 0: a single over-threshold pixel fails. The audit floor
before SP5 is **467 passed / 0 failed**, and it must return to 0 failed at every task boundary.

### States not capturable today

- `CodingCredentialsSection`'s story set exercises only `claude`/`anthropic`/`api-key`, so the
  `openai-compatible` Base URL hint cannot be shot. That task adds a story arg for it.
- The `✓ Saved` marker is transient and gets **no visual baseline at all** — unit coverage only.
  An interaction test in the manual region was the original plan and is wrong:
  `toHaveScreenshot()` retries until two consecutive frames match, and an element that removes
  itself on a timer either vanishes mid-loop or is captured after dismissal. That is a flaky gate
  on a suite whose contract is 0 failed, so the marker is asserted in
  `tests/client/settings/components/ConfigFieldRow.test.ts` and nowhere else. The `settings-config-*`
  fixtures also register no PATCH handler, so such a story would need a new scenario purely to
  photograph a two-second element.

### Documentation closure

The closure task runs **last and alone**. A `Resolved:` line cites the commit that fixed the
finding, and that hash does not exist until the fix is committed — so all nine dispositions land in
one final task citing the eight earlier hashes.

- Eight findings move to `Status: fixed` with a `Resolved:` line citing the fixing commit.
- `profile-sparse-layout-minimal-data` moves to `Status: wont-fix` with the rationale above and no
  commit hash — the SP4 convention for a decision-close.
- `bun run ux:backlog` regenerates `_BACKLOG.md`. Never hand-edited: the currency test in
  `tests/scripts/ux-backlog.test.ts` fails if the committed file and the generator disagree.

Expected generated end state: **0 open finding(s) across 18 section(s)**, all three severity buckets
reading `_None._`, and a `## Deferred` section containing exactly `repos-no-edit-capability`. The
section count stays 18 — it is the number of review documents, not the number with open findings.

## Constraints

- Everything stays on `ui-ux-review-01`. **No merge into master, no push.** PR #212 is untouched.
- Never add a lint-disable or type-ignore comment; never pass `--no-verify`. The pre-commit hook
  runs lint / typecheck / format:check / license-headers.
- Formatter is `oxfmt`, invoked as `bun run format`. Not prettier.
- Import paths use the `.js` extension even for TypeScript sources.
- `docs/ux-reviews/_BACKLOG.md` is generated; regenerate with `bun run ux:backlog`.
- Status vocabulary, exact strings: `open`, `fixed`, `superseded`, `wont-fix`, `deferred`. Any
  non-`open` status requires a non-empty `- **Resolved:**` line.

## Out of scope

- Sanitizing error text in the other 17 `ErrorState` consumers. Systemic and worth doing; not
  covered by any finding, and it would re-open closed reviews.
- Framing the field lists of `AiOutputSection`, `TaskProviderSection` or `AdminPluginsConfigSection`,
  or giving `Panel` its first settings consumer.
- Raising `--control-h-sm`, or building repository update support — the two dispositions SP4 closed
  as `wont-fix` and `deferred` respectively. Both stay closed.
- Re-running the `ux-review` skill against the fixed sections. Review is a separate, human-initiated
  session; SP5 closes findings, it does not re-audit.
- The final whole-branch code review covering SP1–SP5, and the `finishing-a-development-branch`
  handoff. Both remain the user's scope decision.
