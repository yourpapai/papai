// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createAsShippedCandidate } from './candidates/as-shipped.js'
import { createCorrectedHybridCandidate } from './candidates/corrected-hybrid.js'
import { createHierarchicalCandidate } from './candidates/hierarchical.js'
import { createTemporalGraphCandidate } from './candidates/temporal-graph.js'
import type { CandidateId, MemoryCandidateAdapter } from './types.js'

const factories = {
  'as-shipped': createAsShippedCandidate,
  'corrected-hybrid': createCorrectedHybridCandidate,
  hierarchical: createHierarchicalCandidate,
  'temporal-graph': createTemporalGraphCandidate,
} as const satisfies Readonly<Record<CandidateId, () => MemoryCandidateAdapter>>

export const candidateVersions = Object.freeze({
  'as-shipped': 'as-shipped-v1',
  'corrected-hybrid': 'corrected-hybrid-v1',
  hierarchical: 'hierarchical-v1',
  'temporal-graph': 'temporal-graph-v1',
} as const satisfies Readonly<Record<CandidateId, string>>)

export const createMemoryCandidate = (candidateId: CandidateId): MemoryCandidateAdapter => factories[candidateId]()

export const registeredCandidateIds: readonly CandidateId[] = Object.freeze([
  'as-shipped',
  'corrected-hybrid',
  'hierarchical',
  'temporal-graph',
])
