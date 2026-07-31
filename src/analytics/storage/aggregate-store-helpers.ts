// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type DailyAggregateKey = Readonly<{
  utcDay: string
  definitionVersion: number
  platform: string
  contextType: string
  actorRole: string
  taskProvider: string
  appVersion: string
  metric: string
}>

export type QualityDisclosure = Readonly<{
  finalized?: boolean
  partialDay?: boolean
  restartGapDetected?: boolean
  lateEventCount?: number
  reconciliationStatus?: 'complete_epoch' | 'unreconciled_restart_gap'
  disclosureScope: string
  contributorBasis: string
  contributorCount?: number | null
  threshold?: number | null
}>

export const buildQualityColumns = (input: QualityDisclosure): Record<string, unknown> => ({
  finalized: input.finalized ?? false,
  partialDay: input.partialDay ?? false,
  restartGapDetected: input.restartGapDetected ?? false,
  lateEventCount: input.lateEventCount ?? 0,
  reconciliationStatus: input.reconciliationStatus ?? 'complete_epoch',
  disclosureScope: input.disclosureScope,
  contributorBasis: input.contributorBasis,
  contributorCount: input.contributorCount ?? null,
  threshold: input.threshold ?? null,
})

export const arraysEqual = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])
