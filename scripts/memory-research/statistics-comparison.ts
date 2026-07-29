// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CandidateObservationSet } from './statistics.js'

const sameSliceAssignment = (candidate: CandidateObservationSet, comparator: CandidateObservationSet): boolean =>
  candidate.rows.length === comparator.rows.length &&
  candidate.rows.every((candidateRow, index) => {
    const comparatorRow = comparator.rows[index]
    return (
      comparatorRow !== undefined &&
      candidateRow.slices.length === comparatorRow.slices.length &&
      candidateRow.slices.every((slice, sliceIndex) => slice === comparatorRow.slices[sliceIndex])
    )
  })

export const comparisonIdentityErrors = (
  candidate: CandidateObservationSet,
  comparator: CandidateObservationSet,
): readonly string[] => {
  const identityKeys = [
    'scenarioManifestVersion',
    'scenarioManifestSha256',
    'selectionSha256',
    'split',
    'scale',
    'seed',
  ] as const
  const identityErrors = identityKeys
    .filter((key) => candidate.identity[key] !== comparator.identity[key])
    .map((key) => `comparison identity mismatch: ${key}`)
  const candidateKeys = candidate.rows.map(({ scenarioId, queryId }) => `${scenarioId}\u0000${queryId}`)
  const comparatorKeys = comparator.rows.map(({ scenarioId, queryId }) => `${scenarioId}\u0000${queryId}`)
  const duplicateErrors =
    new Set(candidateKeys).size === candidateKeys.length && new Set(comparatorKeys).size === comparatorKeys.length
      ? []
      : ['comparison query keys must be unique']
  const orderingErrors =
    candidateKeys.length === comparatorKeys.length && candidateKeys.every((key, index) => key === comparatorKeys[index])
      ? []
      : ['comparison query keys or ordering differ']
  const sliceAssignmentErrors = sameSliceAssignment(candidate, comparator)
    ? []
    : ['comparison per-query slice assignments differ']
  return [...identityErrors, ...duplicateErrors, ...orderingErrors, ...sliceAssignmentErrors]
}
