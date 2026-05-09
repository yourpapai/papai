import { join } from 'node:path'

import { CLASSIFIED_DIR, CONSOLIDATED_DIR, EVALUATED_DIR, EXTRACTED_DIR } from './config.js'
import { getDomain, getDomainPrefix } from './domain-map.js'

/**
 * Derives the artifact filename for a test file.
 *
 * For files whose path starts with a known domain prefix (e.g. `tests/tools/`),
 * only the part after that prefix is used — preserving the current flat basename
 * format (e.g. `search-tasks.test.json`).
 *
 * For files that fall through to the "core" domain (no matched prefix), the
 * subdirectory path relative to `tests/` is encoded into the filename by joining
 * segments with `_` (e.g. `tests/codeindex/indexer/discover.test.ts` →
 * `codeindex_indexer_discover.test.json`). This prevents basename collisions
 * when multiple core-domain files share the same filename in different directories.
 */
function getTestArtifactFileName(testFilePath: string): string {
  const domainPrefix = getDomainPrefix(testFilePath)
  const relative =
    domainPrefix === null ? testFilePath.replace(/^tests\//, '') : testFilePath.slice(domainPrefix.length)
  return relative.replace(/\.test\.ts$/, '.test.json').replaceAll('/', '_')
}

export function extractedArtifactPathForTestFile(testFilePath: string): string {
  return join(EXTRACTED_DIR, getDomain(testFilePath), getTestArtifactFileName(testFilePath))
}

export function classifiedArtifactPathForTestFile(testFilePath: string): string {
  return join(CLASSIFIED_DIR, getDomain(testFilePath), getTestArtifactFileName(testFilePath))
}

export function consolidatedArtifactPathForFeatureKey(featureKey: string): string {
  return join(CONSOLIDATED_DIR, `${featureKey}.json`)
}

export function evaluatedArtifactPathForFeatureKey(featureKey: string): string {
  return join(EVALUATED_DIR, `${featureKey}.json`)
}
