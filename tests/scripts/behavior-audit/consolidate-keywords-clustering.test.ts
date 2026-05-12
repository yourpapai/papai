import { describe, expect, test } from 'bun:test'

describe('consolidate-keywords-clustering module surface', () => {
  test('does not expose buildClusters from the production module surface', async () => {
    const module = await import('../../../scripts/behavior-audit/consolidate-keywords-clustering.js')

    expect(module.buildClustersNormalized).toBeDefined()
    expect(module.toNormalizedFloat64Arrays).toBeDefined()
    expect('buildClusters' in module).toBe(false)
  })
})
