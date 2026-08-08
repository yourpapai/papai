<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ReposSection close-out — design

Closes four of the five open `ReposSection` findings. This is sub-project 2 of the four that
drain `docs/ux-reviews/_BACKLOG.md`; see "Position in the wider backlog" at the end.

## Goal

Take `ReposSection` from 5 open findings to 1, moving the backlog from **18 open to 14 open**,
without adding a visual baseline. The audit floor stays at **467**.

## The four findings

| Id | Severity | Fix site | Pixel impact |
| --- | --- | --- | --- |
| `repos-no-heading-element` | Low | `:159`, `:292-297` | none intended — see risk below |
| `repos-status-not-announced-never-clears` | Low | `:124-125`, `:71`, `:98` | two baselines |
| `repos-load-error-no-recovery` | Low | `:124` | shares those two baselines |
| `repos-egress-silently-normalised` | Low | `:46-53`, add-form markup | one baseline |

Line numbers are in `client/settings/sections/ReposSection.svelte` and were verified against
the file at commit `78069137b`.

All four are *narrowed residuals*: an earlier review pass already closed the larger half of
each one. The `Where visible` and `Source` lines in `docs/ux-reviews/ReposSection.md` were
re-read against current source while writing this spec and are accurate — unlike the
ToolsSection clear-trigger finding, which SP1 found to be wrong.

## Architecture

The organising principle is **expected pixel impact**, carried over from SP1 because it worked
there: it is what caught a fix that was predicted to be pixel-neutral and was not.

`bun shoot` overwrites baselines, so a green audit *after* a re-shoot proves nothing. Task 1
holds the only fix that must not move a pixel and runs the audit **without re-shooting**, which
makes its green result a real oracle. Tasks 2 and 3 each change a small, named, falsifiable set
of baselines.

| Task | Fix | Baselines it may change |
| --- | --- | --- |
| 1 | `repos-no-heading-element` | **none** |
| 2 | `repos-status-not-announced-never-clears` + `repos-load-error-no-recovery` | `settings-sections-ReposSection-Error-1.png`, `ReposSection-—-added-success-status-1.png` |
| 3 | `repos-egress-silently-normalised` | `ReposSection-—-long-content-in-the-add-form-narrow-1.png` |
| 4 | documentation close-out | none |

Three of the section's fifteen baselines change. **None is added; none is orphaned.** The audit
floor stays 467.

Tasks 2 and 3 are separate because they are independently reviewable and touch disjoint regions
of the component — a reviewer could reject the feedback rework while approving the egress hint.
Task 1 is separate despite being a two-line change because its whole risk *is* pixel drift, and
only a task that does not re-shoot can prove the drift did not happen.

## Task 1 — heading semantics (`repos-no-heading-element`)

`:159` currently reads:

```svelte
<p class="settings-repos__add-label">Add repository</p>
```

It becomes an `<h3>` carrying the same class, so the add form is reachable by heading
navigation. The `PageHeader` half of this finding was already fixed — `PageHeader.svelte:25`
renders the section title as an `<h2>` — so an `<h3>` is the correct level here.

**Risk, and how it is handled.** `<h3>` has a user-agent default of `font-weight: bold` and a
larger `font-size`. `.settings-repos__add-label` (`:292-297`) already pins `font-size: 11px`,
`font-family: var(--font-mono)`, `color: var(--text-dim)` and `margin: 0`, but **not
`font-weight`**. Without an explicit weight this "semantics-only" change renders the label bold
and moves pixels in every story that shows the add form. The rule therefore gains an explicit
`font-weight`.

**That is what Task 1's audit tests.** It runs unfiltered and without re-shooting; the expected
result is **467 passed, 0 failed**. A failure means the weight pin is wrong or incomplete, and
must be reported and fixed — never re-shot. SP1's equivalent risk note is what caught a real
1px regression, so this one is load-bearing rather than ceremonial.

## Task 2 — feedback routed by origin

Two findings share one root cause and are fixed together, because fixing either alone would
leave the other's message in the wrong place.

Today the section renders one feedback pair at the very top (`:124-125`), above the repo rows.
Three unrelated sources write into it — the initial load, an add, and a delete — and `status` is
only ever cleared at the start of the next `handleAdd`/`handleDelete` (`:71`, `:98`), so a
success message persists indefinitely.

### Placement

The single pair is replaced by two slots:

- **List slot**, above the repo rows: load errors and delete outcomes. This is where the thing
  that failed or changed actually lives.
- **Add slot**, directly under the add form: add outcomes only.

The load error in the list slot gains an **inline `Retry` button beside the message**, which is
the entire residual of `repos-load-error-no-recovery` — its raw-string and unlabelled-glyph
halves are already fixed. The header's `⟳` `IconButton` (`:120`) stays: it is the idle refresh
affordance, not the error-recovery one, and removing it would regress the populated state.

Both slots keep the existing `role="alert"` (error) and `role="status"` (success) wiring, which
an earlier pass already added. This spec does not change announcement behaviour — only where
the messages sit and how long they last.

### Auto-clear

Success messages clear after a timeout. Errors do not — an error persists until the user
retries or succeeds.

The duration is a **new component prop, `statusTimeoutMs`, defaulting to `4000`**. The
Storybook story and the visual spec pass a very large value so no baseline can race the clock.

**Why a prop rather than a constant.** A hardcoded timer makes
`ReposSection-—-added-success-status-1.png` wall-clock-dependent: the screenshot either races
the timeout or must deliberately wait it out, and a future CI slowdown turns that into an
intermittent baseline failure that is painful to diagnose. Injecting the duration is the same
dependency-injection discipline the codebase already applies to fetchers elsewhere, and it
keeps the baseline deterministic by construction.

## Task 3 — visible egress normalisation (`repos-egress-silently-normalised`)

`parseEgress` (`:46-53`) lowercases, trims and dedupes; the form clears on success. A user who
types `PyPI.org, pypi.org ` therefore has two entries silently collapsed into one and never
sees it — the row only shows the truth after `load()` re-renders it.

A hint under the egress textarea shows the parsed result live, derived from the same
`parseEgress` the submit path uses:

```
Egress domains
┌────────────────────────┐
│ PyPI.org, pypi.org,    │
│ GitHub.com             │
└────────────────────────┘
Will save 2 domains: pypi.org, github.com
```

**It never mutates the field.** Rewriting the textarea on blur was considered and rejected: it
silently edits what someone typed, is surprising if they tab away mid-edit, and destroys their
line breaks and ordering every time. A read-only preview shows the same information without
fighting the user's cursor, and shows it *before* the decision is committed rather than after.

**It renders nothing when no hosts parse.** This is a deliberate baseline-scoping decision, not
only a cosmetic one: the `egress-textarea-focused` shot uses the `Empty` story with an empty
field, so an empty-state hint would change a baseline that otherwise stays byte-identical. Only
`ReposSection-—-long-content-in-the-add-form-narrow-1.png` — which fills egress with five hosts
— may change.

Singular and plural both need copy ("Will save: pypi.org" for one host).

## Task 4 — documentation close-out

Flip the four findings in `docs/ux-reviews/ReposSection.md` to `fixed`, each with a
`- **Resolved:**` line citing the real commit hash from Task 1, 2, or 3. Re-score the rubric
rows that were `warn` solely because of a finding now closed — and only those; a row whose
`warn` rationale also covers `repos-no-edit-capability` stays `warn`.

**Every `file:line` citation written into the `Resolved:` prose and the re-scored rubric rows
must be re-derived against the post-fix file.** SP1's Task 3 review found four citations that
had been copied from the findings' pre-fix `Source:` anchors and pointed at unrelated code. The
findings' own `Source:` lines are left untouched — they correctly record the pre-fix state.

Regenerate with `bun run ux:backlog`. Never hand-edit `_BACKLOG.md`.

Expected after regeneration: **14 open**, ReposSection **1 open / 15 fixed**, severity buckets
**High 0 / Med 3 / Low 11**. The section header still reads **18 section(s)** — that count is
`sorted.length` in `scripts/ux-backlog-lib.ts:178`, the number of review documents, and does not
drop when a section reaches zero open findings.

## Constraints

- Statuses are exactly `open`, `fixed`, `superseded`. There is no `partial`. A non-`open` status
  requires a `Resolved:` line with a real commit hash or the backlog parser fails loud.
- `client/shared/ui/` primitives are **not** modified by this sub-project. Every fix is local to
  `ReposSection.svelte`, its stylesheet block, its stories file, or its tests.
- No new visual baseline. The audit floor stays 467. Exactly three named baselines change.
- Do not edit a pre-existing test to make something pass.
- Never `--no-verify`; never a lint-disable or type-ignore comment.
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.
- Client tests run via `bun run test:client` only — `bunfig.toml:8` excludes `tests/client/**`,
  so `bun test tests/client/...` silently discovers nothing and reports success.

## Testing strategy

`ReposSection` is driven differently from `ToolsSection` and the plan must follow the local
pattern rather than SP1's. It imports `addRepo` / `deleteRepo` / `fetchRepos` as modules
(`:17`) instead of taking them as props, and its suite lives at
`tests/client/settings/repos-section.test.ts` (433 lines), driving the component through
`setMockFetch` at the network level. Its stories select fixtures via
`parameters={{ fixtures: '…' }}`, with `args` used only for `contextId` — so `statusTimeoutMs`
reaches a story through `args`.

| Change | Instrument |
| --- | --- |
| `<p>` → `<h3>` + `font-weight` pin | Task 1's zero-diff audit; client test asserting the tag name |
| feedback slot routing | client tests asserting which slot each outcome lands in |
| inline `Retry` | client test asserting it triggers a re-fetch |
| `statusTimeoutMs` auto-clear | client test with fake timers; errors asserted *not* to clear |
| egress preview | client tests for one host, multiple hosts, deduped input, and empty field |
| all three visible changes | the three named PNGs, read directly after re-shooting |

A green audit after a re-shoot is not evidence. Each of Tasks 2 and 3 must read its changed
PNGs and state what it actually saw.

## Position in the wider backlog

Sub-project 2 of four, sliced section-major so each project re-baselines one spec file at most:

| # | Scope | Findings | Status |
| --- | --- | --- | --- |
| SP1 | ToolsSection close-out | 5 | done — `ddb63df03`, `bb1aba29b`, `c9dfb3aa9`, `78069137b` |
| SP2 | ReposSection close-out (this spec) | 4 | this spec |
| SP3 | shared `settings.css` trio — `.placeholder`, `.status-error`, `.settings-form` | 3 | not started |
| SP4 | scattered singles — Byok, CodeHost, CodingCredentials, GuestMode, KaneoAccess, Members, Profile, AiOutput, ReleaseSubscription | 9 | not started |

Set aside, not scheduled here:

- `repos-no-edit-capability` — not a UI fix, and the reason this sub-project closes four
  findings rather than five. `src/debug/settings/coding-repos-routes.ts:69-81` exposes only
  `GET`/`POST`/`DELETE`; `PATCH`/`PUT` return 405. The store's `upsertRepo` can update, but the
  client fetcher never sends a `repoId`. Closing it needs an API-shape decision plus new
  per-row UI, so it belongs in its own feature spec.
- `debug-icon-buttons-control-height` — carved out by prior decision; stays `open` pending
  sign-off. Its own suggested fix says take no action.

SP3 still carries the real cross-section risk: those three classes have 29, 30+, and 11
consumers. Note that this sub-project touches two of them — `.status-error` and
`.status-success` are the classes Task 2 re-places. Task 2 must move *where the elements
render*, not edit the shared rules, or it will re-baseline half the settings UI and collide
with SP3.
