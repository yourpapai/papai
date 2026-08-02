<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Findings Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every UX finding in `docs/ux-reviews/` a stable id and a verified status, backed by a generated roll-up that a test keeps current, and re-review all 18 sections to assign those statuses.

**Architecture:** Findings gain two markdown fields (`Id`, `Status`). A pure library parses the review documents and renders a roll-up; a thin CLI wires it to the filesystem; a test regenerates in memory and diffs against the checked-in file so it cannot drift. Four re-review batches then supply the statuses.

**Tech Stack:** Bun, TypeScript (strict, `noUncheckedIndexedAccess`), `bun:test`, oxlint + oxfmt, Playwright + Storybook for screenshots.

**Source spec:** [`docs/superpowers/specs/2026-08-02-ux-findings-backlog-design.md`](../specs/2026-08-02-ux-findings-backlog-design.md)

## Global Constraints

- **Corpus size:** 18 review documents, **159 findings** (35 High, 67 Med, 60 Low). `_TEMPLATE.md` and `RUBRIC.md` are not review documents and are never parsed.
- **Status values:** exactly `open`, `fixed`, `superseded`. There is no `partial` — a partially-fixed finding stays `open` with its text narrowed to the residue, keeping its id.
- **Ids** are kebab-case, section-prefixed, assigned by hand, **never derived from the heading text**, and never reused.
- **The parser never skips a malformed record.** Every error case in Task 2 throws.
- **Import paths use the `.js` extension.** Strict TypeScript; `noUncheckedIndexedAccess` is on, so every array/`Map` index yields `T | undefined`.
- **Never add lint-disable or type-ignore comments** — the write hook blocks them. `typescript/non-nullable-type-assertion-style` is an error: do not write `as T` where `!` or a type guard suffices.
- **Formatter is oxfmt** (`bun run format`), not prettier.
- **Visual audit floor is 458 passed / 0 failed.** Any task that adds a Storybook story raises it; that task states its own expected count.
- **Baseline hygiene.** Shooting a *newly added* story is baseline creation and is correct. Re-shooting after changing something already under test is the tautology sub-project I exists to prevent. Both are `bun shoot -g X` at the command line, so the distinction is yours to hold: if a baseline existed before your change, do not overwrite it.
- **`bun shoot` must keep `--update-snapshots=all`.** Never invoke `bun shoot <path>`; use `bun shoot -g <pattern>`.
- **Re-reviews may edit `*.stories.svelte` and `tests/visual/**` only.** No changes to components, CSS, or `src/`.
- **`check:full` currently returns 10–11 of 12.** The `test` and `review-loop:test` failures are pre-existing repo-level parallel-load flakiness and are not this project's to fix.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/ux-reviews/*.md` (18) | Findings, now carrying `Id` and `Status` |
| `docs/ux-reviews/_TEMPLATE.md` | The shape new reviews copy |
| `docs/ux-reviews/_BACKLOG.md` | Generated roll-up — never hand-edited |
| `scripts/ux-backlog-lib.ts` | Pure: parse a review document, render the roll-up. No filesystem, no `process.exit` |
| `scripts/ux-backlog.ts` | CLI: read the directory, call the library, write the file |
| `tests/scripts/ux-backlog.test.ts` | Parser error cases, render determinism, currency, header byte-identity |
| `.claude/skills/ux-review/SKILL.md` | Updated so future reviews emit the new record shape |

---

## Task 1: Backfill ids and statuses

**Files:**

- Modify: all 18 documents in `docs/ux-reviews/` (every file except `_TEMPLATE.md` and `RUBRIC.md`)
- Modify: `docs/ux-reviews/_TEMPLATE.md`

**Interfaces:**

- Consumes: nothing.
- Produces: the record shape Task 2's parser is written against — `- **Id:**` and `- **Status:**` as the first two bullets of every finding block.

This task is mechanical and large: 159 findings. It comes first so the parser is written against real records rather than invented ones.

- [ ] **Step 1: Add the two fields to every finding**

For each finding, insert `Id` and `Status` as the **first two bullets**, before `Dimension`. Leave every other line untouched.

Before:

```markdown
### [High] Removing a member revokes access with no confirmation

- **Dimension:** 4. Feedback & state (also 3. Consistency)
- **Where visible:** Populated — each row's right-aligned "Remove".
```

After:

```markdown
### [High] Removing a member revokes access with no confirmation

- **Id:** members-delete-no-confirm
- **Status:** open
- **Dimension:** 4. Feedback & state (also 3. Consistency)
- **Where visible:** Populated — each row's right-aligned "Remove".
```

**Every finding gets `Status: open`,** without exception. `open` is the claim that needs no evidence; the re-reviews supply the evidence for anything else. Do not guess that a finding looks fixed — that guess is precisely what this project exists to replace.

Ids use this prefix per document, then two to four words describing the defect:

| Document | Prefix | Document | Prefix |
| --- | --- | --- | --- |
| `AiOutputSection.md` | `ai-output` | `KaneoAccessSection.md` | `kaneo-access` |
| `ByokSection.md` | `byok` | `McpSection.md` | `mcp` |
| `CodeHostSection.md` | `code-host` | `MembersSection.md` | `members` |
| `CodingCredentialsSection.md` | `coding-credentials` | `MemorySection.md` | `memory` |
| `CodingIdentitySection.md` | `coding-identity` | `ProfileSection.md` | `profile` |
| `DebugApp.md` | `debug` | `ReleaseSubscriptionSection.md` | `release-subscription` |
| `GroupProviderSection.md` | `group-provider` | `ReposSection.md` | `repos` |
| `GuestModeSection.md` | `guest-mode` | `TaskProviderSection.md` | `task-provider` |
| `IdentitySection.md` | `identity` | `ToolsSection.md` | `tools` |

Name the **defect**, not the heading: `members-delete-no-confirm`, not `members-removing-a-member-revokes-access`. A heading reworded next month must not orphan the id.

- [ ] **Step 2: Verify every finding got both fields**

Run:

```bash
for f in docs/ux-reviews/*.md; do
  case "$f" in *_TEMPLATE.md|*RUBRIC.md) continue;; esac
  printf '%s  h=%s id=%s st=%s\n' "$(basename "$f")" \
    "$(grep -c '^### \[' "$f")" "$(grep -c '^- \*\*Id:\*\* ' "$f")" "$(grep -c '^- \*\*Status:\*\* open$' "$f")"
done
```

Expected: `h`, `id`, and `st` are equal on every line, and the eighteen `h` values sum to 159.

- [ ] **Step 3: Verify ids are unique corpus-wide**

Run:

```bash
grep -h '^- \*\*Id:\*\* ' docs/ux-reviews/*.md | sort | uniq -d
```

Expected: no output.

- [ ] **Step 4: Update the template**

In `docs/ux-reviews/_TEMPLATE.md`, add the two fields to each of the three placeholder findings and document the vocabulary. Replace the `## Findings` preamble line and the `[High]` block with:

```markdown
## Findings

Severity-ranked, highest first. Each finding = id · status · dimension · severity · where visible ·
source anchor · suggested fix.

`Id` is kebab-case, section-prefixed, assigned by hand, and never derived from the heading — a
reworded title must not orphan it. Ids are never reused.

`Status` is one of:

- `open` — still reproduces.
- `fixed` — no longer reproduces; requires a `**Resolved:**` line naming the commit or sub-project.
- `superseded` — no longer meaningful; requires a `**Resolved:**` line.

There is no `partial`. A partially-fixed finding stays `open` with its text narrowed to the residue,
keeping its id.

### [High] &lt;short title&gt;

- **Id:** &lt;section&gt;-&lt;short-defect-slug&gt;
- **Status:** open
- **Dimension:** &lt;2. Affordance & signifiers&gt;
- **Where visible:** &lt;state / viewport screenshot&gt;
- **Source:** `client/settings/sections/<Section>.svelte:NN`
- **Suggested fix:** &lt;one descriptive line — not an edit, not a before→after&gt;
```

Add `- **Id:** …` and `- **Status:** open` to the `[Med]` and `[Low]` placeholder blocks too.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add docs/ux-reviews/
git commit -m "docs(ux-reviews): backfill finding ids and open statuses"
```

---

## Task 2: The parsing and rendering library

**Files:**

- Create: `scripts/ux-backlog-lib.ts`
- Test: `tests/scripts/ux-backlog.test.ts`

**Interfaces:**

- Consumes: the record shape from Task 1.
- Produces, for Task 3:
  - `parseFindings(markdown: string, filename: string): SectionReview`
  - `renderBacklog(reviews: readonly SectionReview[], year: number): string`
  - `resolveHeaderYear(): number`
  - `LICENSE_HEADER_LINES: readonly string[]`
  - types `Severity`, `FindingStatus`, `Finding`, `SectionReview`

`tests/scripts/**` runs under bare `bun test` — `bunfig.toml`'s `pathIgnorePatterns` excludes only `tests/e2e/**`, `tests/client/**`, `tests/visual/**`, and `tests/stories/**`.

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/ux-backlog.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseFindings, renderBacklog } from '../../scripts/ux-backlog-lib.js'

const header = ['# UX Review — Members', '', '**Date:** 2026-07-03', ''].join('\n')

const finding = (fields: readonly string[], heading = '### [High] Delete has no confirmation'): string =>
  [header, heading, '', ...fields, ''].join('\n')

const VALID = [
  '- **Id:** members-delete-no-confirm',
  '- **Status:** open',
  '- **Dimension:** 4. Feedback & state',
  '- **Source:** `client/settings/sections/MembersSection.svelte:107` calls `remove()` immediately.',
  '- **Suggested fix:** Gate Remove behind the shared Confirm dialog.',
]

describe('parseFindings', () => {
  test('extracts the section, date, and one fully-formed finding', () => {
    const review = parseFindings(finding(VALID), 'MembersSection.md')
    expect(review.section).toBe('MembersSection')
    expect(review.date).toBe('2026-07-03')
    expect(review.findings).toEqual([
      {
        id: 'members-delete-no-confirm',
        section: 'MembersSection',
        severity: 'High',
        title: 'Delete has no confirmation',
        status: 'open',
        anchor: 'client/settings/sections/MembersSection.svelte:107',
      },
    ])
  })

  test('takes the first backtick file:line as the anchor and tolerates its absence', () => {
    const noAnchor = VALID.map((line) => (line.startsWith('- **Source:**') ? '- **Source:** prose only' : line))
    expect(parseFindings(finding(noAnchor), 'MembersSection.md').findings[0]?.anchor).toBe('')
  })

  test('throws when a finding has no Id', () => {
    const missing = VALID.filter((line) => !line.startsWith('- **Id:**'))
    expect(() => parseFindings(finding(missing), 'MembersSection.md')).toThrow(/missing.*Id/u)
  })

  test('throws on a duplicate Id within one document', () => {
    const doubled = [finding(VALID), finding(VALID, '### [Low] Another one')].join('\n')
    expect(() => parseFindings(doubled, 'MembersSection.md')).toThrow(/duplicate Id "members-delete-no-confirm"/u)
  })

  test('throws on a Status outside the three values', () => {
    const bad = VALID.map((line) => (line === '- **Status:** open' ? '- **Status:** partial' : line))
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(/Status/u)
  })

  test.each(['fixed', 'superseded'])('throws when %s carries no Resolved line', (status) => {
    const bad = VALID.map((line) => (line === '- **Status:** open' ? `- **Status:** ${status}` : line))
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(/Resolved/u)
  })

  test.each(['fixed', 'superseded'])('accepts %s when a Resolved line is present', (status) => {
    const ok = [
      ...VALID.map((line) => (line === '- **Status:** open' ? `- **Status:** ${status}` : line)),
      '- **Resolved:** sub-project F, commit abc1234',
    ]
    expect(parseFindings(finding(ok), 'MembersSection.md').findings[0]?.status).toBe(status)
  })

  test('throws on a severity outside High, Med, Low', () => {
    expect(() => parseFindings(finding(VALID, '### [Critical] Nope'), 'MembersSection.md')).toThrow(/severity/u)
  })

  test('throws when the header has no Date line', () => {
    expect(() => parseFindings(['# UX Review', '', '### [High] X', '', ...VALID].join('\n'), 'X.md')).toThrow(/Date/u)
  })

  test('names the offending file and heading in the error', () => {
    const missing = VALID.filter((line) => !line.startsWith('- **Id:**'))
    expect(() => parseFindings(finding(missing), 'MembersSection.md')).toThrow(
      /MembersSection\.md.*Delete has no confirmation/u,
    )
  })
})

describe('renderBacklog', () => {
  const review = parseFindings(finding(VALID), 'MembersSection.md')

  test('throws on a duplicate Id across two documents', () => {
    const other = parseFindings(finding(VALID), 'MemorySection.md')
    expect(() => renderBacklog([review, other], 2026)).toThrow(/duplicate Id "members-delete-no-confirm"/u)
  })

  test('opens with the markdown license header the stamper produces', () => {
    expect(renderBacklog([review], 2026)).toStartWith(
      [
        '<!--',
        'SPDX-License-Identifier: BUSL-1.1',
        'Copyright (c) 2026 Dmitriy Lazarev',
        'Use of this software is governed by the Business Source License 1.1.',
        'See LICENSE in the project root for details.',
        '-->',
        '',
        '',
      ].join('\n'),
    )
  })

  test('lists open findings with severity, section, id, title, and anchor', () => {
    const out = renderBacklog([review], 2026)
    expect(out).toContain('`members-delete-no-confirm`')
    expect(out).toContain('MembersSection')
    expect(out).toContain('Delete has no confirmation')
    expect(out).toContain('client/settings/sections/MembersSection.svelte:107')
  })

  test('counts closed findings without listing them', () => {
    const closed = parseFindings(
      finding([
        '- **Id:** members-stale-copy',
        '- **Status:** fixed',
        '- **Resolved:** sub-project F',
        '- **Dimension:** 5. Content & language',
        '- **Source:** `client/settings/sections/MembersSection.svelte:12`',
      ]),
      'MembersSection.md',
    )
    const out = renderBacklog([closed], 2026)
    expect(out).not.toContain('`members-stale-copy`')
    expect(out).toContain('| MembersSection | 0 | 1 | 0 | 2026-07-03 |')
  })

  test('is deterministic and independent of input order', () => {
    const a = parseFindings(finding(VALID), 'MembersSection.md')
    const b = parseFindings(
      finding(
        VALID.map((line) => (line.startsWith('- **Id:**') ? '- **Id:** memory-x' : line)),
        '### [Low] Memory thing',
      ),
      'MemorySection.md',
    )
    expect(renderBacklog([a, b], 2026)).toBe(renderBacklog([b, a], 2026))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/ux-backlog.test.ts`

Expected: FAIL — `Cannot find module '../../scripts/ux-backlog-lib.js'`.

- [ ] **Step 3: Write the library**

Create `scripts/ux-backlog-lib.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const SEVERITIES = ['High', 'Med', 'Low'] as const
const STATUSES = ['open', 'fixed', 'superseded'] as const

export type Severity = (typeof SEVERITIES)[number]
export type FindingStatus = (typeof STATUSES)[number]

export interface Finding {
  readonly id: string
  readonly section: string
  readonly severity: Severity
  readonly title: string
  readonly status: FindingStatus
  readonly anchor: string
}

export interface SectionReview {
  readonly section: string
  readonly date: string
  readonly findings: readonly Finding[]
}

const isSeverity = (value: string): value is Severity => (SEVERITIES as readonly string[]).includes(value)
const isStatus = (value: string): value is FindingStatus => (STATUSES as readonly string[]).includes(value)

const HEADING = /^### \[(?<severity>[^\]]*)\] (?<title>.+)$/u
const FIELD = /^- \*\*(?<key>[A-Za-z]+):\*\* (?<value>.*)$/u
const DATE = /^\*\*Date:\*\* (?<date>\d{4}-\d{2}-\d{2})\s*$/u
const ANCHOR = /`(?<anchor>[^`]+?:\d+)`/u

/**
 * The markdown license header exactly as `scripts/add-license-headers.ts` emits it.
 * `_BACKLOG.md` is both generated and stamped; if these two disagree by a byte the
 * stamper and the currency test rewrite each other forever.
 */
export const LICENSE_HEADER_LINES = [
  '<!--',
  'SPDX-License-Identifier: BUSL-1.1',
  'Copyright (c) {YEAR} Dmitriy Lazarev',
  'Use of this software is governed by the Business Source License 1.1.',
  'See LICENSE in the project root for details.',
  '-->',
] as const

/** Resolve the copyright year the same way the stamper does, so the two never disagree. */
export function resolveHeaderYear(): number {
  const configured = process.env['LICENSE_HEADER_YEAR']
  if (configured === undefined || configured.length === 0) return new Date().getFullYear()
  const parsed = Number.parseInt(configured, 10)
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear()
}

interface RawFinding {
  readonly severity: string
  readonly title: string
  readonly fields: Map<string, string>
}

function toFinding(raw: RawFinding, section: string, filename: string, seen: Set<string>): Finding {
  const where = `${filename} → "### [${raw.severity}] ${raw.title}"`

  if (!isSeverity(raw.severity)) {
    throw new Error(`${where}: severity must be one of High, Med, Low`)
  }

  const id = raw.fields.get('Id')
  if (id === undefined || id.length === 0) throw new Error(`${where}: missing "- **Id:**" line`)
  if (seen.has(id)) throw new Error(`${where}: duplicate Id "${id}"`)
  seen.add(id)

  const status = raw.fields.get('Status')
  if (status === undefined || !isStatus(status)) {
    throw new Error(`${where}: Status must be one of open, fixed, superseded (got "${status ?? ''}")`)
  }

  const resolved = raw.fields.get('Resolved')
  if (status !== 'open' && (resolved === undefined || resolved.length === 0)) {
    throw new Error(`${where}: Status "${status}" requires a "- **Resolved:**" line`)
  }

  const anchor = ANCHOR.exec(raw.fields.get('Source') ?? '')?.groups?.['anchor'] ?? ''
  return { id, section, severity: raw.severity, title: raw.title, status, anchor }
}

export function parseFindings(markdown: string, filename: string): SectionReview {
  const section = filename.replace(/\.md$/u, '')
  const lines = markdown.split('\n')

  const dateMatch = lines.map((line) => DATE.exec(line)).find((match) => match !== null)
  const date = dateMatch?.groups?.['date']
  if (date === undefined) throw new Error(`${filename}: no "**Date:** YYYY-MM-DD" line in the header`)

  const findings: Finding[] = []
  const seen = new Set<string>()
  let current: RawFinding | null = null

  const flush = (): void => {
    if (current !== null) findings.push(toFinding(current, section, filename, seen))
    current = null
  }

  for (const line of lines) {
    const heading = HEADING.exec(line)?.groups
    if (heading !== undefined) {
      flush()
      current = { severity: heading['severity'] ?? '', title: heading['title'] ?? '', fields: new Map() }
      continue
    }
    if (current === null) continue
    const field = FIELD.exec(line)?.groups
    if (field === undefined) continue
    const key = field['key'] ?? ''
    // First occurrence wins: prose in a later bullet can echo an earlier label.
    if (!current.fields.has(key)) current.fields.set(key, field['value'] ?? '')
  }
  flush()

  return { section, date, findings }
}

const bySection = (a: SectionReview, b: SectionReview): number =>
  a.section < b.section ? -1 : a.section > b.section ? 1 : 0

const bySectionThenId = (a: Finding, b: Finding): number => {
  if (a.section !== b.section) return a.section < b.section ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function assertUniqueIds(reviews: readonly SectionReview[]): void {
  const owner = new Map<string, string>()
  for (const review of reviews) {
    for (const finding of review.findings) {
      const prior = owner.get(finding.id)
      if (prior !== undefined) {
        throw new Error(`duplicate Id "${finding.id}" in ${prior} and ${finding.section}`)
      }
      owner.set(finding.id, finding.section)
    }
  }
}

const countBy = (review: SectionReview, status: FindingStatus): number =>
  review.findings.filter((finding) => finding.status === status).length

export function renderBacklog(reviews: readonly SectionReview[], year: number): string {
  assertUniqueIds(reviews)

  const sorted = [...reviews].sort(bySection)
  const open = sorted.flatMap((review) => review.findings.filter((finding) => finding.status === 'open'))

  const rows = sorted.map((review) => {
    const counts = [countBy(review, 'open'), countBy(review, 'fixed'), countBy(review, 'superseded')]
    return `| ${review.section} | ${counts[0]} | ${counts[1]} | ${counts[2]} | ${review.date} |`
  })
  const total = (status: FindingStatus): number =>
    sorted.reduce((sum, review) => sum + countBy(review, status), 0)

  const lines: string[] = [
    ...LICENSE_HEADER_LINES.map((line) => line.replace('{YEAR}', String(year))),
    '',
    '# UX findings backlog',
    '',
    '<!-- Generated by `bun run ux:backlog`. Do not edit by hand. -->',
    '',
    `${open.length} open finding(s) across ${sorted.length} section(s).`,
    '',
    '## Summary',
    '',
    '| Section | Open | Fixed | Superseded | Last reviewed |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    `| **Total** | ${total('open')} | ${total('fixed')} | ${total('superseded')} | — |`,
    '',
    '## Open findings',
  ]

  for (const severity of SEVERITIES) {
    const bucket = open.filter((finding) => finding.severity === severity).sort(bySectionThenId)
    lines.push('', `### ${severity} (${bucket.length})`, '')
    if (bucket.length === 0) {
      lines.push('_None._')
      continue
    }
    for (const finding of bucket) {
      const anchor = finding.anchor === '' ? '' : ` — \`${finding.anchor}\``
      lines.push(`- \`${finding.id}\` — **${finding.section}** — ${finding.title}${anchor}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/ux-backlog.test.ts`

Expected: PASS, all tests green.

- [ ] **Step 5: Lint, format, commit**

```bash
bun run lint && bun run typecheck && bun run format
git add scripts/ux-backlog-lib.ts tests/scripts/ux-backlog.test.ts
git commit -m "feat(scripts): add ux-backlog parsing and rendering library"
```

---

## Task 3: The CLI, the generated backlog, and the currency gate

**Files:**

- Create: `scripts/ux-backlog.ts`
- Create: `docs/ux-reviews/_BACKLOG.md` (generated)
- Modify: `package.json` (add `ux:backlog` beside `coverage:ratchet`, around line 46)
- Modify: `tests/scripts/ux-backlog.test.ts` (append the currency and stamper suites)

**Interfaces:**

- Consumes: everything Task 2 exports.
- Produces: `bun run ux:backlog`, which every re-review batch runs before committing.

- [ ] **Step 1: Write the CLI**

Create `scripts/ux-backlog.ts`, following the shape of `scripts/coverage/ratchet.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir } from 'node:fs/promises'

import { parseFindings, renderBacklog, resolveHeaderYear, type SectionReview } from './ux-backlog-lib.js'

const REVIEW_DIR = 'docs/ux-reviews'
const OUTPUT_PATH = `${REVIEW_DIR}/_BACKLOG.md`

/**
 * Review documents only: `RUBRIC.md` is reference material, and every underscore-prefixed
 * file (`_TEMPLATE.md`, `_BACKLOG.md`, a future `_consistency.md`) is not a section review.
 */
export function isReviewDocument(name: string): boolean {
  return name.endsWith('.md') && !name.startsWith('_') && name !== 'RUBRIC.md'
}

export async function collectReviews(): Promise<SectionReview[]> {
  const names = (await readdir(REVIEW_DIR)).filter(isReviewDocument).sort()
  const reviews: SectionReview[] = []
  for (const name of names) {
    reviews.push(parseFindings(await Bun.file(`${REVIEW_DIR}/${name}`).text(), name))
  }
  return reviews
}

async function main(): Promise<void> {
  const reviews = await collectReviews()
  await Bun.write(OUTPUT_PATH, renderBacklog(reviews, resolveHeaderYear()))
  const findings = reviews.reduce((sum, review) => sum + review.findings.length, 0)
  console.log(`wrote ${OUTPUT_PATH} (${reviews.length} sections, ${findings} findings)`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

`collectReviews` and `isReviewDocument` are exported so the currency test reuses the exact same directory filter rather than a copy that can drift. `main()` is not exported and runs on import — the test must import only the two named helpers, which is safe because `main()` only writes when run as the entry point via `bun run ux:backlog`. If importing this module in the test turns out to execute `main()`, move `collectReviews`/`isReviewDocument` into `ux-backlog-lib.ts` (taking the directory as a parameter to keep it testable) and have the CLI call them.

- [ ] **Step 2: Add the script**

In `package.json`, immediately after the `"coverage:ratchet:stories"` line:

```json
    "ux:backlog": "bun scripts/ux-backlog.ts",
```

- [ ] **Step 3: Generate the first backlog**

Run: `bun run ux:backlog`

Expected: `wrote docs/ux-reviews/_BACKLOG.md (18 sections, 159 findings)`

Open the file and confirm the Total row reads `| **Total** | 159 | 0 | 0 | — |` and the three severity buckets read `High (35)`, `Med (67)`, `Low (60)`.

- [ ] **Step 4: Confirm the stamper is a no-op on it**

Run:

```bash
bun run license:headers && git diff --stat docs/ux-reviews/_BACKLOG.md
```

Expected: empty diff. A non-empty diff means the generated header does not match `buildMdHeader` in `scripts/add-license-headers.ts:66-76` byte-for-byte — fix `LICENSE_HEADER_LINES`, do not hand-edit the generated file.

- [ ] **Step 5: Write the failing currency and stamper tests**

First extend the existing import block at the top of the file — imports stay grouped there, not appended at the bottom:

```typescript
import { collectReviews, isReviewDocument } from '../../scripts/ux-backlog.js'
import {
  LICENSE_HEADER_LINES,
  parseFindings,
  renderBacklog,
  resolveHeaderYear,
} from '../../scripts/ux-backlog-lib.js'
```

Then append the two suites:

```typescript
describe('the checked-in backlog', () => {
  test('is current — regenerating in memory reproduces it exactly', async () => {
    const expected = renderBacklog(await collectReviews(), resolveHeaderYear())
    const actual = await Bun.file('docs/ux-reviews/_BACKLOG.md').text()
    expect(actual).toBe(expected)
  })

  test('covers every review document', async () => {
    const reviews = await collectReviews()
    expect(reviews).toHaveLength(18)
    expect(reviews.every((review) => review.findings.length > 0)).toBe(true)
  })

  test('excludes reference and generated files', () => {
    expect(isReviewDocument('MembersSection.md')).toBe(true)
    expect(isReviewDocument('RUBRIC.md')).toBe(false)
    expect(isReviewDocument('_TEMPLATE.md')).toBe(false)
    expect(isReviewDocument('_BACKLOG.md')).toBe(false)
  })
})

describe('license header byte-identity', () => {
  test('matches the literals the stamper builds its markdown header from', async () => {
    const stamper = await Bun.file('scripts/add-license-headers.ts').text()
    for (const line of LICENSE_HEADER_LINES) {
      if (line === '<!--' || line === '-->' || line.startsWith('Copyright')) continue
      expect(stamper).toContain(`'${line}'`)
    }
    expect(stamper).toContain('`Copyright (c) ${year} ${COPYRIGHT_HOLDER}`')
  })
})
```

The second suite is the drift guard the spec calls for. `add-license-headers.ts` calls `await main()` at module scope, so it cannot be imported — reading it as text is the available way to pin the two definitions together.

- [ ] **Step 6: Run the full test file**

Run: `bun test tests/scripts/ux-backlog.test.ts`

Expected: PASS. Then deliberately break currency to confirm the gate bites:

```bash
printf '\n' >> docs/ux-reviews/_BACKLOG.md
bun test tests/scripts/ux-backlog.test.ts 2>&1 | tail -5
bun run ux:backlog
```

Expected: the currency test FAILS on the appended newline, then passes again after regenerating. If it does not fail, the test is vacuous — fix it before proceeding.

- [ ] **Step 7: Commit**

```bash
bun run lint && bun run typecheck && bun run format
git add scripts/ux-backlog.ts package.json docs/ux-reviews/_BACKLOG.md tests/scripts/ux-backlog.test.ts
git commit -m "feat(scripts): generate the UX findings backlog with a currency gate"
```

---

## Task 4: Update the ux-review skill

**Files:**

- Modify: `.claude/skills/ux-review/SKILL.md`

**Interfaces:**

- Consumes: the record shape (Task 1) and `bun run ux:backlog` (Task 3).
- Produces: the procedure Tasks 5–8 follow.

Without this, the next review reverts to the old format and the parser throws.

- [ ] **Step 1: Widen the hard gate to permit story-only edits**

In the `<HARD-GATE>` block, replace the "Allowed outputs" sentence with:

```markdown
Allowed outputs: markdown under `docs/ux-reviews/`; **`*.stories.svelte` files and `tests/visual/**`
when a state the rubric requires has no story to capture it**; reading any repo file; running
`bun shoot` / `bun shoot:gen` to capture screenshots; reading the resulting PNGs. Applying findings
is a separate, human-initiated step in a separate session.
```

The prohibition on component, CSS, and `src/` edits is unchanged.

- [ ] **Step 2: Document the record fields**

In step 5 of the Procedure ("Write the findings doc"), after the existing sentence, add:

```markdown
   Each finding carries `**Id:**` and `**Status:**` as its first two bullets. `Id` is kebab-case,
   section-prefixed, assigned by hand, never derived from the heading, and never reused. `Status` is
   `open`, `fixed`, or `superseded`; the latter two require a `**Resolved:**` line naming the commit
   or sub-project. There is no `partial` — a partially-fixed finding stays `open` with its text
   narrowed to the residue, keeping its id.
```

- [ ] **Step 3: Add the re-review procedure**

After the Procedure section, add:

````markdown
## Re-reviewing an already-reviewed section

When `docs/ux-reviews/<Section>.md` already exists, the review is a re-verification, not a fresh
pass. Everything in the Procedure still applies, plus:

- **Read the shared primitives the section consumes**, not just its own file. Most fixes so far
  landed in `Btn`, `Field`, `Input`, and the shared state components — a section can have findings
  closed by a change that never touched its source. Reading only the section's own file reports
  those as still open.
- **Walk every existing finding by id.** For each: confirm it still reproduces (leave `open`), or
  set `fixed`/`superseded` with a `Resolved:` line, or narrow its text to what remains and keep it
  `open` under the same id. Never delete a finding and never reuse its id.
- **Re-score all nine dimensions** from what you see now, not from the previous scorecard.
- **Severity is re-assignable.** A High may legitimately become a Low if the surrounding UI improved.
- Add new findings with fresh ids.
- Set `**Date:**` to today — it means *last reviewed*.
- Regenerate and commit:

```bash
bun run ux:backlog
bun run format
```
````

- [ ] **Step 4: Commit**

```bash
bun run format
git add .claude/skills/ux-review/SKILL.md
git commit -m "docs(skill): teach ux-review the finding record and re-review procedure"
```

---

## Tasks 5–8: The re-review batches

All four batches follow one procedure; only the section list differs. Batches are ordered by open-High count so the highest-signal sections are re-verified first.

| Task | Sections | Highs |
| --- | --- | --- |
| 5 | `ReposSection`, `DebugApp`, `CodeHostSection`, `KaneoAccessSection`, `IdentitySection` | 4, 4, 4, 3, 3 |
| 6 | `MemorySection`, `McpSection`, `GuestModeSection`, `GroupProviderSection`, `CodingIdentitySection` | 2 each |
| 7 | `ToolsSection`, `TaskProviderSection`, `ReleaseSubscriptionSection`, `MembersSection` | 1 each |
| 8 | `CodingCredentialsSection`, `ByokSection`, `ProfileSection`, `AiOutputSection` | 1, 1, 0, 0 |

**Prerequisite for every batch:** Storybook running (`bun storybook`), kept warm.

**Interfaces:** each batch consumes the record shape, the skill procedure, and `bun run ux:backlog`; each produces updated documents plus a regenerated `_BACKLOG.md`.

**Note on `DebugApp` (Task 5):** its review is the most stale in the corpus. The `origin/master` merge at `ff10474e4` rewrote 41 files under `client/`, including `TurnDetail`, `SessionCard`, `SessionsList`, `ScopeFilter`, `TreeView`, `DataTable`, and `SummaryList` — the turn-detail panel changed from a raw JSON tree to a formatted summary. Expect a high `fixed`/`superseded` rate there, and read the current source rather than the finding's recorded line numbers, which have moved.

### Per-section steps (repeat for each section in the batch)

- [ ] **Step 1: Re-shoot the section**

Run: `bun shoot -g <Section>`

This overwrites existing baselines, which is correct here: the audit floor is re-established at the end of the batch, and nothing under test is being changed by the review itself.

- [ ] **Step 2: Add any missing states**

If a rubric-required state has no story, add it — `*.stories.svelte` and the manual region of `tests/visual/**/<Section>.spec.ts` (below `// @generated-end auto-screenshots`) only. New story fixtures follow sub-project D's MSW namespacing; a handler that collides with another section's makes the story render differently depending on test order. Then re-shoot.

- [ ] **Step 3: Read shots and source together**

Read the PNGs under `.storybook-shots/**/<Section>.spec.ts/` and the component source **plus every shared primitive it imports**. Skipping the primitives is the failure mode this whole project exists to correct.

- [ ] **Step 4: Walk every finding by id**

For each finding in `docs/ux-reviews/<Section>.md`, set its status per the skill's re-review procedure. Keep ids stable; never delete a finding.

- [ ] **Step 5: Re-score and update the header**

Re-score all nine dimensions; update `**Date:**` to today and `**States captured:**` if it changed.

### Per-batch steps (once, after all sections in the batch)

- [ ] **Step 6: Regenerate the backlog**

Run: `bun run ux:backlog`

Expected: still `18 sections, N findings`, where N is 159 plus any new findings this batch added.

- [ ] **Step 7: Run the gate**

Run: `bun test tests/scripts/ux-backlog.test.ts`

Expected: PASS. A parser throw here names the exact file and heading — fix the document, not the parser.

- [ ] **Step 8: Re-establish the visual floor**

Run: `bun run visual:audit`

Expected: `458 + <stories added this batch>` passed, 0 failed. State the number in the commit body. A failure that is not explained by a story this batch added is a real regression — investigate before committing.

- [ ] **Step 9: Format and commit**

```bash
bun run format
git add docs/ux-reviews/ client/ tests/visual/
git commit -m "docs(ux-reviews): re-verify batch N (<sections>)"
```

---

## Verification of the whole plan

- [ ] `bun test tests/scripts/ux-backlog.test.ts` — passes
- [ ] `bun run ux:backlog` — clean regeneration, no diff afterward
- [ ] `bun run license:headers` — no diff on `_BACKLOG.md`
- [ ] `bun run visual:audit` — 0 failures at the batch-adjusted floor
- [ ] `bun run check` — lint, typecheck, format, license headers all green
- [ ] Every finding in all 18 documents has an `Id` and a `Status`; every non-`open` status has a `Resolved:` line
- [ ] `_BACKLOG.md` answers "what UX work is left?" in one read
