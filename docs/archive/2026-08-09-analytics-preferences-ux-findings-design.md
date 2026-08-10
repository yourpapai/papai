<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AnalyticsPreferencesSection UX Findings — Design

## Problem

The UX review in `docs/ux-reviews/AnalyticsPreferencesSection.md` (commit `7ad68c8dc`) left
fifteen open findings against the last unreviewed section of the always-visible personal
settings group, scoring three rubric dimensions `fail`. Two of the findings are not local to
the section: the keyboard trap lives in `client/shared/ui/SegmentedControl.svelte`, and the
live-region defect has no fix anywhere in the codebase — `grep aria-live client/settings`
returns nothing, while the identical finding is already open against `AdminUsersSection` and
`CodingMcpSection`.

Designing the fix surfaced two defects the review missed, both stemming from server behaviour
no fixture exercises. They are handled here and recorded as new findings rather than folded
silently into existing ones.

## Decision record (from brainstorming)

1. **Scope** — all fifteen section findings, plus the shared fixes they force. The
   `SegmentedControl` bug is fixed in the primitive; the live-region pattern is established
   here. `AdminUsersSection` and `CodingMcpSection` are *not* edited — they adopt the new
   primitive later, and their findings stay open.
2. **The unset consent state** — two segments, neither selected, with the status stated in
   words beneath the row. A third "Not set" segment was rejected: unset is a status, not
   something a user can choose, and offering it implies you can un-answer a consent question.
3. **The live region** — a shared `client/shared/ui/LiveRegion.svelte` primitive, so the other
   two sections adopt it with an import rather than re-deriving the shape.
4. **Sequencing** — three commits: primitives, then structure, then behaviour. Structure
   before behaviour because `SettingsFieldShell`'s `error` and `hint` slots are what make the
   behaviour commit cheap; doing behaviour first means writing the same fix twice.

## Facts established by reading the source

These are load-bearing. Each was verified, not assumed.

- **`subjectRightsAvailable: false` means the operator has not configured the governance
  keyring** (`src/debug/settings/analytics-routes.ts:62,136`) — a deployment condition, not
  anything about the user. Copy must point at the server, not the person.
- **Export is gated server-side exactly like withdraw and delete.** `handleExport` calls
  `requireGovernanceKeyring` (`analytics-routes.ts:175`) and returns 503. Leaving its button
  enabled is a defect, not a consistency preference.
- **Aggregate collection continues when governance is unavailable.**
  `src/analytics/governance/eligibility.ts:136` returns an aggregate decision before the
  `governanceReady` check. The unavailable-state copy must not claim nothing is collected.
- **An unset choice does not always mean "off".** `eligibility.ts:99-107`: the external lane
  denies on unset unconditionally, but the local lane *admits* collection when
  `lawfulBasisMode` is `legitimate_interest` and `policyEffectiveAtMs` has passed. The section
  already receives both values from `handleGetPreferences` and ignores them.
- **A deletion can report `failed`.** `AnalyticsDeleteResponseSchema` allows
  `completed | in_progress | failed | requested`
  (`client/settings/fetcher-schemas-analytics.ts:75`); `confirmDelete` funnels all four into
  `announcement`, so a failed deletion renders green through `role="status"`.
- **`SettingsFieldShell`, not `Field`, is the right container.** Its source comment
  (`client/settings/components/SettingsFieldShell.svelte:61-67`) names `SegmentedControl` as
  the intended `head` occupant, and `ConfigFieldRow` already uses it that way.
- **`ConfigFieldRow` already passes `busy` to `SegmentedControl`** (`ConfigFieldRow.svelte:165`).
  The missing "Saving…" affordance is an existing pattern this section skipped, not new work.
- **The TDD hook does not fire on `.svelte` files** — its scope is `.ts/.js/.tsx/.jsx` under
  `src/`/`client/` (`docs/architecture/commands.md:69`). Of the files this design touches, only
  the msw scenario module is gated.
- **The caption half of `analytics-prefs-off-scale-spacing-and-type` was wrong.**
  `.settings-section__caption` is declared identically — 12px, `--text-dim` — in three sibling
  sections, so 12px is the house convention.

## Architecture

### Commit 1 — shared primitives

**`client/shared/ui/SegmentedControl.svelte`.** Derive the active index once —
`options.findIndex((o) => o.value === value)`, falling back to `0` when nothing matches — and
key `tabindex` off that index instead of off value equality. Today
`tabindex={value === opt.value ? 0 : -1}` gives every option `-1` whenever the value matches no
option, removing the group from the tab order entirely. A group with no selection then has
exactly one tab stop, which is what the ARIA radiogroup pattern prescribes. Arrow handling
already keys off the button's own index and needs no change. `aria-checked` stays `false` on
every option: nothing is selected, and the fix must not imply otherwise.

This also closes the latent trap in `ConfigFieldRow` (`ConfigFieldRow.svelte:160-161`), where
`value={current}` is checked against `field.options ?? []` and a stored value that has left its
option list produces the same dead group. `ToolsSection` is unaffected — its value is always one
of `PERM_OPTIONS`.

**`client/shared/ui/LiveRegion.svelte`** — new. Props `message: string | null`,
`tone: 'status' | 'alert'`, optional `testid`. Always mounted; renders
`role="status" aria-live="polite"` or `role="alert" aria-live="assertive"`, class
`status-success` or `status-error`, and text `message ?? ''`. Being permanently in the DOM with
its text swapped is the whole point: a region created at the same moment as its text may not be
announced.

Risk to prove, not assume: an always-mounted empty `<p>` must contribute no box, or every
adopting section gains a phantom gap. It carries `margin: 0` and no padding, so an empty one is
zero-height — verified against commit 1's own visual run before commit 2 builds on it.

No section changes and no snapshot churn in this commit.

### Commit 2 — section structure

Each consent lane becomes a `SettingsFieldShell`: `label` the lane name, `head` the
`SegmentedControl`, `hint` the per-lane status line, `error` reserved for commit 3's per-lane
failure. The bespoke `.settings-field` / `.settings-field__label` rules and the
`justify-content: space-between` row are deleted with it, which is what closes the far-edge
stranding at wide viewports, the off-scale 13px label, and the literal `12px` gap together.

`PageHeader` gains `sub` — the account-scope sentence — and an `action` snippet carrying the
same `IconButton label="Refresh" glyph="⟳"` the three sibling personal sections use, giving a
way back from a failed load. The purpose/controller notice and the explanation remain
`.settings-section__caption` paragraphs; only their `margin` drops to `0` to match siblings.

The standalone `effectiveText` summary line is removed — its content moves into the per-lane
hints, which is what stops it restating the controls in raw enum words.

This commit changes structure only. Its snapshot churn is expected and is the one place the
layout diff can be read on its own.

### Commit 3 — behaviour, copy and gating

**Hint text** comes from a pure exported function in a new module,
`client/settings/sections/analytics-preferences-copy.ts`, taking
`(lane, value, effectiveAtMs, lawfulBasisMode, policyEffectiveAtMs, nowMs)` and returning a
string. The status-sentence map for `confirmDelete` lives beside it. Both are `.ts` under
`client/`, so the TDD hook applies and their tests are written first. Set states read "Allowed since …" / "Denied since …" using the existing
`formatDateTime` from `client/shared/helpers.ts:41`, which also closes the raw
`toLocaleString()` finding. Unset states state what unset actually means for that lane on this
deployment:

| Lane                  | Lawful basis                             | Unset text                                                                     |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| external pseudonymous | any                                      | No choice recorded — external analytics stay off until you allow them.         |
| local longitudinal    | `consent`                                | No choice recorded — local analytics stay off until you allow them.            |
| local longitudinal    | `legitimate_interest`, before effective  | No choice recorded — local analytics stay off until you allow them.            |
| local longitudinal    | `legitimate_interest`, effective reached | No choice recorded — local analytics are collected until you deny them.        |

Pure and exported, so the legitimate-interest branch is unit-testable without mounting the
component.

**Rights unavailable** replaces the per-lane hints with one paragraph below the header saying
the operator has not finished configuring analytics governance, and that per-account choices,
export and deletion are unavailable until they do. It does not claim nothing is collected.
Export moves behind the same flag as withdraw and delete.

**Errors and announcements.** `messageFrom` gives way to `formatFetchError`
(`client/shared/format-error.ts:14`), matching the sibling settings sections. A failed lane save routes to that lane's `SettingsFieldShell` `error`
slot, placing the message under the control that failed instead of below the destructive
actions; that message has to say the setting was not changed, since the control silently
reverts to its stored value. Action-level failures and successes go through the two
`LiveRegion`s. `confirmDelete` maps all four statuses to sentences, routing `failed` to the
alert region rather than the status region.

**Busy.** `busy` reaches `SegmentedControl`'s existing `busy` prop and the three `Btn`s.

**ARIA.** `ariaDescribedBy` stops duplicating `ariaLabel` and points at the hint instead, so the
group name is not announced twice.

## Data flow

`fetchAnalyticsPreferences` already returns everything needed; nothing new is requested from the
server. `notice.lawfulBasisMode` and `notice.policyEffectiveAtMs` stop being discarded and feed
the hint function alongside `preference.*`. `subjectRightsAvailable` gates all four actions and
suppresses the per-lane hints. No new endpoints, no schema changes, no server edits.

## Error handling

Three distinct channels, currently collapsed into two:

- **Load failure** — unchanged: full-section `ErrorState` with retry, now also reachable via the
  header refresh action.
- **Per-lane save failure** — the lane's `error` slot, naming the lane and stating the setting
  was not changed.
- **Action failure** (export / withdraw / delete, including `status: 'failed'`) — the alert
  `LiveRegion`.

## Testing

- `tests/client/shared/ui/SegmentedControl.test.ts` (exists) gains the tabindex fallback cases:
  unmatched value, and the unchanged matched-value case.
- New `tests/client/shared/ui/LiveRegion.test.ts` — both tones, and the empty-message case.
- New `tests/client/settings/sections/analytics-preferences-copy.test.ts` — every row of the
  table above plus all four delete statuses. Written before the module, per the TDD hook.
- `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts` (262 lines) updated for
  the gating, the status mapping, and the error routing.
- Two new msw scenarios in `client/stories/msw/settings-handlers-personal-2.ts` —
  rights-unavailable and legitimate-interest-unset — with matching stories, since neither state
  can be shot today.
- Re-shoot the section and **read the frames**, not just the diff.

## Bookkeeping

Walk `docs/ux-reviews/AnalyticsPreferencesSection.md` by id. Each fixed finding takes
`Status: fixed` and a `Resolved:` line naming its commit.
`analytics-prefs-off-scale-spacing-and-type` stays `open`, narrowed to the label and gap, since
its caption claim is disproven. The two defects found while designing land as new findings with
fresh ids. `bun run ux:backlog` regenerates, and `Date:` becomes the day the fix lands.

## Out of scope

- `AdminUsersSection` and `CodingMcpSection` adopting `LiveRegion` — their findings stay open.
- `AdminReleaseNotesSection` and `AdminAnalyticsSection` using `.settings-section__caption`
  without declaring it, so their captions render unstyled. Real, unrelated, noted only.
- Any server-side change. Every behaviour above is derivable from the existing response.
