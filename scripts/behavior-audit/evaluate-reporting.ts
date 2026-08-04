// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import type { Progress } from './progress.js'
import { buildSummary, collectStoryEvaluations, loadPriorSnapshot } from './report-rebuild-helpers.js'
import {
  type FailedItem,
  type DomainSummary,
  writeIndexFile,
  writeStoryFile,
  type ConsolidatedBehavior,
  type StoryEvaluation,
} from './report-writer.js'
import type { ScoresFile } from './scores-types.js'
import { groupConsolidatedByDomain, writeScoresJson } from './scores-writer.js'

interface WriteReportsInput {
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedBehavior[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
  readonly progress: Progress
}

function buildFailedItems(progress: Progress): readonly FailedItem[] {
  return Object.entries(progress.phase3.failedConsolidatedIds).map(([consolidatedId, entry]) => ({
    testFile: consolidatedId,
    testName: consolidatedId,
    error: entry.error,
    attempts: entry.attempts,
  }))
}

async function writeStoryReports(
  evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
  scores: ScoresFile,
): Promise<void> {
  await Promise.all(
    [...evaluationsByDomain.entries()].map(([domain, evaluations]) =>
      writeStoryFile(
        domain,
        [...evaluations].toSorted((a, b) => a.testName.localeCompare(b.testName)),
        scores,
      ),
    ),
  )
}

function buildSummaries(
  evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
): readonly DomainSummary[] {
  return [...evaluationsByDomain.entries()]
    .map(([domain, evaluations]) => buildSummary(domain, evaluations))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))
}

export async function writeReports(input: WriteReportsInput): Promise<void> {
  const { evaluationsByDomain, flawFreq, improvementFreq } = collectStoryEvaluations({
    consolidatedByFeatureKey: input.consolidatedByFeatureKey,
    evaluatedByFeatureKey: input.evaluatedByFeatureKey,
  })
  const consolidatedByDomain = groupConsolidatedByDomain(input.consolidatedByFeatureKey)
  const prior = await loadPriorSnapshot()
  const scores = await writeScoresJson(consolidatedByDomain, evaluationsByDomain, prior)
  await writeStoryReports(evaluationsByDomain, scores)
  const summaries = buildSummaries(evaluationsByDomain)

  await writeIndexFile(
    summaries,
    input.progress.phase3.stats.consolidatedIdsDone,
    input.progress.phase3.stats.consolidatedIdsFailed,
    flawFreq,
    improvementFreq,
    buildFailedItems(input.progress),
    scores,
  )
}
