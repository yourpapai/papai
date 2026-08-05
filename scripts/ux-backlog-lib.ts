// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const SEVERITIES = ['High', 'Med', 'Low'] as const
const STATUSES = ['open', 'fixed', 'superseded', 'wont-fix', 'deferred'] as const

export type Severity = (typeof SEVERITIES)[number]
export type FindingStatus = (typeof STATUSES)[number]

/** Column headings for the roll-up table, one per member of `STATUSES`, in tuple order. */
const STATUS_LABELS: Record<FindingStatus, string> = {
  open: 'Open',
  fixed: 'Fixed',
  superseded: 'Superseded',
  'wont-fix': "Won't fix",
  deferred: 'Deferred',
}

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
// Trailing prose after the date is allowed: several documents annotate the line
// (e.g. "2026-07-02 (re-review against the expanded 9-dimension rubric)"). The date
// itself is still pinned to the start, which is what the roll-up reads.
const DATE = /^\*\*Date:\*\* (?<date>\d{4}-\d{2}-\d{2})\b/u
const ANCHOR = /`(?<anchor>[^`]+?:\d+)`/u

/**
 * The markdown license header exactly as `scripts/add-license-headers.ts` emits it.
 * `_BACKLOG.md` is both generated and stamped; if these two disagree by a byte the
 * stamper and the currency test rewrite each other forever.
 *
 * Known limitation: this only holds within a calendar year. `normalizeMdCopyrightLine`
 * (`scripts/add-license-headers.ts:188-202`) rewrites a single-year line into a
 * `startYear-currentYear` range once `currentYear > endYear`, whereas the single line here
 * only ever emits one year. If `bun run license:headers` stamps `_BACKLOG.md` in a year after
 * it was last regenerated, it produces a range and the currency test reports the file stale —
 * `bun run ux:backlog` reruns and resolves it, so this converges rather than looping forever.
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
    throw new Error(`${where}: Status must be one of ${STATUSES.join(', ')} (got "${status ?? ''}")`)
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

  const flush = (value: RawFinding | null): null => {
    if (value !== null) findings.push(toFinding(value, section, filename, seen))
    return null
  }

  for (const line of lines) {
    const heading = HEADING.exec(line)?.groups
    if (heading !== undefined) {
      current = flush(current)
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
  flush(current)

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
    const counts = STATUSES.map((status) => countBy(review, status))
    return `| ${review.section} | ${counts.join(' | ')} | ${review.date} |`
  })
  const total = (status: FindingStatus): number => sorted.reduce((sum, review) => sum + countBy(review, status), 0)

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
    `| Section | ${STATUSES.map((status) => STATUS_LABELS[status]).join(' | ')} | Last reviewed |`,
    `| ${Array.from({ length: STATUSES.length + 2 }, () => '---').join(' | ')} |`,
    ...rows,
    `| **Total** | ${STATUSES.map((status) => total(status)).join(' | ')} | — |`,
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
