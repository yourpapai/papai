<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin resource/operation test-quality improvement — design

Date: 2026-07-25
Status: approved (design), pending implementation plan
Companion to: `2026-07-25-update-status-test-quality-design.md` (same stance, different file class)

## Problem

Three "highest-survival" files were nominated for assertion strengthening:

- `plugins/task-provider-kaneo/label-resource.ts`
- `src/tools/update-status.ts`
- `plugins/task-provider-youtrack/operations/agiles.ts`

Re-baselining against the paired runner (`bun test:mutate:file`, the repo's
accurate per-file measurement — see `scripts/mutation/README.md`) corrected the
picture and reshaped scope:

| File | Paired baseline | Status |
|---|---|---|
| `src/tools/update-status.ts` | 24 killed / 25 survived / 0 no-cov — **49.0%** | **Already done.** Commit `039a21b38` (today) landed its dedicated spec's acceptance tests; remaining 25 survivors are log-only/cosmetic (behavior-only ceiling). Out of scope here. |
| `plugins/task-provider-kaneo/label-resource.ts` | 46 / **53** / 3 — 102 total — **45.1%** | Target. |
| `plugins/task-provider-youtrack/operations/agiles.ts` | 156 / **110** / 18 — 284 total — **54.9%** | Target (the prize). |

The originally cited survivor counts (16/1, 18/6, 19) matched no current
measurement and are disregarded; the numbers above are the measured ground truth.

### Measurement blocker

The two plugin files are **not measurable by current tooling**: the companion
resolver (`.hooks/tdd/test-resolver.mjs` `findTestFile`) resolves only `src/`,
`client/`, `review-loop/src/`, and colocated tests — not `plugins/`. There are
no `scripts/mutation/overrides.json` entries for them, and `plugins/` is outside
the `stryker.config.json` `mutate` scope. `bun test:mutate:file` therefore
**skips** both. The baselines above were captured with a temporary override
since reverted; a permanent unblock is part of this design.

## Survivor analysis

### `agiles.ts` — `parseSprintTimestamp` is the dominant cluster

| Cluster | Region | # | Why they survive | Killable? |
|---|---|---|---|---|
| **A1 — leap year** | L30 (`isLeapYear`) | 12 surv + 3 no-cov | Never exercised through Feb 29; the `%4`/`%100`/`%400` branches and `||`/`&&` composition untested | **Yes** |
| **A2 — calendar bounds** | L76-83 (`isValidCalendarDate`/`isValidTimezoneOffset`) | ~18 | Boundary values (month 12/13, day 31/32, hour 23/24, min 59/60, sec 59/60) never passed; `<= → <` mutants survive | **Yes** |
| **A3 — timezone offset** | L89 + L91 | 3 surv + 9 no-cov | No test passes a timezone-bearing timestamp; offset sign/arithmetic and `Date.UTC` subtraction entirely uncovered | **Yes** |
| **A4 — omitted groups** | L70-73 | ~9 | Tests use fully-specified `…T00:00:00.000Z`; the `secondText === undefined ? 0` / `millisecondText === undefined ? 0` / `padEnd(3,'0')` paths untested | **Yes** |
| **A5 — regex anchors/format** | L28 | 9 | Anchors `^`/`$` and separators only proven on matching input | **Yes** |
| **A6 — body-building** | L138-142, L174-189 | ~12 | Mostly `if(params.x!==undefined)→if(true)` mutants that are **JSON-equivalent** (`body[x]=undefined` is dropped by `JSON.stringify`, unobservable at the wire); `::false` variants already killed by the existing all-fields test | No (equivalent) — except **one** real gap: `updateSprint` `previousSprintId` as a non-null string (L186 no-cov) |
| **A7 — log/cosmetic** | L21, L95-243 | ~50 | Log payloads, error-message text, module-load `logger.child({ scope })` | No (log-only/cosmetic) |
| **A8 — null-match backstop** | L48-49 | 3 | `match === null` throw is shadowed by the downstream calendar-validation backstop (non-matching strings throw either way) | No (dead-equivalent, same shape as update-status's refine-backstop) |

`parseSprintTimestamp` / `isLeapYear` / `getDaysInMonth` are module-private,
reachable only via `createYouTrackSprint` / `updateYouTrackSprint`. They are
tested **indirectly** by driving those public functions and asserting either the
exact parsed epoch (`getFetchBodyAt(fetchMock.current, 0).start/.finish`) or
rejection (`YouTrackClassifiedError` + zero fetch calls). The existing
`agiles.test.ts` harness already supports both.

### `label-resource.ts` — HTTP method/path contract

The file already asserts URL + method + body for `listForTask`, `addToTask`, and
`removeFromTask`. The four remaining methods assert the body and/or result but
**not** the method or path:

| Cluster | Region | # | Why they survive | Killable? |
|---|---|---|---|---|
| **B1 — method/path** | L32-33 (create), L56-57 (list), L102/115 (update), L134/148 (remove) | ~8-10 | The Kaneo mock returns canned responses regardless of URL; only an explicit URL+method assertion observes a method/path mutant | **Yes** |
| **B2 — log/cosmetic** | L18, L27-182 | ~40 | Log payloads + `instanceof Error ? … : String(error)` ternaries + module-load `logger.child({ scope })` | No |
| **B3 — error message** | L143-144 | 2 | `KaneoClassifiedError` message text (the throw itself is tested) | No |

## Approaches considered

| | Approach | Killable mutants | Score (est.) | Trade-off |
|---|---|---|---|---|
| **A** | **Behavior-only, both files** | ~45 agiles + ~8 label-resource | agiles ~68-72%, label-resource ~52-55% | Additive, robust, consistent with each file's existing assertions. Caps at behavior-observable mutants. |
| **B** | **A + log-assertion pass** | A + ~80 log mutants | ~85-90% | Delayed-import + tracked-logger + exact log-string assertions; brittle, against the repo's "mutation as quality signal, not maximization" stance (the same reasoning that capped update-status). |
| **C** | **agiles-only** | ~45 | agiles ~68-72% only | Most focused; leaves label-resource's cheap method/path wins on the table. |

## Accepted approach: A — behavior-only

It captures every genuinely behavior-testable survivor in both files with cheap,
robust, additive tests that match patterns already present in each file. The
remaining survivors are log-only, cosmetic, or JSON/validation-equivalent —
killing them would couple tests to exact log/message strings or fight
tautological mutants, against the repo stance. `update-status.ts` stays untouched
at its behavior-only ceiling.

## Changes

### 1. Unblock measurement — `scripts/mutation/overrides.json` (committed, ~2 lines)

```jsonc
"plugins/task-provider-kaneo/label-resource.ts": ["tests/plugins/task-provider-kaneo/label-resource.test.ts"],
"plugins/task-provider-youtrack/operations/agiles.ts": ["tests/plugins/task-provider-youtrack/operations/agiles.test.ts"]
```

This is the documented mechanism for files whose coverage does not resolve via
the companion resolver. Generalizing `findTestFile` to handle all `plugins/` is a
reasonable **deferred** option (broader scope; `findTestFile` is consumed only by
the mutation scripts, not by the TDD write-hook's gating, so it is safe — but out
of scope here).

### 2. `tests/plugins/task-provider-youtrack/operations/agiles.test.ts` — new `describe`, ~12 tests

Drive `createYouTrackSprint` (and one `updateYouTrackSprint` case); assert via
`getFetchBodyAt`/`getFetchMethodAt`/`getFetchUrlAt` and `fetchMock.current?.mock.calls.length`.

- **Leap year (A1):** Feb 29 accepted for `2024` (%4) and `2000` (%400); rejected for `2023` (common) and `1900` (%100 rule). Assert epoch / `YouTrackClassifiedError` + zero calls.
- **Calendar bounds (A2):** month `12` valid / `13` invalid; day `31`-Jan valid / `32` invalid / `30`-Apr valid (30-day month); hour `23` / `24`; minute `59` / `60`; second `59` / `60`.
- **Omitted groups (A4):** no seconds (`…T00:00Z`), no milliseconds (`…T00:00:00Z`); 1-digit millisecond (`.5Z` → exact epoch, kills the `padEnd(3,'0')` fill-char mutant).
- **Timezone offsets (A3):** `+03:00` / `-05:00` → assert **exact** epoch (offset subtracted); invalid `+24:00`, `+00:60` → reject.
- **Regex anchors/format (A5):** prefixed garbage `x2024-01-15T00:00:00Z` and trailing garbage `…Zx` → reject (kills `^`/`$`); space-for-`T` → reject.
- **updateSprint previousSprintId non-null (A6 gap):** `previousSprintId: 'sprint-9'` → assert `body.previousSprint === { id: 'sprint-9' }` (covers L186 else-branch no-cov).

### 3. `tests/plugins/task-provider-kaneo/label-resource.test.ts` — ~4 additive tests

Mirror the existing `requests[]` URL+method capture pattern used by
`listForTask`/`addToTask`/`removeFromTask`:

- `create` → `POST` to `/api/label`
- `list` → `GET` to `/api/label/workspace/:id`
- `update` → `GET /api/label/:id` then `PUT /api/label/:id`
- `remove` → `GET /api/label/:id` then `DELETE /api/label/:id`

### Spec-mandated comment

One comment block at the top of each new test group records that
log-payload / message-string / JSON-equivalent / backstop survivors are
intentionally accepted, with a pointer to this spec — so a future higher score
bar knows it means moving to Option B.

## Accepted survivors (documented, not killed)

- **agiles A7 / label-resource B2** — log payloads incl. the `instanceof Error ? … : String(error)` ternaries; module-load `logger.child({ scope })`.
- **agiles A6** — `if (params.x !== undefined) → if (true)` body-building mutants (JSON-equivalent: `undefined` is dropped by `JSON.stringify`, unobservable at the wire).
- **agiles A8** — `match === null` throw (calendar-validation backstop catches non-matching strings regardless).
- **label-resource B3** — `KaneoClassifiedError` message text (the throw is already tested).

## Error handling

- If a boundary test unexpectedly throws (or fails to), the calendar logic is
  stricter or looser than documented — **fix the test data, do not weaken the
  validation**.
- If `bun test:mutate:file` reports materially fewer newly-killed mutants than
  estimated (~45 agiles, ~8 label-resource), a mutant category was mis-assumed —
  re-read the survivor diff and extend the boundary tests before declaring done.
- The unblock entries must exactly match the source paths used by the paired
  runner; a typo silently re-introduces a skip.

## Testing / verification

- `bun test tests/plugins/task-provider-youtrack/operations/agiles.test.ts` — green (existing + new).
- `bun test tests/plugins/task-provider-kaneo/label-resource.test.ts` — green (existing + new).
- `bun run lint`, `bun run typecheck` — green (test-only source changes + one JSON line each).
- `bun test:mutate:file plugins/task-provider-kaneo/label-resource.ts plugins/task-provider-youtrack/operations/agiles.ts` — no longer skipped; agiles ~68-72%, label-resource ~52-55%; survivors/no-cov drop by the estimated counts.
- `bun test:mutate:file src/tools/update-status.ts` — unchanged at ~49% (regression guard; no source/test change to it).

## Out of scope

- Any change to `src/tools/update-status.ts` or its tests.
- Log-payload assertions (Option B), description/message-string assertions.
- Generalizing `findTestFile` for all `plugins/` (deferred — tracked above).
- Source changes to `agiles.ts` / `label-resource.ts` (e.g. exporting
  `parseSprintTimestamp` for direct unit testing) — tests reach the logic via the
  public sprint functions, matching the no-source-change stance.
