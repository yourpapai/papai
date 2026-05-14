import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../..')

const readRepoFile = (relativePath: string): string => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

describe('codeindex portability wiring', () => {
  test('uses wrapper-based runtime resolution instead of a static codeindex package dependency', () => {
    const packageJson = readRepoFile('package.json')
    const extractEvidence = readRepoFile('scripts/behavior-audit/extract-evidence.ts')

    expect(packageJson).not.toContain('"codeindex": "file:../codeindex"')
    expect(packageJson).not.toContain('"codeindex": "link:codeindex"')
    expect(packageJson).toContain('"codeindex:index": "bun run scripts/codeindex-cli.ts index"')
    expect(packageJson).toContain('"codeindex:reindex": "bun run scripts/codeindex-cli.ts reindex"')
    expect(packageJson).toContain('"codeindex:stats": "bun run scripts/codeindex-cli.ts stats"')
    expect(extractEvidence).not.toContain("from 'codeindex/src/")
  })

  test('routes config and extensions through the wrapper without absolute codeindex paths', () => {
    const mcpConfig = readRepoFile('.mcp.json')
    const openCodeConfig = readRepoFile('opencode.json')
    const reindexPlugin = readRepoFile('.opencode/plugins/codeindex-reindex.ts')
    const piExtension = readRepoFile('.pi/extensions/codeindex-reindex/index.ts')

    expect(mcpConfig).toContain('"scripts/codeindex-cli.ts"')
    expect(openCodeConfig).toContain('"scripts/codeindex-cli.ts"')
    expect(reindexPlugin).toContain("['run', 'scripts/codeindex-cli.ts', 'reindex']")
    expect(piExtension).toContain("['run', 'scripts/codeindex-cli.ts', 'reindex']")

    const staleAbsolutePath = '/Users/ki/Projects/papai/codeindex/src/cli.ts'
    expect(mcpConfig).not.toContain(staleAbsolutePath)
    expect(openCodeConfig).not.toContain(staleAbsolutePath)
    expect(reindexPlugin).not.toContain(staleAbsolutePath)
    expect(readRepoFile('docs/guides/codeindex-verification.md')).not.toContain(staleAbsolutePath)
  })

  test('documents wrapper usage and CODEINDEX_DIR remediation', () => {
    const verificationGuide = readRepoFile('docs/guides/codeindex-verification.md')

    expect(verificationGuide).toContain('bun run scripts/codeindex-cli.ts stats')
    expect(verificationGuide).toContain('CODEINDEX_DIR')
    expect(verificationGuide).toContain('clone the sibling repo at ../codeindex')
  })

  test('removes stale in-repo codeindex guidance from active repo files', () => {
    const architectureInventory = readRepoFile('scripts/architecture-inventory-registry.ts')
    const reviewLoopGuide = readRepoFile('review-loop/CLAUDE.md')
    const verificationGuide = readRepoFile('docs/guides/codeindex-verification.md')

    expect(architectureInventory).not.toContain("'codeindex/src/cli.ts'")
    expect(architectureInventory).toContain("'scripts/codeindex-cli.ts'")

    expect(reviewLoopGuide).not.toContain('codeindex/src/')
    expect(verificationGuide).not.toContain('That Touch `codeindex/`')
    expect(verificationGuide).toContain('Before Merging PRs That Touch `codeindex` Integration')
  })
})
