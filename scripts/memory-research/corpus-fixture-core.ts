// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DETERMINISTIC_EMBEDDING_VERSION } from './types.js'

export type CorpusCell = Readonly<{
  kind: 'personal' | 'group'
  language: 'en' | 'ru'
}>

export type RawEventOptions = Readonly<{
  suffix: string
  tag: string
  scope: Readonly<{ kind: 'personal' | 'group'; id: string }>
  language: 'en' | 'ru'
  eventTime: string
  ingestTime?: string
  content: string
  available?: boolean
  validTo?: string | null
  entities?: readonly Readonly<{
    entityId: string
    type: string
    name: string
    aliases: readonly string[]
  }>[]
  relations?: readonly Readonly<{
    relationId: string
    sourceEntityId: string
    targetEntityId: string
    type: string
    validity: Readonly<{ validFrom: string; validTo: string | null }>
  }>[]
}>

export type ScenarioFixture = Readonly<{
  events: readonly Record<string, unknown>[]
  queryText: string
  queryTime: string
  expectedEvidenceIds: readonly string[]
  forbiddenEvidenceIds: readonly string[]
  erasedEvidenceIds: readonly string[]
  actorRole: 'owner' | 'member' | 'guest'
  forgetRequests: readonly Record<string, unknown>[]
}>

export const iso = (month: number, day: number, hour = 0): string =>
  new Date(Date.UTC(2026, month, day, hour)).toISOString()

export const evidenceId = (suffix: string, tag: string): string => `evidence-${suffix}-${tag}`

const eventId = (suffix: string, tag: string): string => `event-${suffix}-${tag}`

export const makeRawEvent = (options: RawEventOptions): Record<string, unknown> => ({
  eventId: eventId(options.suffix, options.tag),
  evidenceId: evidenceId(options.suffix, options.tag),
  scope: options.scope,
  language: options.language,
  eventTime: options.eventTime,
  ingestTime: options.ingestTime ?? options.eventTime,
  content: options.content,
  type: options.relations === undefined ? 'fact' : 'relationship',
  threadId: options.scope.kind === 'group' ? `thread-${options.suffix}` : null,
  entities: options.entities ?? [],
  relations: options.relations ?? [],
  validity: {
    validFrom: options.eventTime,
    validTo: options.validTo ?? null,
  },
  embedding: {
    available: options.available ?? true,
    version: options.available === false ? null : DETERMINISTIC_EMBEDDING_VERSION,
  },
})

const defaultQuestion = (language: 'en' | 'ru'): string =>
  language === 'ru' ? 'Какой день указан для срока проекта?' : 'Which day is the project due?'

const updateContent = (language: 'en' | 'ru', current: boolean): string =>
  language === 'ru'
    ? `Срок проекта перенесен на ${current ? 'вторник' : 'понедельник'}.`
    : `The project is due on ${current ? 'Tuesday' : 'Monday'}.`

export const baseFixture = (cell: CorpusCell, suffix: string, scope: RawEventOptions['scope']): ScenarioFixture => {
  const target = makeRawEvent({
    suffix,
    tag: 'target',
    scope,
    language: cell.language,
    eventTime: iso(1, 10, 9),
    content: cell.language === 'ru' ? 'Срок проекта установлен на вторник.' : 'The project deadline is Tuesday.',
  })
  const distractor = makeRawEvent({
    suffix,
    tag: 'distractor',
    scope,
    language: cell.language,
    eventTime: iso(1, 12, 9),
    content:
      cell.language === 'ru'
        ? 'Для тестовой кухни заказан зеленый чай.'
        : 'Green tea was ordered for the test kitchen.',
  })
  return {
    events: [target, distractor],
    queryText: defaultQuestion(cell.language),
    queryTime: iso(2, 1, 12),
    expectedEvidenceIds: [evidenceId(suffix, 'target')],
    forbiddenEvidenceIds: [],
    erasedEvidenceIds: [],
    actorRole: cell.kind === 'group' ? 'member' : 'owner',
    forgetRequests: [],
  }
}

export const temporalFixture = (cell: CorpusCell, suffix: string, scope: RawEventOptions['scope']): ScenarioFixture => {
  const transition = iso(2, 10, 10)
  return {
    ...baseFixture(cell, suffix, scope),
    events: [
      makeRawEvent({
        suffix,
        tag: 'prior',
        scope,
        language: cell.language,
        eventTime: iso(1, 1, 8),
        content: updateContent(cell.language, false),
        validTo: transition,
      }),
      makeRawEvent({
        suffix,
        tag: 'current',
        scope,
        language: cell.language,
        eventTime: transition,
        content: updateContent(cell.language, true),
      }),
    ],
    queryText:
      cell.language === 'ru' ? 'На какой день теперь назначен срок проекта?' : 'On which day is the project now due?',
    queryTime: iso(2, 20, 12),
    expectedEvidenceIds: [evidenceId(suffix, 'current')],
    forbiddenEvidenceIds: [evidenceId(suffix, 'prior')],
  }
}

export const semanticFixture = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
): ScenarioFixture => ({
  ...baseFixture(cell, suffix, scope),
  events: [
    makeRawEvent({
      suffix,
      tag: 'target',
      scope,
      language: cell.language,
      eventTime: iso(1, 10, 9),
      content: cell.language === 'ru' ? 'Поставка отправляется во вторник.' : 'Shipment departs Tuesday.',
    }),
    makeRawEvent({
      suffix,
      tag: 'distractor',
      scope,
      language: cell.language,
      eventTime: iso(1, 11, 9),
      content: cell.language === 'ru' ? 'Кофе хранится рядом с океаном.' : 'Coffee is stored beside the ocean.',
    }),
  ],
  queryText: cell.language === 'ru' ? 'Когда доставка будет отослана?' : 'When is delivery sent?',
  expectedEvidenceIds: [evidenceId(suffix, 'target')],
  forbiddenEvidenceIds: [evidenceId(suffix, 'distractor')],
})

export const longRangeFixture = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
): ScenarioFixture => {
  const target = makeRawEvent({
    suffix,
    tag: 'target',
    scope,
    language: cell.language,
    eventTime: iso(0, 2, 8),
    content:
      cell.language === 'ru' ? 'Старый план назначил выпуск на вторник.' : 'The old plan scheduled launch for Tuesday.',
  })
  const intervening = Array.from({ length: 5 }, (_, index) =>
    makeRawEvent({
      suffix,
      tag: `intervening-${index + 1}`,
      scope,
      language: cell.language,
      eventTime: iso(index + 1, 5, 9),
      content:
        cell.language === 'ru'
          ? `Промежуточная заметка номер ${index + 1} о тестовом складе.`
          : `Intervening note ${index + 1} about the synthetic warehouse.`,
    }),
  )
  return {
    ...baseFixture(cell, suffix, scope),
    events: [target, ...intervening],
    queryText:
      cell.language === 'ru'
        ? 'Когда по старому плану должен был состояться выпуск?'
        : 'When was the launch scheduled in the old plan?',
    queryTime: iso(6, 20, 12),
    expectedEvidenceIds: [evidenceId(suffix, 'target')],
  }
}
