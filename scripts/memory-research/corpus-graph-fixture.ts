// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { baseFixture, evidenceId, iso, makeRawEvent } from './corpus-fixture-core.js'
import type { CorpusCell, RawEventOptions, ScenarioFixture } from './corpus-fixture-core.js'

type RelationValidity = Readonly<{ validFrom: string; validTo: null }>

const makeGraphSeed = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
  validity: RelationValidity,
): Record<string, unknown> =>
  makeRawEvent({
    suffix,
    tag: 'seed',
    scope,
    language: cell.language,
    eventTime: validity.validFrom,
    content: cell.language === 'ru' ? 'Алексей работает в команде Орион.' : 'Alex works on the Orion team.',
    entities: [
      {
        entityId: `entity-${suffix}-alex`,
        type: 'synthetic-person',
        name: 'Alex',
        aliases: [],
      },
      {
        entityId: `entity-${suffix}-orion`,
        type: 'synthetic-team',
        name: 'Orion',
        aliases: [],
      },
    ],
    relations: [
      {
        relationId: `relation-${suffix}-works`,
        sourceEntityId: `entity-${suffix}-alex`,
        targetEntityId: `entity-${suffix}-orion`,
        type: 'works-at',
        validity,
      },
    ],
  })

const makeGraphLeaf = (
  cell: CorpusCell,
  suffix: string,
  scope: RawEventOptions['scope'],
  validity: RelationValidity,
): Record<string, unknown> =>
  makeRawEvent({
    suffix,
    tag: 'leaf',
    scope,
    language: cell.language,
    eventTime: validity.validFrom,
    content: cell.language === 'ru' ? 'Орион создает систему Маяк.' : 'Orion builds the Beacon system.',
    entities: [
      {
        entityId: `entity-${suffix}-orion`,
        type: 'synthetic-team',
        name: 'Orion',
        aliases: [],
      },
      {
        entityId: `entity-${suffix}-beacon`,
        type: 'synthetic-project',
        name: 'Beacon',
        aliases: [],
      },
    ],
    relations: [
      {
        relationId: `relation-${suffix}-builds`,
        sourceEntityId: `entity-${suffix}-orion`,
        targetEntityId: `entity-${suffix}-beacon`,
        type: 'builds',
        validity,
      },
    ],
  })

export const graphFixture = (cell: CorpusCell, suffix: string, scope: RawEventOptions['scope']): ScenarioFixture => {
  const seedValidity = { validFrom: iso(1, 10, 9), validTo: null } as const
  const leafValidity = { validFrom: iso(1, 11, 9), validTo: null } as const
  return {
    ...baseFixture(cell, suffix, scope),
    events: [makeGraphSeed(cell, suffix, scope, seedValidity), makeGraphLeaf(cell, suffix, scope, leafValidity)],
    queryText:
      cell.language === 'ru'
        ? 'Где работает Алексей и какой проект связан с этой командой?'
        : "Which project is connected to Alex's team?",
    expectedEvidenceIds: [evidenceId(suffix, 'leaf')],
  }
}
