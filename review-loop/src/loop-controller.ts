// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { resolveInvocationText } from './available-commands.js'
import type { ReviewLoopConfig } from './config.js'
import { computeIssueFingerprint } from './issue-fingerprint.js'
import {
  applyReviewRound,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import { parseReviewerIssues, parseVerifierDecision } from './issue-schema.js'
import type { ProgressLog } from './progress-log.js'
import {
  buildFixPrompt,
  buildPlanningPrompt,
  buildReviewPrompt,
  buildRereviewPrompt,
  buildVerifyPrompt,
} from './prompt-templates.js'
import { saveRunState, type RunState } from './run-state.js'

export interface PromptingSession {
  availableCommands: string[]
  promptText(text: string): Promise<{ text: string; stopReason: string }>
}

export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  reviewer: PromptingSession
  fixer: PromptingSession
  log: ProgressLog
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
}

async function promptReviewerForIssues(
  promptBody: string,
  deps: ReviewLoopDeps,
): Promise<ReturnType<typeof parseReviewerIssues>> {
  const prompt = resolveInvocationText(
    deps.config.reviewer.invocationPrefix,
    deps.reviewer.availableCommands,
    promptBody,
    deps.config.reviewer.requireInvocationPrefix,
  )
  return parseReviewerIssues((await deps.reviewer.promptText(prompt)).text)
}

async function processIssueVerifyFix(
  record: LedgerIssueRecord,
  deps: ReviewLoopDeps,
): Promise<{ fixedThisIssue: boolean }> {
  const verifyPrompt = resolveInvocationText(
    deps.config.fixer.verifyInvocationPrefix,
    deps.fixer.availableCommands,
    buildVerifyPrompt(deps.runState.planPath, record.issue),
    deps.config.fixer.requireVerifyInvocation,
  )
  const verifyDecision = parseVerifierDecision((await deps.fixer.promptText(verifyPrompt)).text)
  recordVerification(deps.ledger, record.fingerprint, verifyDecision)
  deps.log.log(
    `[verify] "${truncate(record.issue.title, 60)}" \u2192 ${verifyDecision.verdict}${verifyDecision.verdict === 'valid' ? `, ${verifyDecision.fixability}` : ''}`,
  )

  if (verifyDecision.verdict === 'valid' && verifyDecision.fixability === 'auto') {
    let plan: string | undefined

    if (verifyDecision.needsPlanning) {
      const planningPrompt = resolveInvocationText(
        deps.config.fixer.fixInvocationPrefix,
        deps.fixer.availableCommands,
        buildPlanningPrompt(record.issue, verifyDecision),
        false,
      )
      plan = (await deps.fixer.promptText(planningPrompt)).text
    }

    const fixPrompt = resolveInvocationText(
      deps.config.fixer.fixInvocationPrefix,
      deps.fixer.availableCommands,
      buildFixPrompt(record.issue, verifyDecision, plan),
      false,
    )
    await deps.fixer.promptText(fixPrompt)
    recordFixAttempt(deps.ledger, record.fingerprint)
    deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" \u2192 fix applied (attempt ${record.fixAttempts})`)
    return { fixedThisIssue: true }
  }
  return { fixedThisIssue: false }
}

async function rereviewRound(round: number, deps: ReviewLoopDeps): Promise<ReturnType<typeof parseReviewerIssues>> {
  const rereviewResponse = await promptReviewerForIssues(
    buildRereviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
    deps,
  )

  const unresolvedFingerprints = new Set(rereviewResponse.issues.map((issue) => computeIssueFingerprint(issue)))
  applyReviewRound(deps.ledger, round, rereviewResponse.issues)

  for (const record of Object.values(deps.ledger.snapshot.issues)) {
    if (record.status === 'fixed_pending_review' && !unresolvedFingerprints.has(record.fingerprint)) {
      record.status = 'closed'
    }
  }

  return rereviewResponse
}

const TERMINAL_STATUSES = new Set<LedgerIssueRecord['status']>(['rejected', 'already_fixed', 'needs_human'])

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}\u2026`
}

async function processReviewRecords(records: readonly LedgerIssueRecord[], deps: ReviewLoopDeps): Promise<number> {
  const limit = pLimit(1)
  const verifiable = records.filter((r) => !TERMINAL_STATUSES.has(r.status))
  const results = await Promise.all(verifiable.map((record) => limit(() => processIssueVerifyFix(record, deps))))
  return results.filter(({ fixedThisIssue }) => fixedThisIssue).length
}

function formatSeveritySummary(records: readonly LedgerIssueRecord[]): string {
  const severityCounts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.issue.severity] = (acc[r.issue.severity] ?? 0) + 1
    return acc
  }, {})
  return Object.entries(severityCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([sev, count]) => `${count} ${sev}`)
    .join(', ')
}

function continueOrFinish(round: number, newNoProgressRounds: number, deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  if (newNoProgressRounds >= deps.config.maxNoProgressRounds) {
    deps.log.log(`[done] no_progress`)
    return Promise.resolve({
      doneReason: 'no_progress',
      rounds: round,
      ledger: deps.ledger.snapshot,
    })
  }

  if (round >= deps.config.maxRounds) {
    deps.log.log(`[done] max_rounds`)
    return Promise.resolve({
      doneReason: 'max_rounds',
      rounds: round,
      ledger: deps.ledger.snapshot,
    })
  }

  return runRound(round + 1, newNoProgressRounds, deps)
}

async function runRound(round: number, noProgressRounds: number, deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  deps.runState.currentRound = round
  deps.log.log(`[round ${round}/${deps.config.maxRounds}] Reviewing against plan...`)

  const reviewResponse = await promptReviewerForIssues(
    buildReviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
    deps,
  )
  const records = [...applyReviewRound(deps.ledger, round, reviewResponse.issues)]
  await saveIssueLedger(deps.ledger)

  if (records.length > 0) {
    deps.log.log(`[round ${round}] Found ${records.length} issues (${formatSeveritySummary(records)})`)
  } else {
    deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
    await saveRunState(deps.runState)
    return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
  }

  const fixedThisRound = await processReviewRecords(records, deps)
  deps.log.log(`[round ${round}] Fixed ${fixedThisRound}/${records.length} issues this round`)

  const rereviewResponse = await rereviewRound(round, deps)
  deps.log.log(`[round ${round}] Re-review: ${rereviewResponse.issues.length} issues remaining`)

  if (rereviewResponse.issues.length === 0) {
    deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
    await saveIssueLedger(deps.ledger)
    await saveRunState(deps.runState)
    return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
  }

  const newNoProgressRounds = fixedThisRound === 0 ? noProgressRounds + 1 : 0
  deps.runState.noProgressRounds = newNoProgressRounds
  await saveRunState(deps.runState)
  await saveIssueLedger(deps.ledger)

  if (fixedThisRound === 0) {
    deps.log.log(
      `[round ${round}] No issues fixed this round (stall count: ${newNoProgressRounds}/${deps.config.maxNoProgressRounds})`,
    )
  }

  return continueOrFinish(round, newNoProgressRounds, deps)
}

export function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  const nextRound = deps.runState.currentRound + 1
  if (nextRound > deps.config.maxRounds) {
    deps.log.log(`[done] max_rounds at round ${deps.runState.currentRound} \u2014 skipping`)
    return Promise.resolve({
      doneReason: 'max_rounds',
      rounds: deps.runState.currentRound,
      ledger: deps.ledger.snapshot,
    })
  }
  return runRound(nextRound, deps.runState.noProgressRounds, deps)
}
