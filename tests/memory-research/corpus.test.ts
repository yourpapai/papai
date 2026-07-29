// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createScaleDistractors,
  MEMORY_CORPUS_GENERATOR_SEED,
  MEMORY_CORPUS_GENERATOR_VERSION,
  memoryScenarios,
} from '../../scripts/memory-research/corpus.js'
import {
  cosineSimilarity,
  deterministicEmbedding,
  deterministicTokens,
  DETERMINISTIC_EMBEDDING_DIMENSION,
  DETERMINISTIC_EMBEDDING_VERSION,
} from '../../scripts/memory-research/deterministic-embedding.js'
import { MemoryScenarioSchema } from '../../scripts/memory-research/types.js'
import type { MemoryEvent, MemoryScenario, SliceLabel } from '../../scripts/memory-research/types.js'

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

type CorpusLanguage = 'en' | 'ru'
type CorpusScopeKind = 'personal' | 'group'

const scenariosForCell = (kind: CorpusScopeKind, language: CorpusLanguage): readonly MemoryScenario[] =>
  memoryScenarios.filter((scenario) => scenario.primaryScope.kind === kind && scenario.language === language)

const findScenario = (language: CorpusLanguage, label: SliceLabel): MemoryScenario => {
  const scenario = memoryScenarios.find(
    ({ labels, language: scenarioLanguage }) => scenarioLanguage === language && labels.includes(label),
  )
  if (scenario === undefined) {
    throw new Error(`Missing ${language} scenario for ${label}`)
  }
  return scenario
}

const hasDescendingAdjacentValue = (values: readonly number[]): boolean =>
  values.some((epoch, index) => index > 0 && epoch < values[index - 1]!)

const words = (value: string): ReadonlySet<string> => new Set(value.toLowerCase().match(/\p{L}+/gu) ?? [])

const firstEvent = (events: Iterable<MemoryEvent>): MemoryEvent => {
  for (const event of events) {
    return event
  }
  throw new Error('Expected at least one generated event')
}

const unrelatedTextByLanguage: Readonly<Record<CorpusLanguage, string>> = {
  en: 'Coffee grows beside the ocean.',
  ru: 'Кофе растет у океана.',
}

describe('deterministic embedding', () => {
  test('is stable, finite, fixed-dimension, and unit-normalized including empty input', () => {
    for (const sample of ['', 'Project deadline is Tuesday', 'Срок проекта во вторник']) {
      const first = deterministicEmbedding(sample)
      const second = deterministicEmbedding(sample)
      const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))

      expect(first).toEqual(second)
      expect(first).toHaveLength(DETERMINISTIC_EMBEDDING_DIMENSION)
      expect(first.every(Number.isFinite)).toBeTrue()
      expect(norm).toBeCloseTo(1, 10)
    }
    expect(DETERMINISTIC_EMBEDDING_VERSION).toMatch(/^papai-deterministic-/u)
  })

  test('relates controlled bilingual paraphrases more than unrelated text', () => {
    const english = deterministicEmbedding('The project deadline is Tuesday')
    const russian = deterministicEmbedding('Срок проекта во вторник')
    const unrelated = deterministicEmbedding('Coffee beans and ocean weather')

    expect(cosineSimilarity(english, russian)).toBeGreaterThan(cosineSimilarity(english, unrelated))
    expect(cosineSimilarity(english, russian)).toBeGreaterThan(0.45)
  })
})

describe('deterministic memory corpus', () => {
  test('contains exactly 240 balanced scenarios with stable generator identity', () => {
    expect(memoryScenarios).toHaveLength(240)
    expect(MEMORY_CORPUS_GENERATOR_SEED).toBe(20260723)
    expect(MEMORY_CORPUS_GENERATOR_VERSION).toBe('memory-corpus-v3')
    expect(memoryScenarios.every((scenario) => MemoryScenarioSchema.safeParse(scenario).success)).toBeTrue()

    for (const kind of ['personal', 'group'] as const) {
      for (const language of ['en', 'ru'] as const) {
        const cell = scenariosForCell(kind, language)
        expect(cell).toHaveLength(60)
        expect(cell.filter((scenario) => scenario.split === 'development')).toHaveLength(15)
        expect(cell.filter((scenario) => scenario.split === 'sealed-test')).toHaveLength(45)
      }
    }
  })

  test('materializes version-change and genuinely out-of-order duplicate fault schedules', () => {
    const versionChange = memoryScenarios.find(({ faults }) => faults.embeddingVersionChanges.length > 0)!
    const duplicate = memoryScenarios.find(({ labels }) => labels.includes('duplicate-out-of-order'))!
    const orderedEvents = duplicate.faults.ingestOrder.map((eventId) =>
      duplicate.events.find((event) => event.eventId === eventId),
    )
    const ingestEpochs = orderedEvents.map((event) => Date.parse(event!.ingestTime))

    expect(versionChange.faults.embeddingVersionChanges).toEqual([
      {
        evidenceId: versionChange.events[0]!.evidenceId,
        fromVersion: DETERMINISTIC_EMBEDDING_VERSION,
        toVersion: 'papai-deterministic-bilingual-v2',
        changedAt: '2026-03-01T10:00:00.000Z',
      },
    ])
    expect(duplicate.faults.duplicateEvidenceIds).toEqual([duplicate.events[0]!.evidenceId])
    expect(duplicate.faults.ingestOrder.filter((id) => id === duplicate.events[0]!.eventId)).toHaveLength(2)
    expect(hasDescendingAdjacentValue(ingestEpochs)).toBeTrue()
  })

  test('has globally unique stable ids and every preregistered slice', () => {
    const ids = memoryScenarios.flatMap((scenario) => [
      scenario.scenarioId,
      ...scenario.events.flatMap((event) => [event.eventId, event.evidenceId]),
      ...scenario.queries.map((query) => query.queryId),
    ])
    const labels = new Set(memoryScenarios.flatMap((scenario) => scenario.labels))

    expect(new Set(ids).size).toBe(ids.length)
    expect(requiredSlices.every((slice) => labels.has(slice))).toBeTrue()
    expect(
      memoryScenarios.every((scenario) => {
        const corpusText = [
          ...scenario.events.map(({ content }) => content),
          ...scenario.queries.map(({ text: queryText }) => queryText),
        ]
          .join(' ')
          .toLowerCase()
        return scenario.labels.every((label) => !corpusText.includes(label))
      }),
    ).toBeTrue()
  })

  test('uses evidence-bearing fixtures for temporal, graph, and long-range slices', () => {
    const temporal = memoryScenarios.find(({ labels }) => labels.includes('temporal-conflict'))!
    const graph = memoryScenarios.find(({ labels }) => labels.includes('graph-multi-hop'))!
    const longRange = memoryScenarios.find(({ labels }) => labels.includes('long-range'))!

    const temporalExpected = temporal.queries[0]!.expectedEvidenceIds[0]!
    const temporalCurrent = temporal.events.find(({ evidenceId }) => evidenceId === temporalExpected)!
    const temporalPrior = temporal.events.find(({ evidenceId }) => evidenceId !== temporalExpected)!
    expect(temporalPrior.content).not.toBe(temporalCurrent.content)
    expect(temporalPrior.validity.validTo).toBe(temporalCurrent.validity.validFrom)

    const graphExpected = graph.queries[0]!.expectedEvidenceIds[0]!
    const graphLeaf = graph.events.find(({ evidenceId }) => evidenceId === graphExpected)!
    const graphSeed = graph.events.find(({ evidenceId }) => evidenceId !== graphExpected)!
    expect(graph.events).toHaveLength(2)
    expect(graphSeed.relations).toHaveLength(1)
    expect(graphLeaf.relations).toHaveLength(1)
    expect(graphSeed.relations[0]!.targetEntityId).toBe(graphLeaf.relations[0]!.sourceEntityId)
    expect(graphSeed.content.toLowerCase()).toContain('alex')
    expect(graphLeaf.content.toLowerCase()).not.toContain('alex')
    expect(graph.queries[0]!.expectedEvidenceIds).toEqual([graphLeaf.evidenceId])
    expect(
      graph.events.every((event) => event.relations[0]!.validity.validFrom === event.validity.validFrom),
    ).toBeTrue()

    for (const language of ['en', 'ru'] as const) {
      const languageGraph = findScenario(language, 'graph-multi-hop')
      const languageExpected = languageGraph.queries[0]!.expectedEvidenceIds[0]!
      const languageLeaf = languageGraph.events.find(({ evidenceId }) => evidenceId === languageExpected)!
      const languageSeed = languageGraph.events.find(({ evidenceId }) => evidenceId !== languageExpected)!
      const queryTokens = new Set(deterministicTokens(languageGraph.queries[0]!.text))
      const seedOverlap = deterministicTokens(languageSeed.content).filter((token) => queryTokens.has(token))
      const leafOverlap = deterministicTokens(languageLeaf.content).filter((token) => queryTokens.has(token))

      expect(seedOverlap.length).toBeGreaterThan(0)
      expect(leafOverlap).toEqual([])
    }

    const longRangeExpected = longRange.queries[0]!.expectedEvidenceIds[0]!
    const longRangeLeaf = longRange.events.find(({ evidenceId }) => evidenceId === longRangeExpected)!
    const ageMs = Date.parse(longRange.queries[0]!.queryTime) - Date.parse(longRangeLeaf.eventTime)
    expect(ageMs).toBeGreaterThan(120 * 24 * 60 * 60 * 1_000)
    expect(longRange.events.length).toBeGreaterThanOrEqual(6)
  })

  test('uses declared equivalent concepts for lexical-free EN/RU semantic paraphrases', () => {
    expect(
      cosineSimilarity(deterministicEmbedding('shipment departs'), deterministicEmbedding('delivery sent')),
    ).toBeGreaterThan(0.9)
    expect(
      cosineSimilarity(deterministicEmbedding('поставка отправляется'), deterministicEmbedding('доставка отослана')),
    ).toBeGreaterThan(0.9)

    for (const language of ['en', 'ru'] as const) {
      const scenario = findScenario(language, 'semantic-paraphrase')
      const expectedId = scenario.queries[0]!.expectedEvidenceIds[0]!
      const leaf = scenario.events.find(({ evidenceId }) => evidenceId === expectedId)!
      const distractor = scenario.events.find(({ evidenceId }) => evidenceId !== expectedId)!
      const leafWords = words(leaf.content)
      const queryWords = words(scenario.queries[0]!.text)
      const queryEmbedding = deterministicEmbedding(scenario.queries[0]!.text)
      const leafSimilarity = cosineSimilarity(deterministicEmbedding(leaf.content), queryEmbedding)
      const distractorSimilarity = cosineSimilarity(deterministicEmbedding(distractor.content), queryEmbedding)
      const unrelatedSimilarity = cosineSimilarity(
        deterministicEmbedding(unrelatedTextByLanguage[language]),
        queryEmbedding,
      )

      expect([...leafWords].filter((word) => queryWords.has(word))).toEqual([])
      expect(leafSimilarity).toBeGreaterThan(distractorSimilarity)
      expect(leafSimilarity).toBeGreaterThan(unrelatedSimilarity)
      expect(scenario.queries[0]!.forbiddenEvidenceIds).toContain(distractor.evidenceId)
    }
  })

  test('forces the shipped semantic-only branch while preserving lexical recovery', () => {
    const scenario = findScenario('en', 'missing-embedding')
    const query = scenario.queries[0]!
    const relevant = scenario.events.find(({ evidenceId }) => query.expectedEvidenceIds.includes(evidenceId))!
    const distractor = scenario.events.find(({ evidenceId }) => evidenceId !== relevant.evidenceId)!
    const identifier = relevant.content.match(/[A-Z]{3}-\d{3}/u)?.[0]

    expect(relevant.embedding).toEqual({ available: false, version: null })
    expect(identifier).toBeDefined()
    expect(query.text).toContain(identifier!)
    expect(relevant.content).toContain(identifier!)
    expect(distractor.embedding.available).toBeTrue()
    expect(distractor.content).not.toContain(identifier!)
    expect(
      cosineSimilarity(deterministicEmbedding(query.text), deterministicEmbedding(distractor.content)),
    ).toBeGreaterThan(0.65)
    expect(query.forbiddenEvidenceIds).toContain(distractor.evidenceId)
  })

  test('uses a rare ASCII identifier for lexical-exact recovery', () => {
    const scenario = findScenario('en', 'lexical-exact')
    const query = scenario.queries[0]!
    const relevant = scenario.events.find(({ evidenceId }) => query.expectedEvidenceIds.includes(evidenceId))!
    const identifier = relevant.content.match(/[A-Z]{3}-\d{3}/u)?.[0]

    expect(identifier).toBeDefined()
    expect(query.text).toContain(identifier!)
  })

  test('generates repeatable scale distractors lazily at every registered scale', () => {
    for (const scale of [1_000, 10_000, 100_000] as const) {
      const options = {
        scale,
        scope: { kind: 'group', id: 'group-scale-synthetic' },
        language: 'ru',
        seed: 71,
      } as const
      const iterable = createScaleDistractors(options)
      const first = firstEvent(iterable)
      const repeated = firstEvent(createScaleDistractors(options))

      expect(Array.isArray(iterable)).toBeFalse()
      expect(first).toEqual(repeated)
      expect(first?.eventId).toContain(`scale-${scale}`)
      expect(Array.from(createScaleDistractors(options))).toHaveLength(scale)
    }
  })

  test('scopes scale identities and validates all options before iteration', () => {
    const common = {
      scale: 1_000,
      language: 'en',
      seed: 19,
    } as const
    const first = firstEvent(
      createScaleDistractors({
        ...common,
        scope: { kind: 'group', id: 'group-scale-alpha' },
      }),
    )
    const second = firstEvent(
      createScaleDistractors({
        ...common,
        scope: { kind: 'group', id: 'group-scale-beta' },
      }),
    )

    expect(first.eventId).not.toBe(second.eventId)
    expect(first.evidenceId).not.toBe(second.evidenceId)
    expect(() =>
      createScaleDistractors({
        ...common,
        scope: { kind: 'group', id: 'group-scale-alpha' },
        seed: -1,
      }),
    ).toThrow()
  })
})
