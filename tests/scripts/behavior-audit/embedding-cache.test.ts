import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { getOrEmbed } from '../../../scripts/behavior-audit/embedding-cache.js'
import { hashText } from '../../../scripts/behavior-audit/fingerprints.js'
import type { KeywordVocabularyEntry } from '../../../scripts/behavior-audit/keyword-vocabulary.js'

const SavedCacheSchema = z.object({ providerIdentity: z.string().optional() })

const vocabulary: readonly KeywordVocabularyEntry[] = [
  {
    slug: 'alpha',
    description: 'Alpha keyword',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

async function makeCachePath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'embedding-cache-test-'))
  return path.join(dir, 'embedding-cache.json')
}

describe('embedding cache identity', () => {
  test('reuses cached embeddings when provider identity and slug fingerprint match', async () => {
    const cachePath = await makeCachePath()
    let embedCalls = 0

    const first = await getOrEmbed(cachePath, 'embedding-model', vocabulary, {
      providerIdentity: 'http://provider-a/v1',
      embedSlugBatch: () => {
        embedCalls++
        return Promise.resolve([[1, 0]])
      },
      log: console,
    })

    const second = await getOrEmbed(cachePath, 'embedding-model', vocabulary, {
      providerIdentity: 'http://provider-a/v1',
      embedSlugBatch: () => {
        embedCalls++
        return Promise.resolve([[0, 1]])
      },
      log: console,
    })

    expect(embedCalls).toBe(1)
    expect(first.raw).toEqual([[1, 0]])
    expect(second.raw).toEqual([[1, 0]])
  })

  test('does not reuse cached embeddings when provider identity changes', async () => {
    const cachePath = await makeCachePath()
    let embedCalls = 0

    const first = await getOrEmbed(cachePath, 'embedding-model', vocabulary, {
      providerIdentity: 'http://provider-a/v1',
      embedSlugBatch: () => {
        embedCalls++
        return Promise.resolve([[1, 0]])
      },
      log: console,
    })

    const second = await getOrEmbed(cachePath, 'embedding-model', vocabulary, {
      providerIdentity: 'http://provider-b/v1',
      embedSlugBatch: () => {
        embedCalls++
        return Promise.resolve([[0, 1]])
      },
      log: console,
    })

    expect(embedCalls).toBe(2)
    expect(first.raw).toEqual([[1, 0]])
    expect(second.raw).toEqual([[0, 1]])
  })

  test('treats legacy cache files without provider identity as stale', async () => {
    const cachePath = await makeCachePath()
    await writeFile(
      cachePath,
      JSON.stringify({
        model: 'embedding-model',
        slugFingerprint: hashText('alpha'),
        entries: [{ slug: 'alpha', raw: [1, 0], normalized: [1, 0] }],
      }),
      'utf-8',
    )

    const result = await getOrEmbed(cachePath, 'embedding-model', vocabulary, {
      providerIdentity: 'http://provider-a/v1',
      embedSlugBatch: () => Promise.resolve([[0, 1]]),
      log: console,
    })

    const saved = SavedCacheSchema.parse(JSON.parse(await readFile(cachePath, 'utf-8')))

    expect(result.raw).toEqual([[0, 1]])
    expect(saved.providerIdentity).toBe('http://provider-a/v1')
  })
})
