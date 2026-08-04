<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX backlog vocabulary and decision-closes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `docs/ux-reviews/_BACKLOG.md` the vocabulary to close a finding by decision rather than by commit, then close the two findings that are not UI defects, so the open count means "UI work still to do".

**Architecture:** Two statuses (`wont-fix`, `deferred`) join the `STATUSES` tuple in `scripts/ux-backlog-lib.ts`. The summary table, which currently hardcodes three status columns in four places that must agree, is derived from that tuple plus a display-label map so it cannot drift. `deferred` findings get their own `## Deferred` list so acknowledged-but-blocked work stays visible; `wont-fix` findings get only a column count. Then two review documents change status and the backlog is regenerated.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Bun test runner (`bun:test`), markdown.

**Spec:** `docs/superpowers/specs/2026-08-04-ux-backlog-vocabulary-design.md`

## Global Constraints

- **No file under `client/` or `src/` may change.** This sub-project touches `scripts/`, `tests/scripts/`, and `docs/ux-reviews/` only. Because no `client/` file changes, no Storybook baseline can move.
- **Never run `bun shoot`.** It rewrites visual baselines and would make a subsequent audit pass by construction. `bun run visual:audit` is non-mutating and is the only visual command this sub-project may run.
- **Never add a lint-disable or type-ignore comment**, and never pass `--no-verify` to `git commit`. Fix the underlying issue instead. The pre-commit hook runs lint / typecheck / format:check / license-headers.
- **Formatter is `oxfmt`**, invoked as `bun run format`. Not prettier.
- **Import paths use the `.js` extension** even for TypeScript sources.
- **`docs/ux-reviews/_BACKLOG.md` is generated.** Never hand-edit it. Regenerate with `bun run ux:backlog`. Hand-editing hides real parsing problems.
- **Status vocabulary, exact strings:** `open`, `fixed`, `superseded`, `wont-fix`, `deferred`. Hyphen, lowercase, no underscore.
- **Display labels, exact strings:** `Open`, `Fixed`, `Superseded`, `Won't fix`, `Deferred`. Note the typographic apostrophe `’` is **not** used — the label is ASCII `Won't fix`.
- **Column order** follows the `STATUSES` tuple order, with `Section` first and `Last reviewed` last.
- **Test-suite floor:** `tests/scripts/ux-backlog.test.ts` currently reports **21 pass / 0 fail**. It must report more than 21 when this sub-project ends. Exactly two pre-existing cases legitimately change (named in Tasks 1 and 2); no other pre-existing case may be altered and no assertion may be loosened.
- **`_BACKLOG.md` section count stays 18** throughout. It is `sorted.length` — the number of review documents — and does not drop when a section reaches zero open findings.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `scripts/ux-backlog-lib.ts` | Modify | Parse review docs, validate statuses, render the backlog. All four tasks' code changes land here. |
| `tests/scripts/ux-backlog.test.ts` | Modify | The only test file. Grows by at least six cases across Tasks 1–3. |
| `docs/ux-reviews/_TEMPLATE.md` | Modify (Task 4) | Documents the permitted statuses for humans writing new review docs. |
| `docs/ux-reviews/DebugApp.md` | Modify (Task 4) | One finding moves `open` → `wont-fix`. |
| `docs/ux-reviews/ReposSection.md` | Modify (Task 4) | One finding moves `open` → `deferred`. |
| `docs/ux-reviews/_BACKLOG.md` | Regenerate (Tasks 2, 3, 4) | Generated output. Never hand-edited. |

No new files.

---

### Task 1: Extend the status vocabulary in the parser

**Files:**

- Modify: `scripts/ux-backlog-lib.ts` (the `STATUSES` tuple near `:7`; the status error message near `:87`)
- Test: `tests/scripts/ux-backlog.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `FindingStatus` widens from `'open' | 'fixed' | 'superseded'` to include `'wont-fix' | 'deferred'`. `STATUSES` becomes a 5-tuple. Tasks 2 and 3 rely on both.

**Context:** `scripts/ux-backlog-lib.ts` derives `FindingStatus` from the `STATUSES` tuple and validates parsed statuses with `isStatus`, so adding two members to the tuple is the whole type-level change. The rendering side still hardcodes three columns after this task; that is Task 2's job, and leaving it hardcoded here means this task cannot change `_BACKLOG.md`'s bytes.

- [ ] **Step 1: Write the failing tests**

Three edits to `tests/scripts/ux-backlog.test.ts`.

**(a)** The case at roughly `:64` is currently titled `'throws on a Status outside the three values'`. There are about to be five, so the title becomes false. Rename it — **the assertion body does not change**, because `partial` remains an invalid status:

```typescript
  test('throws on a Status outside the permitted values', () => {
    const bad = withStatus('partial')
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(/Status/u)
  })
```

This is the first of exactly two sanctioned changes to a pre-existing case. It is a title correction, not a weakening.

**(b)** Extend both `test.each` arrays (roughly `:69` and `:74`) from two statuses to four. Do not otherwise touch these cases:

```typescript
  test.each(['fixed', 'superseded', 'wont-fix', 'deferred'])('throws when %s carries no Resolved line', (status) => {
```

```typescript
  test.each(['fixed', 'superseded', 'wont-fix', 'deferred'])('accepts %s when a Resolved line is present', (status) => {
```

**(c)** Add one new case, immediately after the block above, asserting the error message names every permitted status rather than a stale hardcoded three:

```typescript
  test('the invalid-status error names every permitted status', () => {
    const bad = withStatus('partial')
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(
      /must be one of open, fixed, superseded, wont-fix, deferred/u,
    )
  })
```

Keep this free of `try`/`catch` and of ternaries: the suite's lint config includes
`vitest/no-conditional-in-test`, which a conditional expression inside a test body trips. The
regex literal needs the `u` flag or `eslint/require-unicode-regexp` fails the commit hook.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: FAIL. The two `test.each` blocks fail for `wont-fix` and `deferred` — the "accepts" variants throw `Status must be one of open, fixed, superseded (got "wont-fix")`, and the "throws when … carries no Resolved line" variants throw that same message instead of the expected Resolved-line message. The new error-message case fails because the thrown message stops at `superseded`.

- [ ] **Step 3: Write the minimal implementation**

In `scripts/ux-backlog-lib.ts`, extend the tuple:

```typescript
const STATUSES = ['open', 'fixed', 'superseded', 'wont-fix', 'deferred'] as const
```

Then replace the hardcoded status list in the error message so it can never go stale. The current line reads:

```typescript
    throw new Error(`${where}: Status must be one of open, fixed, superseded (got "${status ?? ''}")`)
```

Replace it with:

```typescript
    throw new Error(`${where}: Status must be one of ${STATUSES.join(', ')} (got "${status ?? ''}")`)
```

Change nothing else. In particular, leave the non-`open`-requires-`Resolved` check exactly as it is — it already reads `status !== 'open'`, which covers the two new statuses without modification.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS, **26 pass / 0 fail** (21 existing + 4 from the extended `test.each` arrays + 1 new case).

- [ ] **Step 5: Verify the generated backlog is byte-identical**

This task changes parsing only, not rendering, so `_BACKLOG.md` must not move:

```bash
bun run ux:backlog && git diff --stat docs/ux-reviews/_BACKLOG.md
```

Expected: empty output from `git diff --stat` — no change to the file.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add scripts/ux-backlog-lib.ts tests/scripts/ux-backlog.test.ts
git commit -m "feat(ux-backlog): add wont-fix and deferred statuses"
```

---

### Task 2: Derive the summary table from the status tuple

**Files:**

- Modify: `scripts/ux-backlog-lib.ts` (`renderBacklog`, roughly `:159-190`)
- Modify: `docs/ux-reviews/_BACKLOG.md` (regenerated, not hand-edited)
- Test: `tests/scripts/ux-backlog.test.ts`

**Interfaces:**

- Consumes: the 5-member `STATUSES` tuple and widened `FindingStatus` from Task 1.
- Produces: a module-level `STATUS_LABELS: Record<FindingStatus, string>` map. Nothing later depends on it, but Task 3 must not duplicate it.

**Context:** `renderBacklog` hardcodes three status columns in four places that must agree: the header row, the separator row, each section row's `counts` array, and the total row. A mismatched column count produces a silently malformed markdown table. Deriving all four from `STATUSES` makes drift impossible.

The header sentence (`N open finding(s) across M section(s)`) and the `## Open findings` severity buckets are **unchanged** — they continue to count and list only `open` findings.

- [ ] **Step 1: Write the failing tests**

Two edits to `tests/scripts/ux-backlog.test.ts`.

**(a)** The case titled `'counts closed findings without listing them'` (roughly `:126-140`) asserts a literal table row with exactly three status columns. The table now has five, so the row gains two `0` columns. This is the second and last sanctioned change to a pre-existing case — the assertion still pins an exact row, so it is not weakened:

```typescript
    expect(out).toContain('| MembersSection | 0 | 1 | 0 | 0 | 0 | 2026-07-03 |')
```

**(b)** Add a new case that enforces the derive-from-tuple property rather than merely re-asserting today's labels. Place it near the other `renderBacklog` cases:

```typescript
  test('the summary header carries a column for every status', () => {
    const out = renderBacklog([], 2026)
    const header = out.split('\n').find((line) => line.startsWith('| Section |'))
    expect(header).toBeDefined()
    const cells = header!.split('|').map((cell) => cell.trim())
    expect(cells).toEqual(['', 'Section', 'Open', 'Fixed', 'Superseded', "Won't fix", 'Deferred', 'Last reviewed', ''])
  })
```

Note the double-quoted `"Won't fix"` — a single-quoted string would need escaping and oxfmt will not rewrite it for you.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: FAIL, 2 failures. The MembersSection row assertion fails because the rendered row still has three status columns. The header case fails because `cells` is `['', 'Section', 'Open', 'Fixed', 'Superseded', 'Last reviewed', '']`.

- [ ] **Step 3: Write the minimal implementation**

In `scripts/ux-backlog-lib.ts`, add the label map next to the other module-level constants (immediately after the `FindingStatus` type alias, so the `Record` key type is already in scope):

```typescript
/** Column headings for the roll-up table, one per member of `STATUSES`, in tuple order. */
const STATUS_LABELS: Record<FindingStatus, string> = {
  open: 'Open',
  fixed: 'Fixed',
  superseded: 'Superseded',
  'wont-fix': "Won't fix",
  deferred: 'Deferred',
}
```

Then, inside `renderBacklog`, replace the row builder. The current code reads:

```typescript
  const rows = sorted.map((review) => {
    const counts = [countBy(review, 'open'), countBy(review, 'fixed'), countBy(review, 'superseded')]
    return `| ${review.section} | ${counts[0]} | ${counts[1]} | ${counts[2]} | ${review.date} |`
  })
```

Replace it with:

```typescript
  const rows = sorted.map((review) => {
    const counts = STATUSES.map((status) => countBy(review, status))
    return `| ${review.section} | ${counts.join(' | ')} | ${review.date} |`
  })
```

Finally, replace the three hardcoded table lines inside the `lines` array literal. The current lines read:

```typescript
    '| Section | Open | Fixed | Superseded | Last reviewed |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    `| **Total** | ${total('open')} | ${total('fixed')} | ${total('superseded')} | — |`,
```

Replace them with:

```typescript
    `| Section | ${STATUSES.map((status) => STATUS_LABELS[status]).join(' | ')} | Last reviewed |`,
    `| ${Array.from({ length: STATUSES.length + 2 }, () => '---').join(' | ')} |`,
    ...rows,
    `| **Total** | ${STATUSES.map((status) => total(status)).join(' | ')} | — |`,
```

The `+ 2` in the separator accounts for the `Section` and `Last reviewed` columns.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS, **27 pass / 0 fail**.

- [ ] **Step 5: Regenerate the backlog**

The table shape changed, so the checked-in `_BACKLOG.md` is now stale and its currency test will fail until it is regenerated:

```bash
bun run ux:backlog
git diff docs/ux-reviews/_BACKLOG.md
```

Expected: the summary table gains two columns — `Won't fix` and `Deferred` — every data row gains two `0` cells, the separator row gains two `| ---`, and the total row gains two `0` cells. The header sentence still reads `11 open finding(s) across 18 section(s).` and the severity buckets are untouched (High 0 / Med 2 / Low 9). If the header sentence or a severity bucket moved, stop — something beyond the table changed.

- [ ] **Step 6: Verify regeneration is idempotent**

```bash
md5 -q docs/ux-reviews/_BACKLOG.md && bun run ux:backlog && md5 -q docs/ux-reviews/_BACKLOG.md
```

Expected: the two hashes are identical — running the generator again must not produce a third state.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add scripts/ux-backlog-lib.ts tests/scripts/ux-backlog.test.ts docs/ux-reviews/_BACKLOG.md
git commit -m "refactor(ux-backlog): derive the summary table from the status tuple"
```

---

### Task 3: List deferred findings in their own section

**Files:**

- Modify: `scripts/ux-backlog-lib.ts` (`renderBacklog`, the severity-bucket loop and the lines that follow it)
- Modify: `docs/ux-reviews/_BACKLOG.md` (regenerated)
- Test: `tests/scripts/ux-backlog.test.ts`

**Interfaces:**

- Consumes: `STATUSES` and `FindingStatus` from Task 1; `STATUS_LABELS` exists from Task 2 and must not be duplicated.
- Produces: a module-level `renderFindingLine(finding: Finding): string` helper, used by both the severity buckets and the new `## Deferred` section.

**Context:** A `deferred` finding is real work that still needs doing. If it appears only as a column count it effectively disappears, which defeats the document's purpose. `wont-fix` findings deliberately get **no** list — they are genuinely closed, and the table count plus the finding's own review document are sufficient record.

The one-line-per-finding format already exists inside the severity-bucket loop. Extract it rather than copying it — a verbatim second copy is a review defect.

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/ux-backlog.test.ts`, near the other `renderBacklog` cases. Build the reviews inline so the case is self-contained:

```typescript
  test('deferred findings are listed but wont-fix findings are not', () => {
    const out = renderBacklog(
      [
        {
          section: 'ReposSection',
          date: '2026-07-05',
          findings: [
            {
              id: 'repos-blocked',
              section: 'ReposSection',
              severity: 'Low',
              title: 'Needs backend support',
              status: 'deferred',
              anchor: 'client/settings/repos-fetchers.ts:16',
            },
            {
              id: 'repos-accepted',
              section: 'ReposSection',
              severity: 'Low',
              title: 'Accepted as-is',
              status: 'wont-fix',
              anchor: '',
            },
          ],
        },
      ],
      2026,
    )
    expect(out).toContain('## Deferred')
    expect(out).toContain('`repos-blocked` — **ReposSection** — Needs backend support')
    expect(out).toContain('client/settings/repos-fetchers.ts:16')
    expect(out).not.toContain('repos-accepted')
  })

  test('the deferred section reads _None._ when nothing is deferred', () => {
    const out = renderBacklog([], 2026)
    const deferredSection = out.slice(out.indexOf('## Deferred'))
    expect(deferredSection).toContain('_None._')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: FAIL, 2 failures, both because the output contains no `## Deferred` heading. The second case fails at `out.indexOf('## Deferred')` returning `-1`, which slices the whole document — it may fail on the `_None._` assertion only incidentally, which is fine; the heading assertion in the first case is the primary signal.

- [ ] **Step 3: Write the minimal implementation**

In `scripts/ux-backlog-lib.ts`, add the shared line renderer at module level, next to `countBy`:

```typescript
const renderFindingLine = (finding: Finding): string => {
  const anchor = finding.anchor === '' ? '' : ` — \`${finding.anchor}\``
  return `- \`${finding.id}\` — **${finding.section}** — ${finding.title}${anchor}`
}
```

Inside `renderBacklog`, replace the body of the severity-bucket inner loop. It currently reads:

```typescript
    for (const finding of bucket) {
      const anchor = finding.anchor === '' ? '' : ` — \`${finding.anchor}\``
      lines.push(`- \`${finding.id}\` — **${finding.section}** — ${finding.title}${anchor}`)
    }
```

Replace it with:

```typescript
    for (const finding of bucket) {
      lines.push(renderFindingLine(finding))
    }
```

Then, after the severity-bucket `for` loop closes and **before** the trailing `lines.push('')`, add the deferred section:

```typescript
  const deferred = sorted
    .flatMap((review) => review.findings.filter((finding) => finding.status === 'deferred'))
    .sort(bySectionThenId)
  lines.push('', '## Deferred', '')
  if (deferred.length === 0) {
    lines.push('_None._')
  }
  for (const finding of deferred) {
    lines.push(renderFindingLine(finding))
  }
```

`flatMap` returns a fresh array, so sorting it in place is safe and does not mutate any caller's data.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS, **29 pass / 0 fail**.

- [ ] **Step 5: Regenerate the backlog**

```bash
bun run ux:backlog
git diff docs/ux-reviews/_BACKLOG.md
```

Expected: exactly one addition at the end of the document — a `## Deferred` heading followed by `_None._`. Nothing is deferred yet; that happens in Task 4. The header sentence must still read `11 open finding(s) across 18 section(s).`

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add scripts/ux-backlog-lib.ts tests/scripts/ux-backlog.test.ts docs/ux-reviews/_BACKLOG.md
git commit -m "feat(ux-backlog): list deferred findings in their own section"
```

---

### Task 4: Close the two non-defect findings

**Files:**

- Modify: `docs/ux-reviews/DebugApp.md` (the `debug-icon-buttons-control-height` finding)
- Modify: `docs/ux-reviews/ReposSection.md` (the `repos-no-edit-capability` finding)
- Modify: `docs/ux-reviews/_TEMPLATE.md` (the permitted-status list, roughly `:40-44`)
- Modify: `docs/ux-reviews/_BACKLOG.md` (regenerated)

**Interfaces:**

- Consumes: the `wont-fix` and `deferred` statuses from Task 1, the derived table from Task 2, and the `## Deferred` section from Task 3.
- Produces: nothing later depends on this task. It is the last.

**Context:** These two findings are not UI defects.

- `debug-icon-buttons-control-height` — its own text says *"No action needed in DebugApp"*. 24px meets WCAG 2.5.8 (Target Size Minimum)'s 24×24px floor, so it is not an accessibility failure. It was recorded as a shared design-token fact. Its only real fix is raising `--control-h-sm` in `client/shared/tokens.css`, which changes every consumer at once and requires re-reviewing every affected section — explicitly out of scope.
- `repos-no-edit-capability` — `client/settings/repos-fetchers.ts:16-34` exposes only `addRepo`/`deleteRepo`. Per-row editing of branch/preset/egress needs backend update support that does not exist. The discoverability half of the finding is already closed by the explicit note in `ReposSection.svelte:160-163`; the residue is a capability gap, not a UX defect. It is `deferred` rather than `wont-fix` because the capability may genuinely be built later.

The parser requires a non-empty `- **Resolved:**` line for any non-`open` status. It checks only non-emptiness — it does **not** validate a commit hash — so these two entries carry a rationale instead. Each finding's existing `- **Source:**` line is left untouched: it records the pre-decision state and remains accurate.

**No file under `client/` or `src/` changes in this task.**

**Field order.** In every closed finding in this corpus, `- **Resolved:**` sits immediately after `- **Status:**` and before `- **Dimension:**` (see `docs/ux-reviews/ByokSection.md:39-41`). Follow that.

**Leave `- **Suggested fix:**` alone in both findings.** Existing `fixed` entries rewrite it to `N/A — resolved.`, but neither of these is fixed: DebugApp's already reads "No action needed in `DebugApp`", and ReposSection's records the work that a future capability would enable. Both remain accurate and useful.

- [ ] **Step 1: Close the DebugApp finding**

In `docs/ux-reviews/DebugApp.md:216-222`, the finding with `- **Id:** debug-icon-buttons-control-height`. Replace its `- **Status:** open` line (`:217`) with the following two lines, leaving `- **Note:**`, `- **Source:**` and `- **Suggested fix:**` untouched:

```markdown
- **Status:** wont-fix
- **Resolved:** 2026-08-04 — decision, no commit. 24px meets WCAG 2.5.8 (Target Size Minimum)'s 24×24px floor, so this is not an accessibility failure. The finding's own text directs that no action be taken in DebugApp; any change belongs in `--control-h-sm` (`client/shared/tokens.css:63`), where it would affect every consumer and require re-reviewing the affected sections.
```

- [ ] **Step 2: Close the ReposSection finding**

In `docs/ux-reviews/ReposSection.md:116-124`, the finding with `- **Id:** repos-no-edit-capability`. Replace its `- **Status:** open` line (`:119`) with:

```markdown
- **Status:** deferred
- **Resolved:** 2026-08-04 — decision, no commit. `client/settings/repos-fetchers.ts:16-34` exposes only add and delete; per-row editing of branch, preset and egress needs backend update support that does not exist. The surprise-discovery half of this finding is already closed by the note at `ReposSection.svelte:160-163`. Deferred rather than won't-fix because the capability may genuinely be built later.
```

- [ ] **Step 3: Document the two statuses for humans**

`docs/ux-reviews/_TEMPLATE.md:40-44` lists the permitted statuses. Add two bullets directly after the `superseded` bullet (`:44`), above the paragraph beginning "There is no `partial`" — that paragraph stays as written, since `partial` remains invalid. Match the surrounding bullets' style:

```markdown
- `wont-fix` — examined, and no change is warranted: either the finding's premise was wrong, or the current behaviour is accepted as-is. Requires a `- **Resolved:**` line carrying the rationale; unlike `fixed` and `superseded`, it needs no commit hash.
- `deferred` — a real gap, acknowledged, blocked on work outside this project's scope. Requires a `- **Resolved:**` line carrying the rationale and naming the blocker; no commit hash. Deferred findings are listed in `_BACKLOG.md`'s `## Deferred` section so they stay visible.
```

- [ ] **Step 4: Regenerate the backlog and verify the expected end state**

```bash
bun run ux:backlog
```

Then read `docs/ux-reviews/_BACKLOG.md` and confirm every one of these:

- The header sentence reads `9 open finding(s) across 18 section(s).` — the count drops from 11 to 9, and the section count stays 18.
- The `DebugApp` row shows `1` in the `Won't fix` column.
- The `ReposSection` row shows `1` in the `Deferred` column.
- Severity buckets read `### High (0)`, `### Med (2)`, `### Low (7)`.
- Neither `debug-icon-buttons-control-height` nor `repos-no-edit-capability` appears under `## Open findings`.
- The `## Deferred` section contains exactly one entry, `repos-no-edit-capability`, and no longer reads `_None._`.

If the section count is not 18, or a severity bucket is off, stop and report rather than adjusting the numbers.

- [ ] **Step 5: Verify the generator reproduces the file byte-for-byte**

```bash
md5 -q docs/ux-reviews/_BACKLOG.md && bun run ux:backlog && md5 -q docs/ux-reviews/_BACKLOG.md
```

Expected: the two hashes are identical. This proves the checked-in file is exactly what the generator emits and that no hand-edit crept in.

- [ ] **Step 6: Run the full test suite for this area**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS, **29 pass / 0 fail**. The backlog-currency test now passes against the regenerated file.

- [ ] **Step 7: Confirm no visual baseline moved**

No `client/` file changed, so no Storybook baseline can have moved. Prove it with the non-mutating audit:

```bash
bun run visual:audit
```

Expected: **467 passed, 0 failed**. Do not run `bun shoot` — it rewrites baselines and would make this audit pass by construction.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add docs/ux-reviews/DebugApp.md docs/ux-reviews/ReposSection.md docs/ux-reviews/_TEMPLATE.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux-reviews): close the two non-defect findings by decision"
```

---

## Done when

- `docs/ux-reviews/_BACKLOG.md` reports **9 open findings across 18 sections**, High 0 / Med 2 / Low 7, with a `## Deferred` section listing `repos-no-edit-capability`.
- `tests/scripts/ux-backlog.test.ts` reports **29 pass / 0 fail** — above the 21 floor, with no pre-existing assertion loosened.
- `bun run visual:audit` reports **467 passed, 0 failed**.
- No file under `client/` or `src/` was touched.
