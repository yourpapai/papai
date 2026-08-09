<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — CodingMcpSection open UX findings

**Date:** 2026-08-07
**Review:** [`docs/ux-reviews/CodingMcpSection.md`](../../ux-reviews/CodingMcpSection.md)
**Component:** `client/settings/sections/CodingMcpSection.svelte`

## Scope

Nine of the review's ten findings. `coding-mcp-live-region-mounts-with-text` is
excluded by decision: it is a module-wide pattern also recorded as
`admin-users-live-region-mounts-with-text`, and it warrants one cross-section
change rather than a per-section fix. It stays `open` in both reviews.

| Id                                             | Severity | Addressed by       |
| ---------------------------------------------- | -------- | ------------------ |
| `coding-mcp-duplicate-server-saves-silently`   | High     | Validation model   |
| `coding-mcp-blank-row-blocks-save-silently`    | High     | Validation model   |
| `coding-mcp-server-cap-unexplained`            | Med      | Cap counter        |
| `coding-mcp-error-state-buries-what-failed`    | Med      | Error state        |
| `coding-mcp-actions-row-escapes-card-alignment` | Med      | Actions-row inset  |
| `coding-mcp-peer-field-widths-diverge`         | Med      | Select fill        |
| `coding-mcp-async-actions-never-announce-busy` | Med      | Busy props         |
| `coding-mcp-remove-live-during-save`           | Low      | Remove guard       |
| `coding-mcp-empty-states-are-bare-prose`       | Low      | `EmptyState`       |

## Motivation for the duplicate fix

The duplicate is not merely untidy state. `src/coding-credentials/resolve-mcp-servers.ts`
documents itself as *"Fail-closed, all-or-nothing: if any selection doesn't currently
resolve (disabled/removed internal server, missing token, unknown catalog entry,
duplicate selection) or the set exceeds the operator's `maxMcpServers` guardrail, the
whole call fails and the error names the offending server"* (`:94-97`), and the code
backs it: `:122-128` keeps a `seen` set and returns a failure whose error names the
offending server as selected more than once.

So the settings UI happily saves a configuration the backend refuses, and the refusal
is total — the context loses every MCP server, not just the repeated one. The user is
told nothing at save time and meets the failure later, inside a coding session, with no
signpost back to the settings page that caused it. Blocking the save is the only place
this can be caught while the cause is still on screen.

## 1. Validation model

Today two unrelated mechanisms are half-present: `hasEmptyServer` (`:58`) gates Save but
explains nothing, and duplicates are not checked at all. Replace both with one derived
per-row problem list.

A row is invalid when:

- its `server` is blank (trimmed length 0), or
- its `server` equals the `server` of an **earlier** row.

Marking the later occurrence and leaving the first clean is what lets the copy point
somewhere: the first row is the one the user keeps, the later ones are the mistake.

Each invalid row's server `Field` receives the `error` prop it already supports
(`client/shared/ui/Field.svelte:23`, currently unused here):

- blank → `Choose an MCP server.`
- duplicate → `Already selected in another row.`

Save's predicate drops `hasEmptyServer` in favour of "any row invalid". `saveAll()`'s
own early-return guard (`:119`) changes in step, so the guard and the disabled state
stay expressed by the same condition rather than drifting apart.

This closes both High findings with one mechanism. The alternative — filtering
already-chosen servers out of the remaining rows' options — was rejected: it makes a
row's option list depend on other rows, so a server silently vanishes from a dropdown
with no stated reason, trading a visible error for an invisible one.

## 2. Cap counter

A persistent count beside Add: `2 of 3 servers used`. Persistent rather than
appear-on-limit, so the ceiling is knowable before the user hits it.

**The cap may be absent client-side.** `client/settings/fetcher-schemas.ts:94` declares
`maxMcpServers` optional and the component falls back to `Number.POSITIVE_INFINITY`
(`:46`). The server always sends one (`src/coding-credentials/guardrails.ts:18`:
`.int().min(1).max(8).default(3)`), but the client contract permits its absence. The
counter must therefore render only when the cap is finite. It must never read
`2 of ∞`, and it must never read a bare `2` that implies a limit that was not sent.

With the count present, the disabled Add needs no separate explanation.

## 3. Actions-row inset

Measured at 1280px: card content starts at x=13 while `Add server` starts at x=0, and
Save's right edge lands on 1280.0 — the viewport boundary — against card content ending
at 1197.3. The local `.settings-field__actions` (`:321`) sets no `padding-inline`.

Add `padding-inline: 13px`, measured against **this** component's card geometry.

The two sibling sections that solved the same alignment use `14px`
(`CodingCredentialsSection.svelte:419`, `CodeHostSection.svelte:378`), and both carry
comments recording that the value was measured rather than derived. Copying `14px` here
would be visibly off by one, because this section's row cards use `padding:
var(--gap-inline)` and a 1px border, not the siblings' geometry. The new declaration
gets the same kind of comment, naming the measurement and stating why it differs from
its neighbours — otherwise the next reader will "fix" the inconsistency.

## 4. Select fill

`.settings-mcp__field :global(.ui-input) { width: 100% }` (`:315`) stretches the
credential `Input` but has no `Select` counterpart, so the `<select>` keeps its
intrinsic width at every viewport: measured 152.0px inside a 566.1px flex item, against
a 584.1px input inside a 606.1px one — a 3.8× mismatch with roughly 390px of dead space
between the select and the `CREDENTIAL` label, at both 1280px and 640px.

Extend the rule so the `.ui-select` fills its flex item the same way. The two fields
then read as a matched pair and the gap closes at every width.

## 5. State and feedback

Four small, independent corrections:

- **Busy.** Save (`:262`) and Clear (`:250`) drive only their visible label from
  `saving` / `clearing`; Save measures `aria-busy="false"` mid-flight. Pass the existing
  flags through `Btn`'s `busy` prop, which forwards to `aria-busy`
  (`client/shared/ui/Btn.svelte:53`) — the treatment the Refresh `IconButton` already
  gets at `:174`. Note `Btn` also applies `pointer-events: none` and an opacity shift
  under `busy`; both buttons are already `disabled` under the same flags, so this adds
  no behavioural change beyond the announcement.
- **Remove guard.** The Remove `Btn` (`:228`) takes no `disabled` prop while the row's
  `Select` (`:206`) and Add (`:244`) both carry `disabled={saving || loading}`. Give
  Remove the same guard so the row set cannot change underneath an in-flight save.
- **Error state.** `:184` passes the raw exception as `message`, which renders
  `Something went wrong` over a bare `boom`. `ErrorState` documents `detail` as the slot
  for *"Raw diagnostic text (e.g. an exception message) demoted to a collapsed
  disclosure"* (`client/shared/ui/ErrorState.svelte:13-14`). Pass a plain-language
  `message` naming the failed operation — loading this context's MCP settings — and move
  the exception to `detail`.
- **Empty states.** Both dead ends are bare `.placeholder` prose: the no-catalog line
  (`:190`) and the empty form (`:192`). Render them through the shared `EmptyState` so
  each gets a title and a next step. The no-catalog case's next step is the operator ask
  it already states; the empty case's is adding the first server.

Note `.placeholder` on the *instructional* intro paragraph is house convention
(`ByokSection`, `CodeHostSection`) and stays as it is — only the two dead-end states
change.

## Testing

Client tests (`tests/client/settings/sections/`), each proven load-bearing before it
counts:

- the validation matrix — blank only, duplicate only, both, neither — asserting both the
  per-row `error` text and Save's disabled state
- duplicate marking falls on the later row, not the first
- the cap counter renders with a finite cap and is absent when `maxMcpServers` is omitted
- Save and Clear report `aria-busy="true"` in flight
- Remove is disabled during a save
- the error state shows a plain message with the exception in `detail`

Visual: re-shoot `tests/visual/settings/sections/CodingMcpSection.spec.ts`. The five
manual states added during the review already cover the at-cap, blank-row and narrow
cases; add one duplicate-selection state. Expect intentional diffs on nearly every
existing baseline — the inset and select-width changes move the layout — so each
accepted baseline needs a look, not a blanket update.

Then re-score the review: dimensions 4 and 8 should reach `pass`, 3, 5 and 9 should
clear their cited defects, and 6 stays `warn` on the deferred live-region finding alone.

## Out of scope

- `coding-mcp-live-region-mounts-with-text` — cross-section, its own spec.
- Any change to `resolveMcpServers` or the guardrail. The backend is correct; the client
  is what saves states the backend rejects.
- Making `maxMcpServers` required client-side. Tightening the schema is a defensible
  separate change, but this design handles the optional case rather than depending on it.
