// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CheckBehind } from './commit-attempt.js'
import { recordFixAttempt, recordNeedsHuman, type LedgerIssueRecord } from './issue-ledger.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { getIssueSpans, type FixerResult } from './issue-schema.js'
import { emitFixComplete, truncate } from './loop-trace.js'
import { emitDecision } from './progress-log.js'
import {
  exposureKind,
  tallyCheckBehind,
  tallyDecision,
  tallyExposure,
  tallyFixerSeverity,
  type RoundCollector,
} from './round-collector.js'

export interface BatchMember {
  readonly record: LedgerIssueRecord
  readonly fixerResult: FixerResult
}

/** A batch whose fixer claimed `fixed` on at least one member, awaiting round-level verification. */
export interface FixedBatch {
  readonly members: readonly BatchMember[]
  /** Files this batch's changes are attributed to: issue spans ∪ fixer `targetFiles`. */
  readonly claims: ReadonlySet<string>
}

/** One claimed-fixed member and whether round-level verification has already decided it. */
export interface MemberVerification {
  readonly member: BatchMember
  done: boolean
}

export interface BatchVerification {
  readonly members: readonly MemberVerification[]
  /** Files this batch's changes are attributed to: issue spans ∪ fixer `targetFiles`. */
  readonly claims: ReadonlySet<string>
}

export const liveMembersOf = (batch: BatchVerification): readonly MemberVerification[] =>
  batch.members.filter((m) => !m.done)

export const liveClaimsOf = (batch: BatchVerification): ReadonlySet<string> =>
  new Set(liveMembersOf(batch).flatMap((m) => [...claimedFilesOf([m.member])]))

export const findMember = (batches: readonly BatchVerification[], id: string): MemberVerification | undefined =>
  batches.flatMap((b) => b.members).find((mv) => mv.member.record.id === id)

export const claimedFilesOf = (members: readonly BatchMember[]): ReadonlySet<string> =>
  new Set(members.flatMap((m) => [...getIssueSpans(m.record.issue).map((s) => s.file), ...m.fixerResult.targetFiles]))

/** The tallies every fixer outcome owes regardless of which phase decided it. */
const tallyFixerOutcome = (collector: RoundCollector, member: BatchMember): void => {
  tallyFixerSeverity(collector, member.fixerResult.severity)
  tallyExposure(collector, exposureKind(member.record.issue.exposure), exposureKind(member.fixerResult.exposure))
}

export function rejectMember(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  member: BatchMember,
  reasoning: string,
  decision: 'needs_human' | 'inspector_rejected',
): void {
  recordNeedsHuman(deps.ledger, deps.trace, round, member.record, reasoning, member.fixerResult)
  tallyDecision(collector, decision, false)
  tallyFixerOutcome(collector, member)
  emitDecision(deps.log, member.record, 'needs_human', truncate(reasoning, 120))
  emitFixComplete(deps.trace, round, member.record.id, false, null, 1)
}

export function noCommitMember(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  member: BatchMember,
): void {
  collector.decisions.no_commit += 1
  tallyFixerOutcome(collector, member)
  emitDecision(deps.log, member.record, 'no_commit', 'fixed:true was a false claim')
  emitFixComplete(deps.trace, round, member.record.id, false, null, 1)
}

export function acceptMember(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  member: BatchMember,
  checkBehind: CheckBehind,
  postSha: string,
): void {
  recordFixAttempt(deps.ledger, member.record.id)
  tallyCheckBehind(collector, checkBehind, member.record.issue.kind)
  tallyDecision(collector, 'valid', true)
  tallyFixerOutcome(collector, member)
  emitDecision(deps.log, member.record, 'fixed')
  emitFixComplete(deps.trace, round, member.record.id, true, postSha, 1)
}
