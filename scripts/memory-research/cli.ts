// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolve } from 'node:path'

import { MemoryAgentBenchCompetencySchema, PublicDatasetIdSchema, PublicDatasetProfileSchema } from './importers.js'
import type { PublicDatasetFileImportRequest, PublicDatasetProfile } from './importers.js'
import { CandidateIdSchema, ScaleProfileSchema } from './types.js'
import type { CandidateId, MemoryScenario, RunManifest } from './types.js'

export type MemoryResearchCliOptions = Readonly<{
  split: MemoryScenario['split']
  candidateIds: readonly CandidateId[]
  scale: RunManifest['scale']
  seed: number
  output: string
  overwrite: boolean
  publicDataset: PublicDatasetFileImportRequest | null
}>

const valueFlags = new Set(['--split', '--candidate', '--scale', '--seed', '--output', '--public-dataset'])

const memBenchProfiles = [
  'membench-participation-factual-v1',
  'membench-participation-reflective-v1',
  'membench-observation-factual-v1',
  'membench-observation-reflective-v1',
] as const

type MemBenchProfile = (typeof memBenchProfiles)[number]

const isMemBenchProfile = (profile: PublicDatasetProfile): profile is MemBenchProfile =>
  memBenchProfiles.some((candidate) => candidate === profile)

const parseSplit = (value: string): MemoryScenario['split'] => {
  if (value === 'dev' || value === 'development') return 'development'
  if (value === 'test' || value === 'sealed' || value === 'sealed-test') {
    return 'sealed-test'
  }
  throw new Error(`Invalid split: ${value}`)
}

const parseCandidates = (value: string): readonly CandidateId[] => {
  if (value === 'all') {
    return ['as-shipped', 'corrected-hybrid', 'hierarchical', 'temporal-graph']
  }
  const parsed = value.split(',').map((candidate) => CandidateIdSchema.safeParse(candidate))
  if (parsed.some((candidate) => !candidate.success)) {
    throw new Error(`Invalid candidate list: ${value}`)
  }
  const candidates = parsed.flatMap((candidate) => (candidate.success ? [candidate.data] : []))
  if (candidates.length === 0 || new Set(candidates).size !== candidates.length) {
    throw new Error('Candidate list must be nonempty and unique')
  }
  return candidates
}

const parseScale = (value: string): RunManifest['scale'] => {
  const parsed = ScaleProfileSchema.safeParse(Number(value))
  if (!parsed.success) throw new Error(`Invalid scale: ${value}`)
  if (parsed.data === 100_000) {
    throw new Error('Scale 100000 requires the frozen research:memory:storage protocol')
  }
  return parsed.data
}

const parseSeed = (value: string): number => {
  const seed = Number(value)
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`Invalid seed: ${value}`)
  return seed
}

const parsePublicDataset = (value: string): PublicDatasetFileImportRequest => {
  const [datasetValue, profileValue, path, competencyValue, ...extra] = value.split('|')
  const dataset = PublicDatasetIdSchema.safeParse(datasetValue)
  const profile = PublicDatasetProfileSchema.safeParse(profileValue)
  if (!dataset.success || !profile.success || path === undefined || path.length === 0 || extra.length > 0) {
    throw new Error('Invalid public dataset spec; expected dataset|profile|path[|competency]')
  }
  if (dataset.data === 'longmemeval' && profile.data === 'longmemeval-cleaned-v1' && competencyValue === undefined) {
    return { datasetId: dataset.data, profile: profile.data, path }
  }
  if (dataset.data === 'locomo' && profile.data === 'locomo-10-v1' && competencyValue === undefined) {
    return { datasetId: dataset.data, profile: profile.data, path }
  }
  if (dataset.data === 'memoryagentbench' && profile.data === 'memoryagentbench-current-v1') {
    const competency = MemoryAgentBenchCompetencySchema.safeParse(competencyValue)
    if (competency.success) {
      return {
        datasetId: dataset.data,
        profile: profile.data,
        path,
        competencySplit: competency.data,
      }
    }
  }
  if (dataset.data === 'membench' && isMemBenchProfile(profile.data) && competencyValue === undefined) {
    return {
      datasetId: dataset.data,
      profile: profile.data,
      path,
    }
  }
  throw new Error(`Dataset/profile/competency combination is invalid: ${value}`)
}

const argumentValues = (args: readonly string[]): ReadonlyMap<string, string | true> => {
  const values = new Map<string, string | true>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument !== '--overwrite' && !valueFlags.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`)
    if (argument === '--overwrite') {
      values.set(argument, true)
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`)
    }
    values.set(argument, value)
    index += 1
  }
  return values
}

const stringValue = (values: ReadonlyMap<string, string | true>, flag: string, fallback: string): string => {
  const value = values.get(flag)
  return typeof value === 'string' ? value : fallback
}

export const parseMemoryResearchArgs = (args: readonly string[]): MemoryResearchCliOptions => {
  const values = argumentValues(args)
  const publicValue = values.get('--public-dataset')
  const split = parseSplit(stringValue(values, '--split', 'sealed-test'))
  const candidateIds = parseCandidates(stringValue(values, '--candidate', 'all'))
  const scale = parseScale(stringValue(values, '--scale', '1000'))
  const seed = parseSeed(stringValue(values, '--seed', '20260723'))
  const explicitOutput = values.get('--output')
  const canonicalCandidates = ['as-shipped', 'corrected-hybrid', 'hierarchical', 'temporal-graph']
  if (
    explicitOutput === undefined &&
    (seed !== 20_260_723 ||
      JSON.stringify(candidateIds) !== JSON.stringify(canonicalCandidates) ||
      typeof publicValue === 'string')
  ) {
    throw new Error('A custom seed, candidate set, or public dataset requires an explicit --output path')
  }
  const runKind = split === 'development' ? 'dev' : 'sealed'
  const output =
    typeof explicitOutput === 'string'
      ? explicitOutput
      : `docs/research/agent-memory/raw/v3-20260723/${runKind}-${String(scale)}/component.json`
  const publisherPaths = ['docs/research/agent-memory/04-results.json', 'docs/research/agent-memory/04-results.md'].map(
    (path) => resolve(path),
  )
  if (publisherPaths.includes(resolve(output))) {
    throw new Error('The canonical 04-results output paths are reserved for the research:memory:publish publisher')
  }
  return {
    split,
    candidateIds,
    scale,
    seed,
    output,
    overwrite: values.get('--overwrite') === true,
    publicDataset: typeof publicValue === 'string' ? parsePublicDataset(publicValue) : null,
  }
}

export {
  publishResearchOutputs,
  releaseResearchOutputReservation,
  reserveResearchOutputs,
  writeResearchOutputs,
} from './cli-output.js'
export type { ResearchOutputReservation } from './cli-output.js'
