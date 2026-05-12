import { describe, expect, test } from 'bun:test'

describe('attachments/index re-exports', () => {
  test('exports staged file functions', async () => {
    const mod = await import('../../src/attachments/index.js')
    expect(typeof mod.stageFileMetadata).toBe('function')
    expect(typeof mod.searchStagedFiles).toBe('function')
    expect(typeof mod.findStagedFilesByMessageId).toBe('function')
    expect(typeof mod.purgeExpiredStagedFiles).toBe('function')
    expect(typeof mod.resolveStagedFile).toBe('function')
  })
})
