// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  baseFixture,
  evidenceId,
  iso,
  longRangeFixture,
  makeRawEvent,
  semanticFixture,
  temporalFixture,
} from './corpus-fixture-core.js'
import type { CorpusCell, RawEventOptions, ScenarioFixture } from './corpus-fixture-core.js'
import { graphFixture } from './corpus-graph-fixture.js'
import type { SliceLabel } from './types.js'

const lexicalFixture = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
  base: ScenarioFixture,
): ScenarioFixture => {
  const identifier = cell.language === 'ru' ? 'RUS-418' : 'QXZ-418'
  return {
    ...base,
    events: [
      makeRawEvent({
        suffix,
        tag: 'target',
        scope,
        language: cell.language,
        eventTime: iso(1, 10, 9),
        content:
          cell.language === 'ru'
            ? `Архивная запись ${identifier} подтверждает тестовый допуск.`
            : `Archive record ${identifier} confirms synthetic clearance.`,
      }),
    ],
    queryText:
      cell.language === 'ru' ? `Что подтверждает запись ${identifier}?` : `What does record ${identifier} confirm?`,
    expectedEvidenceIds: [evidenceId(suffix, 'target')],
  }
}

const missingEmbeddingFixture = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
  base: ScenarioFixture,
): ScenarioFixture => {
  const identifier = cell.language === 'ru' ? 'RUV-731' : 'ZXQ-731'
  const target = makeRawEvent({
    suffix,
    tag: 'target',
    scope,
    language: cell.language,
    eventTime: iso(1, 10, 9),
    available: false,
    content:
      cell.language === 'ru'
        ? `Маркер ${identifier} подтверждает разрешение запуска.`
        : `Marker ${identifier} confirms launch authorization.`,
  })
  const distractor = makeRawEvent({
    suffix,
    tag: 'distractor',
    scope,
    language: cell.language,
    eventTime: iso(1, 11, 9),
    content:
      cell.language === 'ru'
        ? 'Маркер сообщает, что разрешение запуска активно.'
        : 'Marker says launch authorization is active.',
  })
  return {
    ...base,
    events: [target, distractor],
    queryText:
      cell.language === 'ru'
        ? `Найдите запись, где маркер ${identifier} сообщает, что разрешение запуска активно.`
        : `Find the record where marker ${identifier} says launch authorization is active.`,
    expectedEvidenceIds: [evidenceId(suffix, 'target')],
    forbiddenEvidenceIds: [evidenceId(suffix, 'distractor')],
  }
}

const erasedFixture = (suffix: string, scope: RawEventOptions['scope'], base: ScenarioFixture): ScenarioFixture => ({
  ...base,
  expectedEvidenceIds: [],
  erasedEvidenceIds: [evidenceId(suffix, 'target')],
  forgetRequests: [
    {
      kind: 'evidence',
      scope,
      evidenceIds: [evidenceId(suffix, 'target')],
      completedAt: iso(2, 1, 10),
    },
  ],
})

const abstentionFixture = (cell: CorpusCell, base: ScenarioFixture): ScenarioFixture => ({
  ...base,
  expectedEvidenceIds: [],
  forbiddenEvidenceIds: base.events.map(({ evidenceId: id }) => String(id)),
  queryText:
    cell.language === 'ru' ? 'Есть ли запись о фиолетовом дирижабле?' : 'Is there a record of a purple airship?',
})

const guestFixture = (suffix: string, base: ScenarioFixture): ScenarioFixture => ({
  ...base,
  actorRole: 'guest',
  expectedEvidenceIds: [],
  forbiddenEvidenceIds: [evidenceId(suffix, 'target')],
})

const crossScopeFixture = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
  base: ScenarioFixture,
): ScenarioFixture => {
  const foreignScope = {
    kind: scope.kind === 'personal' ? 'group' : 'personal',
    id: `${scope.kind === 'personal' ? 'group' : 'personal'}-foreign-${suffix}`,
  } as const
  const foreign = makeRawEvent({
    suffix,
    tag: 'foreign',
    scope: foreignScope,
    language: cell.language,
    eventTime: iso(1, 11, 9),
    content:
      cell.language === 'ru' ? 'Чужой срок проекта установлен на пятницу.' : 'A foreign project deadline is Friday.',
  })
  return {
    ...base,
    events: [base.events[0]!, foreign],
    forbiddenEvidenceIds: [evidenceId(suffix, 'foreign')],
  }
}

export const selectFixture = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
  label: SliceLabel,
): ScenarioFixture => {
  const base = baseFixture(cell, suffix, scope)
  if (label === 'long-range') return longRangeFixture(cell, suffix, scope)
  if (label === 'knowledge-update' || label === 'temporal-conflict') return temporalFixture(cell, suffix, scope)
  if (label === 'semantic-paraphrase') return semanticFixture(cell, suffix, scope)
  if (label === 'graph-multi-hop') return graphFixture(cell, suffix, scope)
  if (label === 'lexical-exact') return lexicalFixture(cell, suffix, scope, base)
  if (label === 'missing-embedding') return missingEmbeddingFixture(cell, suffix, scope, base)
  if (label === 'erasure-non-recapture') return erasedFixture(suffix, scope, base)
  if (label === 'abstention') return abstentionFixture(cell, base)
  if (label === 'guest-visibility') return guestFixture(suffix, base)
  if (label === 'cross-scope') return crossScopeFixture(cell, suffix, scope, base)
  return base
}
