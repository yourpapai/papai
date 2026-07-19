// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type EntryPointKind = 'command' | 'tool' | 'handler' | 'route'

export type ClosureStatus = 'resolved' | 'partial' | 'unresolved' | 'unverified'

export interface EntryPointEntry {
  readonly kind: EntryPointKind
  readonly identifier: string
  readonly resolved: boolean
  readonly evidence: { readonly filePath: string; readonly symbol?: string } | null
}

export interface EntryPointHint {
  readonly kind: EntryPointKind
  readonly identifier: string
}

export interface ClosureResult {
  readonly closureStatus: ClosureStatus
  readonly entryPoints: readonly EntryPointEntry[]
}

export interface PersonaScore {
  readonly discover: number
  readonly use: number
  readonly retain: number
}

export interface StoryEntry {
  readonly featureKey: string
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly userStory: string
  readonly composite: number
  readonly percentile: number
  readonly bottomDecile: boolean
  readonly maria: PersonaScore
  readonly dani: PersonaScore
  readonly viktor: PersonaScore
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly trendDelta: number | null
  readonly closureStatus: ClosureStatus
  readonly entryPoints: readonly EntryPointEntry[]
}

export interface DomainEntry {
  readonly domain: string
  readonly stories: readonly StoryEntry[]
}

export interface ScoresFile {
  readonly generatedAt: string
  readonly model: string
  readonly domains: readonly DomainEntry[]
}
