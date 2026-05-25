// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PieceCandidate, PieceSource, PieceStatus, PieceType } from './architecture-inventory-model.js'
import { slugifyPieceName } from './architecture-inventory-model.js'

export interface TopDownDiscoveryInput {
  readonly readme: string
  readonly claude: string
  readonly roadmap: string
  readonly packageJson: Readonly<{
    workspaces: readonly string[] | undefined
    scripts: Readonly<Record<string, string>> | undefined
  }>
}

export interface FilesystemDiscoveryInput {
  readonly topLevelEntries: readonly string[]
  readonly srcEntries: readonly string[]
  readonly clientEntries: readonly string[]
  readonly scriptEntries: readonly string[]
  readonly testEntries: readonly string[]
  readonly historicalDocEntries: readonly string[]
}

export interface CandidateSeed {
  readonly name: string
  readonly type: PieceType
  readonly status: PieceStatus
  readonly summary: string
  readonly declaredPaths: readonly string[]
  readonly tags: readonly string[]
}

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)]

export const uniqueCandidates = (candidates: readonly PieceCandidate[]): readonly PieceCandidate[] => [
  ...candidates
    .reduce((accumulator, candidate) => {
      const key = `${slugifyPieceName(candidate.name)}:${candidate.type}`
      const existing = accumulator.get(key)
      if (existing === undefined) {
        accumulator.set(key, candidate)
        return accumulator
      }

      accumulator.set(key, {
        ...existing,
        declaredPaths: uniqueStrings([...existing.declaredPaths, ...candidate.declaredPaths]),
        aliases: uniqueStrings([...existing.aliases, ...candidate.aliases]),
        tags: uniqueStrings([...existing.tags, ...candidate.tags]),
        sources: [...existing.sources, ...candidate.sources],
      })
      return accumulator
    }, new Map<string, PieceCandidate>())
    .values(),
]

export const seed = (
  name: string,
  type: PieceType,
  status: PieceStatus,
  summary: string,
  declaredPaths: readonly string[],
  tags: readonly string[],
): CandidateSeed => ({ name, type, status, summary, declaredPaths, tags })

export const makeCandidate = (candidateSeed: CandidateSeed, source: PieceSource): PieceCandidate => ({
  ...candidateSeed,
  aliases: [],
  sources: [source],
})

export const extractBacktickedPaths = (markdown: string): readonly string[] =>
  [...markdown.matchAll(/`([^`]+)`/gu)].flatMap((match) => {
    const value = match[1]
    return value === undefined || value.length === 0 ? [] : [value]
  })

export const matchRule = (
  value: string,
  rules: readonly (readonly [string, CandidateSeed])[],
  kind: PieceSource['kind'],
): PieceCandidate | null => {
  const matchedRule = rules.find(([fragment]) => value.includes(fragment))
  if (matchedRule === undefined) {
    return null
  }

  return makeCandidate(matchedRule[1], { kind, location: value })
}

const knownWorkspaceSeeds: Readonly<Record<string, CandidateSeed>> = {
  codeindex: seed(
    'codeindex workspace',
    'analysis-tool',
    'active',
    'codeindex workspace.',
    ['codeindex'],
    ['workspace'],
  ),
  'review-loop': seed(
    'review-loop workspace',
    'analysis-tool',
    'active',
    'review-loop workspace.',
    ['review-loop'],
    ['workspace'],
  ),
}

export const benchmarkScriptSeed = seed(
  'benchmark scripts',
  'analysis-tool',
  'experimental',
  'Advisory benchmark scripts and supporting scenarios.',
  ['scripts'],
  ['benchmark'],
)

export const candidateFromWorkspace = (workspace: string): PieceCandidate =>
  makeCandidate(knownWorkspaceSeeds[workspace]!, {
    kind: 'package-workspace',
    location: workspace,
  })

const candidateFromPackageScript = (name: string, command: string): PieceCandidate | null => {
  if (name.startsWith('audit:behavior') || command.includes('behavior-audit')) {
    return makeCandidate(
      seed(
        'behavior-audit scripts',
        'analysis-tool',
        'experimental',
        'Behavior-audit workflow scripts.',
        ['scripts/behavior-audit'],
        ['audit'],
      ),
      { kind: 'package-script', location: name },
    )
  }

  if (name.includes('benchmark') || command.includes('benchmark')) {
    return makeCandidate(benchmarkScriptSeed, { kind: 'package-script', location: name })
  }

  return null
}

export const workspaceCandidatesFrom = (workspaces: readonly string[] | undefined): readonly PieceCandidate[] =>
  workspaces === undefined
    ? []
    : workspaces.flatMap((workspace) =>
        knownWorkspaceSeeds[workspace] === undefined ? [] : [candidateFromWorkspace(workspace)],
      )

export const packageScriptCandidatesFrom = (
  scripts: Readonly<Record<string, string>> | undefined,
): readonly PieceCandidate[] =>
  scripts === undefined
    ? []
    : Object.entries(scripts).flatMap(([name, command]) => {
        const candidate = candidateFromPackageScript(name, command)
        return candidate === null ? [] : [candidate]
      })
