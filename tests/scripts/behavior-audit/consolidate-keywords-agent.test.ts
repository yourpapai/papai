import { beforeEach, expect, mock, test } from 'bun:test'

import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import { embedSlugBatch } from '../../../scripts/behavior-audit/consolidate-keywords-agent.js'

type EmbedManyArgs = { model: unknown; values: string[] }
type MockEmbeddingModel = { doEmbed: null }
type MockProvider = { embeddingModel: (name: string) => MockEmbeddingModel }

let embedManyImpl = (_args: EmbedManyArgs): Promise<{ embeddings: number[][] }> => Promise.resolve({ embeddings: [] })

beforeEach(() => {
  process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL'] = 'test-model'
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE'] = '2'
  reloadBehaviorAuditConfig()

  void mock.module('ai', () => ({
    embedMany: (args: EmbedManyArgs): Promise<{ embeddings: number[][] }> => embedManyImpl(args),
  }))
  void mock.module('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: (): MockProvider => ({
      embeddingModel: (_name: string): MockEmbeddingModel => ({ doEmbed: null }),
    }),
  }))
})

test('embedSlugBatch calls embedMany once for inputs within batch size', async () => {
  const calls: string[][] = []
  embedManyImpl = ({ values }: EmbedManyArgs): Promise<{ embeddings: number[][] }> => {
    calls.push(values)
    return Promise.resolve({ embeddings: values.map(() => [0.1, 0.2]) })
  }

  const result = await embedSlugBatch(['a: desc a', 'b: desc b'])

  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual(['a: desc a', 'b: desc b'])
  expect(result).toHaveLength(2)
})

test('embedSlugBatch splits large input across multiple batches', async () => {
  const calls: string[][] = []
  embedManyImpl = ({ values }: EmbedManyArgs): Promise<{ embeddings: number[][] }> => {
    calls.push(values)
    return Promise.resolve({ embeddings: values.map(() => [0.1, 0.2]) })
  }

  // batchSize=2, 5 inputs → 3 calls: [2, 2, 1]
  const inputs = ['a', 'b', 'c', 'd', 'e']
  const result = await embedSlugBatch(inputs)

  expect(calls).toHaveLength(3)
  expect(result).toHaveLength(5)
})

test('embedSlugBatch returns embeddings in order matching input', async () => {
  embedManyImpl = ({ values }: EmbedManyArgs): Promise<{ embeddings: number[][] }> =>
    Promise.resolve({ embeddings: values.map((_, i) => [i]) })

  // batchSize=2, 4 inputs
  const result = await embedSlugBatch(['a', 'b', 'c', 'd'])

  expect(result[0]).toEqual([0])
  expect(result[1]).toEqual([1])
  expect(result[2]).toEqual([0])
  expect(result[3]).toEqual([1])
})

test('embedSlugBatch throws after exhausting retries', async () => {
  process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '1'
  reloadBehaviorAuditConfig()

  embedManyImpl = (_args: EmbedManyArgs): Promise<{ embeddings: number[][] }> =>
    Promise.reject(new Error('API unavailable'))

  await expect(embedSlugBatch(['a'])).rejects.toThrow('Failed to embed batch')
})
