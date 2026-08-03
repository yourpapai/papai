// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LedgerIssueStatus } from './issue-ledger.js'

const CHECK = '✓'
const CROSS = '✗'
const DOT = '·'
const BANG = '!'

export function shortIssueId(id: string): string {
  return id.slice(0, 8)
}

export interface IssueRef {
  id: string
  severity: string
  file: string
  line: number
  title: string
}

export function formatIssueRef(ref: IssueRef): string {
  return `#${shortIssueId(ref.id)} ${`[${ref.severity}]`.padEnd(10)} ${ref.file}:${ref.line} — ${ref.title}`
}

export function formatFoundLine(ref: IssueRef): string {
  return `  + ${formatIssueRef(ref)}`
}

const DECIDED_MARK: Record<string, string> = {
  fixed: CHECK,
  invalid: CROSS,
  already_fixed: DOT,
  needs_human: BANG,
  plan_drift: BANG,
  no_commit: DOT,
}

const DECIDED_LABEL: Record<string, string> = {
  fixed: 'fixed',
  invalid: 'rejected',
  already_fixed: 'already fixed',
  needs_human: 'needs human',
  plan_drift: 'plan drift',
  no_commit: 'no change',
}

export function formatDecidedLine(args: { id: string; verdict: string; note?: string }): string {
  const mark = DECIDED_MARK[args.verdict] ?? DOT
  const label = DECIDED_LABEL[args.verdict] ?? args.verdict
  const note = args.note === undefined ? '' : ` (${args.note})`
  return `${mark} #${shortIssueId(args.id)} → ${label}${note}`
}

export type IssueGroup = 'needsHuman' | 'fixed' | 'rejected' | 'alreadyFixed' | 'open'

export const GROUP_ORDER: readonly IssueGroup[] = ['needsHuman', 'fixed', 'rejected', 'alreadyFixed', 'open']

export const GROUP_LABEL: Record<IssueGroup, string> = {
  needsHuman: 'needs human',
  fixed: 'fixed',
  rejected: 'rejected',
  alreadyFixed: 'already fixed',
  open: 'open',
}

export const GROUP_MARK: Record<IssueGroup, string> = {
  needsHuman: BANG,
  fixed: CHECK,
  rejected: CROSS,
  alreadyFixed: DOT,
  open: DOT,
}

export function groupForStatus(status: LedgerIssueStatus): IssueGroup {
  switch (status) {
    case 'needs_human':
      return 'needsHuman'
    case 'closed':
      return 'fixed'
    case 'rejected':
      return 'rejected'
    case 'already_fixed':
      return 'alreadyFixed'
    case 'discovered':
    case 'verified':
    case 'fixed_pending_review':
    case 'reopened':
      return 'open'
    default:
      throw new Error('Unhandled ledger issue status')
  }
}
