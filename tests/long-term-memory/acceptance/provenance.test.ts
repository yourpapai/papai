// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildLongTermMemoryContextMessage } from '../../../src/long-term-memory/context.js'
import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { purgeMemoryRecord } from '../../../src/long-term-memory/purge.js'
import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import type { MemoryRecord } from '../../../src/long-term-memory/types.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, PERSONAL, seedMultilingual, seedToolResult } from './corpus.js'
import { CASES } from './provenance.cases.js'

const PURGE_TIME = '2026-07-24T00:00:00.000Z'

/** Narrows outside the test body — oxlint forbids conditionals inside `test()`. */
const activeById = (id: string | undefined): MemoryRecord => {
  const record = listMemoryRecords({ ...PERSONAL, status: 'active' }).find((r) => r.id === id)
  if (record === undefined) throw new Error(`no active record with id ${String(id)}`)
  return record
}

/**
 * `seedToolResult`/`seedMultilingual` return `readonly string[]`, so destructuring loses
 * definiteness under `noUncheckedIndexedAccess`. Narrowing lives here, per the same
 * no-conditional-in-test constraint that shapes `activeById` above.
 */
const requireId = (id: string | undefined): string => {
  if (id === undefined) throw new Error('seed helper returned fewer ids than expected')
  return id
}

/** `??` is banned inside `test()` bodies, so the id default lives here. */
const purge = (id: string | undefined): boolean => purgeMemoryRecord(PERSONAL, id ?? '', PURGE_TIME)

/**
 * Extracts the `id` attribute of every `<record>` element the context renderer emitted —
 * i.e. every piece of derived text actually offered to the model — outside the test body,
 * mirroring the narrowing helpers above.
 */
const renderedRecordIds = (message: { role: 'system'; content: string } | null): readonly string[] => {
  if (message === null) throw new Error('expected a rendered long-term-memory context message')
  return [...message.content.matchAll(/<record id="([^"]+)"/gu)].map((match) => match[1] ?? '')
}

const activeRecords = (): readonly MemoryRecord[] => listMemoryRecords({ ...PERSONAL, status: 'active' })

describe('acceptance: provenance', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`tool-result — ${CASES['tool-result']}`, () => {
    const [id] = seedToolResult(PERSONAL)
    const record = activeById(id)

    expect(record.source).toBe('tool_result')
    expect(record.evidence.messageIds).toEqual(['msg-tool-1'])
    expect(record.evidence.contextId).toBe(PERSONAL.scopeId)
    expect(record.evidence.timestamps).toHaveLength(1)
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    const seeded = seedMultilingual(PERSONAL)

    const hits = searchLexical({ ...PERSONAL, query: 'Berlin', statuses: ALL_STATUSES, limit: 8 })
    expect(hits.length).toBeGreaterThan(0)

    for (const hit of hits) {
      // every retrieval hit resolves back to a stored canonical record with a declared source
      const stored = activeById(hit.id)
      expect(stored.content).toBe(hit.content)
      // `seedMultilingual` never overrides `source`, so this is falsifiable against the corpus
      // default rather than a tautology against the non-empty MemorySource enum.
      expect(stored.source).toBe('explicit')
    }
    for (const id of seeded) {
      expect(activeById(id).id).toBe(id)
    }
  })

  test(
    'derived-text — every record surfaced in the rendered long-term-memory context resolves to a stored ' +
      'record, and a purged record cannot surface',
    () => {
      const toolId = requireId(seedToolResult(PERSONAL)[0])
      seedMultilingual(PERSONAL)

      const before = activeRecords()
      const idsBefore = renderedRecordIds(buildLongTermMemoryContextMessage({ profile: null, records: before }))

      // positive control: the renderer actually surfaces every seeded record here, so the
      // post-purge absence below proves the purge closed the channel, not that nothing ever
      // renders. This also proves the id->record link, not a coincidental string match: each
      // rendered id independently resolves back through the store.
      expect(idsBefore).toHaveLength(before.length)
      for (const id of idsBefore) {
        expect(activeById(id).id).toBe(id)
      }
      // the rendered text is the stored content verbatim, not a paraphrase invented by the renderer
      expect(buildLongTermMemoryContextMessage({ profile: null, records: before })?.content).toContain(
        'Task PAP-42 was moved to In Progress',
      )

      expect(purge(toolId)).toBe(true)

      const after = activeRecords()
      const idsAfter = renderedRecordIds(buildLongTermMemoryContextMessage({ profile: null, records: after }))

      // the purged record's derived text cannot surface again
      expect(idsAfter).not.toContain(toolId)
      // and every id that does surface still resolves to a live stored record
      for (const id of idsAfter) {
        expect(activeById(id).id).toBe(id)
      }
    },
  )
})
