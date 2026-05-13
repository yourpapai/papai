import { describe, expect, test } from 'bun:test'

import { runPhase1b } from '../../../scripts/behavior-audit/consolidate-keywords.js'
import type { Phase1bDeps } from '../../../scripts/behavior-audit/consolidate-keywords.js'
import { createEmptyProgressFixture } from '../behavior-audit-integration.helpers.js'

describe('runPhase1b embedding cache identity', () => {
  test('passes embeddingBaseUrl to getOrEmbed as provider identity', async () => {
    const progress = createEmptyProgressFixture(1)
    progress.phase1.status = 'done'
    const providerIdentities: (string | undefined)[] = []
    const deps: Phase1bDeps = {
      loadKeywordVocabulary: () =>
        Promise.resolve([
          {
            slug: 'alpha',
            description: 'Alpha keyword',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            slug: 'beta',
            description: 'Beta keyword',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      saveKeywordVocabulary: () => Promise.resolve(),
      getOrEmbed: (_cachePath, _model, _vocabulary, getOrEmbedDeps) => {
        providerIdentities.push(getOrEmbedDeps.providerIdentity)
        return Promise.resolve({
          raw: [
            [1, 0],
            [0, 1],
          ],
          normalized: [
            [1, 0],
            [0, 1],
          ],
        })
      },
      embeddingCachePath: '/tmp/embedding-cache.json',
      embeddingBaseUrl: 'http://embedding-provider/v1',
      embeddingModel: 'embedding-model',
      loadManifest: () => Promise.resolve(null),
      remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
      saveProgress: () => Promise.resolve(),
      log: { log: () => {} },
    }

    await runPhase1b(progress, deps)

    expect(providerIdentities).toEqual(['http://embedding-provider/v1'])
  })
})
