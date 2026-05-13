import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfigForPath, resolveRepoRoot } from '../../codeindex/src/cli.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-cli-'))
  tempDirs.push(dir)
  return dir
}

describe('cli config resolution', () => {
  test('resolveRepoRoot defaults to repo root from import.meta.url', () => {
    const repoRoot = resolveRepoRoot()
    // cli.ts lives at codeindex/src/cli.ts, so resolveRepoRoot() resolves 2 dirs up from there
    const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'codeindex', 'src')
    const expected = path.resolve(cliDir, '..', '..')
    expect(repoRoot).toBe(expected)
    expect(repoRoot).toBe(expected)
  })

  test('resolveRepoRoot uses explicit targetPath when provided', () => {
    const tempDir = makeTempDir()
    expect(resolveRepoRoot(tempDir)).toBe(tempDir)
  })

  test('loadConfigForPath with explicit path loads from that directory', async () => {
    const repoRoot = makeTempDir()
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadConfigForPath(repoRoot)
    expect(config.repoRoot).toBe(repoRoot)
    expect(config.configPath).toBe(path.join(repoRoot, '.codeindex.json'))
    expect(config.roots).toEqual([path.join(repoRoot, 'src')])
  })

  test('loadConfigForPath defaults to repo root config', async () => {
    const config = await loadConfigForPath()
    expect(config.configPath).toBe(path.resolve(resolveRepoRoot(), '.codeindex.json'))
  })
})
