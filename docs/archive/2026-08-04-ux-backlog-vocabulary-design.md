<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX backlog vocabulary and decision-closes — design

**Sub-project:** SP4. Scope-mate: SP5 (the nine remaining UI fixes), specified separately.

## Problem

`docs/ux-reviews/_BACKLOG.md` exists to answer one question: what UX work is left. Eleven
findings are open. Nine are actionable UI defects. Two are not:

- `debug-icon-buttons-control-height` — its own text says *"No action needed in DebugApp"*.
  24px meets WCAG 2.5.8 (Target Size Minimum)'s 24×24px floor, so this is not an accessibility
  failure. It was recorded as a shared design-token fact. Its only real fix is raising
  `--control-h-sm` in `client/shared/tokens.css`, which changes every consumer at once.
- `repos-no-edit-capability` — `client/settings/repos-fetchers.ts:16-34` exposes only
  `addRepo`/`deleteRepo`. Per-row editing of branch/preset/egress needs backend update support.
  The discoverability half of the finding is already closed by the explicit note in
  `ReposSection.svelte:193-196`; the residue is a capability gap, not a UX defect.

Neither can be honestly closed with today's vocabulary. `scripts/ux-backlog-lib.ts:7` allows
`open`, `fixed`, `superseded`. As established across the three existing uses (all in
`ByokSection.md`), `superseded` means *a commit removed the thing the finding described*, and
every one cites a real hash. None of that is true here: the button still renders at 24px and
the repo edit gap still exists. Reusing `superseded` would corrupt a term that currently
carries precise meaning, and neither finding has a commit to cite.

Leaving them `open` is the other failure mode: the counter never reaches zero, and every
future reader re-litigates the same two decisions.

## Vocabulary

Two statuses join the existing three:

- **`wont-fix`** — examined, and no change is warranted. Either the finding's premise was
  wrong, or the current behaviour is accepted as-is.
- **`deferred`** — a real gap, acknowledged, blocked on work outside this project's scope.

The distinction is load-bearing. `wont-fix` means there is no work left. `deferred` means
there is, but not here. Collapsing them would either hide real work or overstate it.

The existing rule at `scripts/ux-backlog-lib.ts:90-93` — any non-`open` status requires a
non-empty `- **Resolved:**` line — is unchanged and extends to both new statuses. `Resolved:`
is read as *how this finding reached a terminal state*, not strictly *a commit fixed it*.
Keeping the one field avoids renaming it across the 157 existing `fixed` entries for a purely
cosmetic gain.

Unlike `fixed` and `superseded`, a `wont-fix` or `deferred` `Resolved:` line **does not**
require a commit hash. The parser has never enforced hashes — it checks only for non-emptiness
— so this is a documented convention, not a code change. These two entries carry a rationale
instead.

## Generator changes

`scripts/ux-backlog-lib.ts` currently hardcodes three status columns in four places that must
agree: the header row, the separator row, each section row's `counts` array (`:166`), and the
total row (`:185`). Adding two statuses means four coordinated edits, and a mismatched column
count produces a silently malformed table.

The table is therefore derived from the `STATUSES` tuple plus a display-label map, so header,
separator, per-section rows and the total row cannot drift apart. This is the one structural
change; the rest is additive.

Display labels: `open` → "Open", `fixed` → "Fixed", `superseded` → "Superseded",
`wont-fix` → "Won't fix", `deferred` → "Deferred". Column order follows the `STATUSES` tuple
order, with `Last reviewed` remaining the final column.

### Deferred findings stay visible

A `deferred` finding is real work that still needs doing. If it appears only as a column count
it effectively disappears, which defeats the document's purpose. The generator gains a
`## Deferred` section after `## Open findings`, listing those findings in the same
one-line-per-finding format used for open ones (`` `id` — **Section** — Title — `anchor` ``),
sorted the same way. When there are none, the section renders `_None._`, matching how empty
severity buckets already behave.

`wont-fix` findings get no such list. They are genuinely closed, and the per-section table
count plus the finding's own document entry are sufficient record.

The header sentence (`N open finding(s) across M section(s)`) is unchanged, and continues to
count only `open`. The `## Open findings` severity buckets are likewise unchanged — they list
only `open` findings.

## The two closures

| Finding | Document | Status | Recorded rationale |
| --- | --- | --- | --- |
| `debug-icon-buttons-control-height` | `DebugApp.md` | `wont-fix` | 24px meets WCAG 2.5.8's 24×24px floor, so this is not a defect. The finding's own text directs that no action be taken in `DebugApp`, and that any change belongs in `--control-h-sm` (`client/shared/tokens.css:63`) where it would affect every consumer and require re-reviewing the affected sections. |
| `repos-no-edit-capability` | `ReposSection.md` | `deferred` | `repos-fetchers.ts` exposes only add/delete; per-row editing needs backend update support that does not exist. The surprise-discovery half is already closed by the note at `ReposSection.svelte:193-196`. Deferred rather than won't-fix because the capability may genuinely be built later. |

Each finding's existing `- **Source:**` line is left untouched — those record the pre-decision
state and remain accurate.

Neither closure changes any file under `client/` or `src/`.

## Documentation

`docs/ux-reviews/_TEMPLATE.md:40-44` lists the permitted statuses. It gains a bullet for each
new status, stating the meaning and the `Resolved:` requirement, and noting that `wont-fix` and
`deferred` carry a rationale rather than a commit hash.

## Verification

- `tests/scripts/ux-backlog.test.ts` currently reports 21 cases and must report more
  afterwards. Two are `test.each(['fixed', 'superseded'])` at `:69` and `:74`; extending those
  arrays to cover the new statuses adds four cases without rewriting any assertion.

  Exactly two pre-existing cases legitimately change, and no others:

  - `:139` asserts the literal row `| MembersSection | 0 | 1 | 0 | 2026-07-03 |`. The table
    gains two columns, so this becomes `| MembersSection | 0 | 1 | 0 | 0 | 0 | 2026-07-03 |`.
    The assertion is not weakened — it still pins an exact row.
  - `:64` is titled *"throws on a Status outside the three values"*, which becomes false when
    there are five. The title is corrected; its assertion (that `partial` is rejected) stands
    unchanged, because `partial` remains invalid.

  Any other pre-existing case altered, any assertion loosened, or a total below 21 means
  something regressed.
- A new test asserts the summary table header contains a column for every member of `STATUSES`,
  so the derive-from-tuple property is enforced rather than merely intended.
- A new test asserts a `deferred` finding appears in the `## Deferred` section and a `wont-fix`
  finding does not appear in any list.
- `bun run ux:backlog` regenerates `_BACKLOG.md` to **9 open across 18 sections**, severity
  buckets **High 0 / Med 2 / Low 7**, with `DebugApp` showing 1 won't-fix, `ReposSection`
  showing 1 deferred, and a `## Deferred` section containing exactly `repos-no-edit-capability`.
  The section count stays 18: it is `sorted.length`, the number of review documents, and does
  not drop when a section reaches zero open findings.
- Re-running `bun run ux:backlog` after committing must reproduce the committed file
  byte-for-byte, proving no hand-edit. `_BACKLOG.md` is generated; hand-editing it would hide a
  real parsing problem.
- No `client/` file changes, so no Storybook baseline can move. `bun run visual:audit` must
  remain at its current floor of 467 passed / 0 failed. Run it before concluding, not after any
  `bun shoot` — `bun shoot` rewrites baselines and makes a subsequent audit pass by
  construction.

## Out of scope

- The nine actionable UI fixes and their close-out documentation — SP5.
- Any change to `--control-h-sm` or to `Btn.svelte`. Raising the shared control height is a
  separate decision requiring an app-wide re-review, and is explicitly not taken here.
- Building repository update support in `repos-fetchers.ts` or the backend.
- Renaming the `Resolved:` field, or adding a distinct rationale field.
