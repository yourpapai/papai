<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ToolsSection close-out — design

Closes all five open `ToolsSection` findings in one pass. This is sub-project 1 of four that
drain `docs/ux-reviews/_BACKLOG.md`; see "Position in the wider backlog" at the end.

## Goal

Take `ToolsSection` from 5 open findings to 0, moving the backlog from **23 open to 18 open**,
without adding a visual baseline. The audit floor stays at **467**.

## The five findings

| Id | Severity | Fix site | Pixel impact |
| --- | --- | --- | --- |
| `tools-race-permission-during-preset` | Med | `:313`, `:328-334`, `:343-348` | none |
| `tools-dual-confirm-bars-overlap` | Low | `:260` | none (in existing stories) |
| `tools-preset-checkmark-not-decorative` | Low | `:230` | none intended — see risk below |
| `tools-clear-row-spacing-off-scale` | Low | `:455`, `:472` | none (`--s3` *is* `12px`) |
| `tools-clear-trigger-looks-like-text` | Low | `:263` | **one baseline** |

All line numbers are in `client/settings/sections/ToolsSection.svelte` and were verified against
the file at commit `d24ff6b11`.

## Architecture

The organising principle is **expected pixel impact**, not finding order or severity.

Four of the five fixes cannot move a pixel. Grouping those into one task lets that task run the
visual audit *without re-shooting anything*, so the audit becomes a real oracle: any diff at all
is a defect. The fifth fix is the only one permitted to change a baseline, and it changes exactly
one, which makes its expectation falsifiable too.

This directly counters the failure mode that shadowed the previous sub-project: `bun shoot`
overwrites baselines, so a green audit *after* a re-shoot proves nothing. Task 1 never re-shoots,
so its green audit means something.

## Task 1 — the four pixel-preserving fixes

### 1a. Preset race (`tools-race-permission-during-preset`)

`applying` and `clearing` already exist as `$state` at `:74-75`. The confirm-bar buttons already
gate on them (`:226`, `:244`, `:252`, `:265`, `:280`, `:288`). Three leaf controls do not:

- `:313` — domain toggle `Btn`
- `:328-334` — group toggle `Btn`
- `:343-348` — per-tool `SegmentedControl`

Each gains `disabled={applying || clearing}`. No new state is introduced.

**Decision — no busy caption.** `Btn` and `SegmentedControl` both accept `busy`, and the confirm
bar uses it. The leaf controls get `disabled` only. The confirm bar already announces the
in-flight operation centrally; repeating "Saving…" across every tool row would be up to 30
simultaneous captions for one operation.

### 1b. Dual confirmation surfaces (`tools-dual-confirm-bars-overlap`)

`:260` currently reads:

```svelte
{#if clearPresetFn !== undefined && storedDefaults && !pendingClear}
```

It gains `&& pendingPreset === null`. While a preset confirmation is open, the clear-defaults
trigger hides.

**Direction of exclusion.** The clear trigger yields to the preset bar, not the reverse. The user
has just expressed preset intent, so that is the live conversation; the clear trigger returns the
moment they cancel. This also completes a symmetry the code already half-implements — the clear
trigger's own `onClick` at `:267` already sets `pendingPreset = null`, so the two surfaces are
mutually exclusive in one direction today. This change supplies the other direction.

### 1c. Decorative checkmark (`tools-preset-checkmark-not-decorative`)

`:230` currently reads:

```svelte
{#snippet children()}{active ? '✓ ' : ''}{preset.label}{/snippet}
```

The glyph is wrapped so screen readers hear only the `aria-pressed` state wired at `:227`:

```svelte
{#snippet children()}{#if active}<span aria-hidden="true">✓ </span>{/if}{preset.label}{/snippet}
```

**Risk, and how it is handled.** This is the one "pixel-preserving" change that touches rendering
rather than only attributes, and it lands in the `Preset applied` story — the same story Task 2
re-baselines. An inline `<span>` carrying identical text should render identically, but if it does
not, Task 1's audit will fail on `settings-sections-ToolsSection-Preset-applied-1.png`.

**That failure must be reported, not re-shot.** If the wrapper moves pixels, the audit has done
its job and the finding is that the fix is not pixel-neutral. Re-shooting to make it green would
destroy exactly the evidence this task is structured to produce.

### 1d. Spacing tokens (`tools-clear-row-spacing-off-scale`)

`:455` (`.settings-tools__presets-hint { margin: 0 0 12px; }`) and `:472`
(`.settings-tools__clear-row { margin-bottom: 12px; }`) each swap the bare `12px` for `var(--s3)`.
`--s3` is defined as `12px` (`client/shared/tokens.css:70`), so this is a tokenisation-consistency
change with no visual delta.

### Verification

Client tests extend the existing `tests/client/settings/sections/ToolsSection.test.ts` (503 lines,
established suite). They assert:

1. the domain toggle, group toggle, and per-tool `SegmentedControl` are disabled while a preset
   apply is in flight, and enabled once it resolves;
2. the same for a clear-defaults operation;
3. the clear trigger is absent while `pendingPreset` is set, and present again after cancel;
4. the checkmark glyph is inside an `aria-hidden="true"` element when a preset is active.

Run with `bun run test:client` — **not** `bun test <path>`, which silently discovers nothing
because `bunfig.toml:8` excludes `tests/client/**`.

Then run `bun run visual:audit` **unfiltered and without re-shooting**. Expected: **467 passed,
0 failed**.

## Task 2 — the one visible fix

`tools-clear-trigger-looks-like-text`: `:263` changes `variant="ghost"` to `variant="outline"`.
`ghost` renders transparent background *and* transparent border, so the trigger reads as plain
text.

The two remaining `ghost` buttons at `:250` and `:286` are the confirm-bar Cancels. They stay
`ghost` by design and are out of scope.

### Baseline expectation

Only the `Preset applied` story sets `hasStoredDefaults: true`
(`ToolsSection.stories.svelte:135`), and the clear trigger renders only when stored defaults
exist. Therefore:

- **Exactly one baseline may change:** `settings-sections-ToolsSection-Preset-applied-1.png`.
- The other nine `ToolsSection` baselines must be byte-identical.

Re-shoot scoped (`bun shoot -g ToolsSection`), then **read the changed PNG** and confirm the
trigger gained a visible border and nothing else moved. A green audit after a re-shoot is not
evidence; the image is.

## Task 3 — documentation close-out

Flip all five findings in `docs/ux-reviews/ToolsSection.md` to `fixed`, each with a
`- **Resolved:**` line citing the real commit hash from Task 1 or Task 2. Re-score the rubric rows
that were `warn` solely because of a finding now closed — and only those; a row whose `warn`
rationale covered a second, still-open problem stays `warn`.

Regenerate with `bun run ux:backlog`. Never hand-edit `_BACKLOG.md`.

Expected after regeneration: **18 open** (from 23), ToolsSection **0 open / 14 fixed**, severity
buckets **High 0 / Med 3 / Low 15**.

## Constraints

- Statuses are exactly `open`, `fixed`, `superseded`. There is no `partial`. A non-`open` status
  requires a `Resolved:` line with a real commit hash or the backlog parser fails loud.
- `client/shared/ui/` primitives are **not** modified by this sub-project. Every fix is local to
  `ToolsSection.svelte` or its stylesheet block.
- No new visual baseline. The audit floor stays 467.
- Do not edit a pre-existing test to make something pass.
- Never `--no-verify`; never a lint-disable or type-ignore comment.
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.

## Testing strategy

| Change | Instrument |
| --- | --- |
| three `disabled` bindings | client test, in-flight promise held open |
| clear-row guard | client test, presence/absence assertion |
| `aria-hidden` wrapper | client test, plus Task 1's zero-diff audit |
| `12px` → `var(--s3)` | Task 1's zero-diff audit |
| `ghost` → `outline` | Task 2's single changed PNG, read directly |

## Position in the wider backlog

Sub-project 1 of four, sliced section-major so each project re-baselines one spec file at most:

| # | Scope | Findings |
| --- | --- | --- |
| SP1 | ToolsSection close-out (this spec) | 5 |
| SP2 | ReposSection close-out | 4 |
| SP3 | shared `settings.css` trio — `.placeholder`, `.status-error`, `.settings-form` | 3 |
| SP4 | scattered singles — Byok, CodingCredentials, GuestMode, KaneoAccess, Members, Profile, AiOutput | 9 |

Set aside, not scheduled here:

- `repos-no-edit-capability` — not a UI fix. `src/debug/settings/coding-repos-routes.ts:69-81`
  exposes only `GET`/`POST`/`DELETE`; `PATCH`/`PUT` return 405. The store's `upsertRepo` can
  update, but the client fetcher never sends a `repoId`. Closing this needs an API-shape decision
  plus new UI, so it belongs in its own feature spec.
- `debug-icon-buttons-control-height` — carved out by prior decision; stays `open` pending
  sign-off. Its own suggested fix says take no action.

SP3 carries the real cross-section risk: those three classes have 29, 30+, and 11 consumers. The
fix must add a local or new rule rather than edit the shared class, or half the settings UI needs
re-baselining.
