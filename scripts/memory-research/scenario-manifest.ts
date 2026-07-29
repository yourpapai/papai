// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { z } from 'zod'

import { memoryScenarios, MEMORY_CORPUS_GENERATOR_SEED, MEMORY_CORPUS_GENERATOR_VERSION } from './corpus.js'
import { MemoryScenarioSchema } from './types.js'
import type { MemoryScenario } from './types.js'

export const SCENARIO_MANIFEST_VERSION = 'memory-scenario-manifest-v3'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const cellKeys = ['personal:en', 'personal:ru', 'group:en', 'group:ru'] as const
type CellKey = (typeof cellKeys)[number]

type SplitCounts = Readonly<{
  development: number
  sealedTest: number
}>

interface CanonicalObject {
  readonly [key: string]: CanonicalValue
}

type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | CanonicalObject

const cellSplitCountSchema = z
  .object({
    development: z.number().int().nonnegative(),
    sealedTest: z.number().int().nonnegative(),
  })
  .strict()
  .readonly()

export const ScenarioManifestSchema = z
  .object({
    scenarioManifestVersion: z.literal(SCENARIO_MANIFEST_VERSION),
    scenarioManifestSha256: sha256Schema,
    scenarioCount: z.number().int().nonnegative(),
    splitCounts: cellSplitCountSchema,
    balanceCounts: z
      .object({
        'personal:en': z.number().int().nonnegative(),
        'personal:ru': z.number().int().nonnegative(),
        'group:en': z.number().int().nonnegative(),
        'group:ru': z.number().int().nonnegative(),
      })
      .strict()
      .readonly(),
    cellSplitCounts: z
      .object({
        'personal:en': cellSplitCountSchema,
        'personal:ru': cellSplitCountSchema,
        'group:en': cellSplitCountSchema,
        'group:ru': cellSplitCountSchema,
      })
      .strict()
      .readonly(),
    generatorSeed: z.number().int().nonnegative(),
    generatorVersion: z.string().min(1),
  })
  .strict()
  .readonly()

export type ScenarioManifest = z.infer<typeof ScenarioManifestSchema>
type ScenarioManifestBody = Omit<ScenarioManifest, 'scenarioManifestSha256'>

const canonicalizeObject = (value: object): CanonicalObject =>
  Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )

const canonicalize = (value: unknown): CanonicalValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') return canonicalizeObject(value)
  if (typeof value === 'bigint' || typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return Function.prototype.toString.call(value)
  return 'undefined'
}

export const canonicalSerialize = (value: unknown): string => JSON.stringify(canonicalize(value))

const orderedScenarios = (scenarios: readonly MemoryScenario[]): readonly MemoryScenario[] =>
  [...scenarios].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const canonicalScenarioPayload = (scenarios: readonly MemoryScenario[]): CanonicalValue =>
  canonicalize({
    scenarioManifestVersion: SCENARIO_MANIFEST_VERSION,
    generatorSeed: MEMORY_CORPUS_GENERATOR_SEED,
    generatorVersion: MEMORY_CORPUS_GENERATOR_VERSION,
    scenarios: orderedScenarios(scenarios),
  })

const scenarioDigest = (scenarios: readonly MemoryScenario[]): string =>
  createHash('sha256')
    .update(canonicalSerialize(canonicalScenarioPayload(scenarios)), 'utf8')
    .digest('hex')

const cellKey = (scenario: MemoryScenario): CellKey => `${scenario.primaryScope.kind}:${scenario.language}`

const scenariosInCell = (scenarios: readonly MemoryScenario[], key: CellKey): readonly MemoryScenario[] =>
  scenarios.filter((scenario) => cellKey(scenario) === key)

const splitCounts = (scenarios: readonly MemoryScenario[]): SplitCounts => ({
  development: scenarios.filter(({ split }) => split === 'development').length,
  sealedTest: scenarios.filter(({ split }) => split === 'sealed-test').length,
})

const idsInCorpus = (scenarios: readonly MemoryScenario[]): readonly string[] =>
  scenarios.flatMap((scenario) => [
    scenario.scenarioId,
    ...scenario.events.flatMap(({ eventId, evidenceId }) => [eventId, evidenceId]),
    ...scenario.queries.map(({ queryId }) => queryId),
  ])

const requiredSlices = [
  'direct-fact',
  'long-range',
  'knowledge-update',
  'temporal-conflict',
  'lexical-exact',
  'semantic-paraphrase',
  'missing-embedding',
  'graph-multi-hop',
  'duplicate-out-of-order',
  'restart-rebuild',
  'erasure-non-recapture',
  'abstention',
  'guest-visibility',
  'cross-scope',
] as const

const cellInvariantErrors = (scenarios: readonly MemoryScenario[], key: CellKey): readonly string[] => {
  const cell = scenariosInCell(scenarios, key)
  const counts = splitCounts(cell)
  return [
    ...(cell.length === 60 ? [] : [`expected 60 scenarios in ${key}, received ${cell.length}`]),
    ...(counts.development === 15
      ? []
      : [`expected 15 development scenarios in ${key}, received ${counts.development}`]),
    ...(counts.sealedTest === 45 ? [] : [`expected 45 sealed-test scenarios in ${key}, received ${counts.sealedTest}`]),
  ]
}

export const validateCorpusInvariants = (scenarios: readonly MemoryScenario[]): readonly string[] => {
  const ids = idsInCorpus(scenarios)
  const labels = new Set(scenarios.flatMap(({ labels: values }) => values))
  return [
    ...(scenarios.length === 240 ? [] : [`expected 240 scenarios, received ${scenarios.length}`]),
    ...cellKeys.flatMap((key) => cellInvariantErrors(scenarios, key)),
    ...(new Set(ids).size === ids.length ? [] : ['scenario/event/evidence/query ids must be globally unique']),
    ...requiredSlices.filter((slice) => !labels.has(slice)).map((slice) => `required slice is absent: ${slice}`),
  ]
}

const cellRecord = <Value>(valueFor: (key: CellKey) => Value): Readonly<Record<CellKey, Value>> => ({
  'personal:en': valueFor('personal:en'),
  'personal:ru': valueFor('personal:ru'),
  'group:en': valueFor('group:en'),
  'group:ru': valueFor('group:ru'),
})

const manifestWithoutDigest = (scenarios: readonly MemoryScenario[]): ScenarioManifestBody => ({
  scenarioManifestVersion: SCENARIO_MANIFEST_VERSION,
  scenarioCount: scenarios.length,
  splitCounts: splitCounts(scenarios),
  balanceCounts: cellRecord((key) => scenariosInCell(scenarios, key).length),
  cellSplitCounts: cellRecord((key) => splitCounts(scenariosInCell(scenarios, key))),
  generatorSeed: MEMORY_CORPUS_GENERATOR_SEED,
  generatorVersion: MEMORY_CORPUS_GENERATOR_VERSION,
})

export const createScenarioManifest = (scenarios: readonly MemoryScenario[]): ScenarioManifest => {
  const errors = validateCorpusInvariants(scenarios)
  if (errors.length > 0) {
    throw new Error(`Invalid memory corpus: ${errors.join('; ')}`)
  }
  return ScenarioManifestSchema.parse({
    ...manifestWithoutDigest(scenarios),
    scenarioManifestSha256: scenarioDigest(scenarios),
  })
}

export type ManifestVerification = Readonly<{ valid: true }> | Readonly<{ valid: false; errors: readonly string[] }>

const compareManifest = (actual: ScenarioManifest, expected: ScenarioManifest): readonly string[] => [
  ...(actual.scenarioCount === expected.scenarioCount ? [] : ['scenario count mismatch']),
  ...(actual.scenarioManifestSha256 === expected.scenarioManifestSha256 ? [] : ['scenario digest mismatch']),
  ...(canonicalSerialize(actual.splitCounts) === canonicalSerialize(expected.splitCounts)
    ? []
    : ['split counts mismatch']),
  ...(canonicalSerialize(actual.balanceCounts) === canonicalSerialize(expected.balanceCounts)
    ? []
    : ['balance counts mismatch']),
  ...(canonicalSerialize(actual.cellSplitCounts) === canonicalSerialize(expected.cellSplitCounts)
    ? []
    : ['cell split counts mismatch']),
  ...(actual.generatorSeed === expected.generatorSeed ? [] : ['generator seed mismatch']),
  ...(actual.generatorVersion === expected.generatorVersion ? [] : ['generator version mismatch']),
]

export const verifyScenarioManifest = (
  manifest: unknown,
  scenarios: readonly MemoryScenario[],
): ManifestVerification => {
  const parsedManifest = ScenarioManifestSchema.safeParse(manifest)
  const parsedScenarios = z.array(MemoryScenarioSchema).safeParse(scenarios)
  const manifestErrors = parsedManifest.success ? [] : ['invalid scenario manifest']
  const invariantErrors = parsedScenarios.success
    ? validateCorpusInvariants(parsedScenarios.data)
    : ['invalid scenario corpus']
  if (!parsedManifest.success || !parsedScenarios.success || invariantErrors.length > 0) {
    return Object.freeze({ valid: false, errors: [...manifestErrors, ...invariantErrors] })
  }

  const expected = createScenarioManifest(parsedScenarios.data)
  const errors = compareManifest(parsedManifest.data, expected)
  return errors.length === 0 ? Object.freeze({ valid: true }) : Object.freeze({ valid: false, errors })
}

export const FROZEN_SCENARIO_MANIFEST_SHA256 = '283044dbd97c119b5b76a639f4f28792e4ff12cc0bdc73e6a81761b083bb12f7'

const computedFrozenScenarioManifest = createScenarioManifest(memoryScenarios)
if (computedFrozenScenarioManifest.scenarioManifestSha256 !== FROZEN_SCENARIO_MANIFEST_SHA256) {
  throw new Error(
    `Frozen memory corpus digest changed: expected ${FROZEN_SCENARIO_MANIFEST_SHA256}, received ${computedFrozenScenarioManifest.scenarioManifestSha256}. Bump the corpus and protocol versions before accepting new sealed results.`,
  )
}

export const FROZEN_SCENARIO_MANIFEST = computedFrozenScenarioManifest
