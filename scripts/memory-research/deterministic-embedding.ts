// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DETERMINISTIC_EMBEDDING_DIMENSION } from './types.js'

export { DETERMINISTIC_EMBEDDING_DIMENSION, DETERMINISTIC_EMBEDDING_VERSION } from './types.js'

export const DETERMINISTIC_CONCEPT_ALIASES = {
  project: ['project', 'projects', 'проект', 'проекта', 'проекту'],
  deadline: ['deadline', 'due', 'must', 'срок', 'дедлайн', 'должна'],
  tuesday: ['tuesday', 'tue', 'вторник', 'вторника'],
  delivery: ['shipment', 'delivery', 'поставка', 'доставка'],
  send: ['departs', 'sent', 'отправляется', 'отослана'],
  'time-question': ['when', 'когда'],
  coffee: ['coffee', 'кофе'],
  tea: ['tea', 'чай'],
  meeting: ['meeting', 'встреча', 'встречи'],
  city: ['city', 'город'],
  lives: ['lives', 'live', 'живет'],
  preference: ['prefers', 'предпочитает'],
} as const

const conceptEntries = Object.entries(DETERMINISTIC_CONCEPT_ALIASES).flatMap(([concept, aliases]) =>
  aliases.map((alias) => [alias, concept] as const),
)

const bilingualConcepts: ReadonlyMap<string, string> = new Map(conceptEntries)

export const deterministicTokens = (text: string): readonly string[] =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replaceAll('ё', 'е')
    .match(/[\p{L}\p{N}]+/gu) ?? []

const fnv1a = (value: string): number =>
  [...new TextEncoder().encode(value)].reduce((hash, byte) => Math.imul(hash ^ byte, 16_777_619) >>> 0, 2_166_136_261)

const addFeature = (vector: number[], key: string, weight: number): void => {
  const hash = fnv1a(key)
  const index = hash % DETERMINISTIC_EMBEDDING_DIMENSION
  const sign = (hash & 0x80000000) === 0 ? 1 : -1
  vector[index] = (vector[index] ?? 0) + sign * weight
}

const normalizeVector = (vector: readonly number[]): readonly number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return norm === 0
    ? Array.from({ length: DETERMINISTIC_EMBEDDING_DIMENSION }, (_, index) => (index === 0 ? 1 : 0))
    : vector.map((value) => value / norm)
}

export const deterministicEmbedding = (text: string): readonly number[] => {
  const vector = Array.from({ length: DETERMINISTIC_EMBEDDING_DIMENSION }, () => 0)
  deterministicTokens(text).forEach((token) => {
    const concept = bilingualConcepts.get(token)
    addFeature(vector, `lexical:${token}`, concept === undefined ? 0.5 : 0.2)
    if (concept !== undefined) addFeature(vector, `concept:${concept}`, 2)
  })
  return normalizeVector(vector)
}

export const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  const dimension = Math.min(left.length, right.length)
  if (dimension === 0) return 0
  let dot = 0
  let leftSquared = 0
  let rightSquared = 0
  for (let index = 0; index < dimension; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftSquared += leftValue * leftValue
    rightSquared += rightValue * rightValue
  }
  const leftNorm = Math.sqrt(leftSquared)
  const rightNorm = Math.sqrt(rightSquared)
  const denominator = leftNorm * rightNorm
  return denominator === 0 ? 0 : dot / denominator
}
