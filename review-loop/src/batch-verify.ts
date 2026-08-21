// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  acceptMember,
  claimedFilesOf,
  findMember,
  liveClaimsOf,
  liveMembersOf,
  noCommitMember,
  rejectMember,
  type BatchVerification,
  type FixedBatch,
  type MemberVerification,
} from './batch-outcomes.js'
import { runAggregatedBuild } from './build-checker.js'
import { measureCheckBehind, type CheckBehind } from './commit-attempt.js'
import { runAggregatedInspectorOrTreatAsRejection } from './issue-inspector.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { sanitizeSubject } from './issue-processor.js'
import { truncate, emitBuildComplete } from './loop-trace.js'
import { tallyPhaseMs, tallyUsage, type RoundCollector } from './round-collector.js'
import type { Worker } from './worker-pool.js'
import { execGit } from './worktree.js'

interface CommittedBatch {
  readonly members: readonly MemberVerification[]
  readonly postSha: string
  readonly checkBehind: CheckBehind
}

const liveBatches = (batches: readonly BatchVerification[]): readonly BatchVerification[] =>
  batches.filter((b) => b.members.some((m) => !m.done))

const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => [...a].some((f) => b.has(f))

/**
 * Which files a failed build implicates: any changed or claimed file whose
 * path appears in the build output. An empty answer means the failure could
 * not be attributed, and the caller then implicates everyone — a build that
 * broke in a way nobody owns belongs to every batch that touched the tree.
 */
function implicatedFilesOf(
  build: { passed: boolean; stdout: string; stderr: string },
  changed: readonly string[],
  batches: readonly BatchVerification[],
): ReadonlySet<string> | null {
  if (build.passed) return new Set()
  const candidates = new Set([...changed, ...batches.flatMap((b) => [...b.claims])])
  const output = `${build.stdout}\n${build.stderr}`
  const implicated = new Set([...candidates].filter((f) => output.includes(f)))
  return implicated.size > 0 ? implicated : null
}

const changedFilesSince = async (worker: Worker, baseline: string): Promise<readonly string[]> =>
  (await execGit(worker.worktreePath, ['diff', '--name-only', baseline])).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

async function runBuildPhase(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  worker: Worker,
  batches: readonly BatchVerification[],
  changed: readonly string[],
): Promise<void> {
  const start = Date.now()
  const build = await runAggregatedBuild(deps.exec, deps.log, worker.worktreePath)
  const ms = Date.now() - start
  tallyPhaseMs(collector, 'build', ms)
  for (const batch of batches) {
    emitBuildComplete(deps.trace, round, batch.members[0]!.member.record.id, build.passed, 1, ms)
  }
  if (build.passed) return
  const implicated = implicatedFilesOf(build, changed, batches)
  for (const batch of batches) {
    // `null` is the unattributable case: a build nobody owns implicates
    // every batch that touched the tree.
    if (implicated !== null && !intersects(batch.claims, implicated)) continue
    const detail = `Aggregated build failed: ${truncate(build.stderr, 200)}`
    for (const m of liveMembersOf(batch)) {
      rejectMember(deps, round, collector, m.member, detail, 'needs_human')
      m.done = true
    }
  }
}

async function runInspectPhase(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  worker: Worker,
  batches: readonly BatchVerification[],
  baseline: string,
): Promise<void> {
  const inspectees = liveBatches(batches).flatMap((b) =>
    liveMembersOf(b).map((m) => ({ id: m.member.record.id, issue: m.member.record.issue })),
  )
  if (inspectees.length === 0 || deps.inspect === false) return
  const start = Date.now()
  const inspector = await runAggregatedInspectorOrTreatAsRejection(
    { config: deps.config, spawn: deps.spawn, log: deps.log, trace: deps.trace },
    worker.worktreePath,
    inspectees,
    baseline,
    round,
    deps.runState.runDir,
    deps.runState.logPath,
    collector,
  )
  tallyPhaseMs(collector, 'inspect', Date.now() - start)
  tallyUsage(collector, inspector.usage)
  for (const verdict of inspector.results) {
    if (verdict.addresses) continue
    const m = findMember(batches, verdict.id)
    if (m === undefined || m.done) continue
    rejectMember(
      deps,
      round,
      collector,
      m.member,
      `Inspector rejected: ${verdict.reasoning}`,
      inspector.kind === 'unavailable' ? 'needs_human' : 'inspector_rejected',
    )
    m.done = true
  }
}

/**
 * Batches share one worktree, so a surviving member whose files a decided
 * member (this batch or another) also claims cannot be committed alone:
 * `git add` stages the file's current content, rejected edits included.
 * Holding it back is the honest answer; next round's split retry produces
 * clean batches.
 */
function entangleSurvivorsWithRejectedClaims(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  batches: readonly BatchVerification[],
): void {
  const decidedClaims = new Set(
    batches.flatMap((b) => b.members.filter((m) => m.done).flatMap((m) => [...claimedFilesOf([m.member])])),
  )
  for (const batch of batches) {
    for (const m of liveMembersOf(batch)) {
      if (!intersects(claimedFilesOf([m.member]), decidedClaims)) continue
      rejectMember(
        deps,
        round,
        collector,
        m.member,
        'Changes entangled with a rejected batch in shared files; split retry next round',
        'needs_human',
      )
      m.done = true
    }
  }
}

/** Stages and commits one batch's claimed files; `null` when nothing could be committed. */
async function commitOneBatch(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  worker: Worker,
  batch: BatchVerification,
  changed: readonly string[],
): Promise<CommittedBatch | null> {
  const live = liveMembersOf(batch)
  const files = [...liveClaimsOf(batch)].filter((f) => changed.includes(f))
  if (files.length === 0) {
    for (const m of live) {
      noCommitMember(deps, round, collector, m.member)
      m.done = true
    }
    return null
  }
  const parent = await worker.headSha()
  await execGit(worker.worktreePath, ['add', '--', ...files])
  const subject = sanitizeSubject(`fix(review-loop): ${live[0]!.member.record.issue.title} (+${live.length})`)
  await execGit(worker.worktreePath, ['commit', '-m', subject])
  const postSha = await worker.headSha()
  if (postSha === parent) {
    for (const m of live) {
      noCommitMember(deps, round, collector, m.member)
      m.done = true
    }
    return null
  }
  const checkBehind = await measureCheckBehind(execGit, worker.worktreePath, parent)
  return { members: live, postSha, checkBehind }
}

async function commitSurvivingBatches(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  worker: Worker,
  batches: readonly BatchVerification[],
  changed: readonly string[],
): Promise<readonly CommittedBatch[]> {
  const committed: CommittedBatch[] = []
  // Sequential on purpose: each commit's parent is the previous batch's
  // commit, so the batches stack on one branch in cluster order.
  let chain: Promise<unknown> = Promise.resolve()
  for (const batch of liveBatches(batches)) {
    chain = chain.then(() =>
      commitOneBatch(deps, round, collector, worker, batch, changed).then((c) => {
        if (c !== null) committed.push(c)
      }),
    )
  }
  await chain
  // Discard every uncommitted leftover — rejected members' edits — while the
  // approved commits stay. This is also what makes the merge's rebase legal:
  // it refuses to run over a dirty tree.
  await worker.resetToBaseline(await worker.headSha())
  return committed
}

async function mergeCommittedBatches(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  worker: Worker,
  committed: readonly CommittedBatch[],
): Promise<number> {
  const start = Date.now()
  try {
    const merge = await deps.pool.mergeWorkerIntoPrimary(worker)
    if (!merge.ok) {
      const detail = `Merge conflict on ${merge.conflictFiles.join(', ')}`
      for (const { members } of committed) {
        for (const m of members) rejectMember(deps, round, collector, m.member, detail, 'needs_human')
      }
      return 0
    }
    let fixed = 0
    for (const { members, postSha, checkBehind } of committed) {
      for (const m of members) {
        acceptMember(deps, round, collector, m.member, checkBehind, postSha)
        fixed += 1
      }
    }
    return fixed
  } finally {
    tallyPhaseMs(collector, 'fix', Date.now() - start)
  }
}

/**
 * The round-level verification phase: one build and one inspector over the
 * aggregated working-tree diff, then a commit per surviving batch and a single
 * merge of the stacked commits — never a failing fix.
 */
export async function verifyAndMergeBatches(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  fixedBatches: readonly FixedBatch[],
): Promise<number> {
  const worker = await deps.pool.acquire(fixedBatches[0]!.members[0]!.record.issue.file)
  try {
    const batches: BatchVerification[] = fixedBatches.map((b) => ({
      members: b.members.map((member) => ({ member, done: false })),
      claims: b.claims,
    }))
    const baseline = await worker.headSha()
    await execGit(worker.worktreePath, ['add', '-N', '.'])
    const changed = await changedFilesSince(worker, baseline)
    if (changed.length === 0) {
      for (const batch of batches) {
        for (const m of batch.members) {
          noCommitMember(deps, round, collector, m.member)
          m.done = true
        }
      }
      return 0
    }
    await runBuildPhase(deps, round, collector, worker, batches, changed)
    await runInspectPhase(deps, round, collector, worker, batches, baseline)
    entangleSurvivorsWithRejectedClaims(deps, round, collector, batches)
    const committed = await commitSurvivingBatches(deps, round, collector, worker, batches, changed)
    if (committed.length === 0) return 0
    return await mergeCommittedBatches(deps, round, collector, worker, committed)
  } finally {
    deps.pool.release(worker)
  }
}
