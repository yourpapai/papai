import { describe, expect, test } from 'bun:test'

import {
  classifiedArtifactPathForTestFile,
  extractedArtifactPathForTestFile,
} from '../../../scripts/behavior-audit/artifact-paths.js'

/**
 * Artifact paths are computed from (domain, filename). When two different test files
 * share the same basename AND fall into the same domain, they must still produce
 * distinct artifact paths — otherwise their extracted JSON files are silently merged.
 *
 * All confirmed collisions are in the "core" domain (files without a matched domain prefix).
 */

describe('extractedArtifactPathForTestFile', () => {
  describe('uniqueness — files that previously collided', () => {
    test('tests/config.test.ts vs tests/codeindex/config.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/config.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/config.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/codeindex/discover.test.ts vs tests/codeindex/indexer/discover.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/codeindex/discover.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/indexer/discover.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/codeindex/extract-symbols.test.ts vs tests/codeindex/indexer/extract-symbols.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/codeindex/extract-symbols.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/indexer/extract-symbols.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/codeindex/index-codebase.test.ts vs tests/codeindex/indexer/index-codebase.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/codeindex/index-codebase.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/indexer/index-codebase.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/index.test.ts vs tests/codeindex/search/index.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/index.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/search/index.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/recurrence.test.ts vs tests/recurrence/recurrence.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/recurrence.test.ts')
      const b = extractedArtifactPathForTestFile('tests/recurrence/recurrence.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/codeindex/resolve-references.test.ts vs tests/codeindex/resolver/resolve-references.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/codeindex/resolve-references.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/resolver/resolve-references.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/scheduler.test.ts vs tests/utils/scheduler.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/scheduler.test.ts')
      const b = extractedArtifactPathForTestFile('tests/utils/scheduler.test.ts')
      expect(a).not.toBe(b)
    })

    test('tests/codeindex/tsconfig-paths.test.ts vs tests/codeindex/resolver/tsconfig-paths.test.ts', () => {
      const a = extractedArtifactPathForTestFile('tests/codeindex/tsconfig-paths.test.ts')
      const b = extractedArtifactPathForTestFile('tests/codeindex/resolver/tsconfig-paths.test.ts')
      expect(a).not.toBe(b)
    })
  })

  describe('backward compatibility — files in known domains are unchanged', () => {
    test('tools domain: single-level file keeps plain basename', () => {
      const result = extractedArtifactPathForTestFile('tests/tools/search-tasks.test.ts')
      expect(result).toMatch(/\/tools\/search-tasks\.test\.json$/)
    })

    test('tools domain: sample test file keeps plain basename', () => {
      const result = extractedArtifactPathForTestFile('tests/tools/sample.test.ts')
      expect(result).toMatch(/\/tools\/sample\.test\.json$/)
    })

    test('commands domain: keeps plain basename', () => {
      const result = extractedArtifactPathForTestFile('tests/commands/index.test.ts')
      expect(result).toMatch(/\/commands\/index\.test\.json$/)
    })

    test('chat-telegram domain: keeps plain basename', () => {
      const result = extractedArtifactPathForTestFile('tests/chat/telegram/index.test.ts')
      expect(result).toMatch(/\/chat-telegram\/index\.test\.json$/)
    })

    test('providers-kaneo domain: keeps plain basename', () => {
      const result = extractedArtifactPathForTestFile('tests/providers/kaneo/index.test.ts')
      expect(result).toMatch(/\/providers-kaneo\/index\.test\.json$/)
    })

    test('core domain — root-level file keeps plain basename', () => {
      const result = extractedArtifactPathForTestFile('tests/config.test.ts')
      expect(result).toMatch(/\/core\/config\.test\.json$/)
    })

    test('core domain — subdirectory file encodes the subdirectory in the filename', () => {
      const result = extractedArtifactPathForTestFile('tests/codeindex/config.test.ts')
      expect(result).toMatch(/\/core\/codeindex_config\.test\.json$/)
    })

    test('core domain — deeply nested file encodes all subdirectory segments', () => {
      const result = extractedArtifactPathForTestFile('tests/codeindex/indexer/discover.test.ts')
      expect(result).toMatch(/\/core\/codeindex_indexer_discover\.test\.json$/)
    })
  })
})

describe('classifiedArtifactPathForTestFile', () => {
  test('same uniqueness guarantee for the classified store', () => {
    const a = classifiedArtifactPathForTestFile('tests/scheduler.test.ts')
    const b = classifiedArtifactPathForTestFile('tests/utils/scheduler.test.ts')
    expect(a).not.toBe(b)
  })

  test('known-domain classified path keeps plain basename', () => {
    const result = classifiedArtifactPathForTestFile('tests/tools/sample.test.ts')
    expect(result).toMatch(/\/tools\/sample\.test\.json$/)
  })
})
