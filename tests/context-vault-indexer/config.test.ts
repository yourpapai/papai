// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  CONFIG_FILE_NAME,
  readConfig,
  resolveToken,
  writeConfig,
  type ConfigFs,
  type IndexerConfig,
} from '../../context-vault-indexer/config.js'

const STATE_DIR = '/state'
const CONFIG_PATH = `${STATE_DIR}/${CONFIG_FILE_NAME}`

type FakeConfigFs = ConfigFs & { files: Map<string, string> }

const makeFs = (files: Record<string, string> = {}): FakeConfigFs => {
  const map = new Map<string, string>(Object.entries(files))
  return {
    files: map,
    readFile: (path: string) => map.get(path) ?? null,
    writeFile: (path: string, contents: string) => {
      map.set(path, contents)
    },
    rename: (from: string, to: string) => {
      const contents = map.get(from)
      if (contents === undefined) throw new Error(`missing ${from}`)
      map.delete(from)
      map.set(to, contents)
    },
  }
}

/** Narrowing helpers: the lint rule keeps branches out of test bodies. */
const configOf = (result: ReturnType<typeof readConfig>): IndexerConfig => {
  if (!result.ok) throw new Error(`expected a parsed config, got: ${result.error}`)
  return result.config
}

const failureOf = (result: ReturnType<typeof readConfig>): { reason: string; error: string } => {
  if (result.ok) throw new Error('expected a config failure')
  return { reason: result.reason, error: result.error }
}

const tokenOf = (result: ReturnType<typeof resolveToken>): string => {
  if (!result.ok) throw new Error(`expected a token, got: ${result.error}`)
  return result.token
}

const writtenConfig = (files: Map<string, string>): string => {
  const contents = files.get(CONFIG_PATH)
  if (contents === undefined) throw new Error('expected a config file to have been written')
  return contents
}

const VALID: IndexerConfig = {
  pushUrl: 'https://papai.example/api/context-vault/push',
  intervalMs: 30_000,
  repos: [{ repo: 'papai', specDir: '/home/u/papai/openspec/changes' }],
}

describe('readConfig', () => {
  test('parses a valid config file', () => {
    const result = readConfig(STATE_DIR, makeFs({ [CONFIG_PATH]: JSON.stringify(VALID) }))

    expect(configOf(result).pushUrl).toBe(VALID.pushUrl)
    expect(configOf(result).intervalMs).toBe(30_000)
    expect(configOf(result).repos).toEqual(VALID.repos)
  })

  test('defaults repos to empty and intervalMs to a sane value', () => {
    const result = readConfig(STATE_DIR, makeFs({ [CONFIG_PATH]: JSON.stringify({ pushUrl: VALID.pushUrl }) }))

    expect(configOf(result).repos).toEqual([])
    expect(configOf(result).intervalMs).toBeGreaterThan(0)
  })

  test('reports a distinct error when the file is absent', () => {
    const result = readConfig(STATE_DIR, makeFs())

    expect(failureOf(result).reason).toBe('missing')
    expect(failureOf(result).error).toContain(CONFIG_PATH)
  })

  test('reports a distinct error when the file is unparseable', () => {
    const result = readConfig(STATE_DIR, makeFs({ [CONFIG_PATH]: '{not json' }))

    expect(failureOf(result).reason).toBe('unparseable')
    expect(failureOf(result).error).toContain(CONFIG_PATH)
  })

  test('reports a distinct error when the file fails schema validation', () => {
    const result = readConfig(STATE_DIR, makeFs({ [CONFIG_PATH]: JSON.stringify({ pushUrl: 'not-a-url' }) }))

    expect(failureOf(result).reason).toBe('invalid')
    expect(failureOf(result).error).toContain(CONFIG_PATH)
  })

  test('rejects a non-positive scan interval rather than spinning a hot loop', () => {
    const result = readConfig(STATE_DIR, makeFs({ [CONFIG_PATH]: JSON.stringify({ ...VALID, intervalMs: 0 }) }))

    expect(failureOf(result).reason).toBe('invalid')
  })

  test('ignores an unknown token key in the file', () => {
    const fs = makeFs({ [CONFIG_PATH]: JSON.stringify({ ...VALID, token: 'from-file-should-be-ignored' }) })

    const result = readConfig(STATE_DIR, fs)

    expect(JSON.stringify(configOf(result))).not.toContain('from-file-should-be-ignored')
  })
})

describe('writeConfig', () => {
  test('round-trips through an atomic temp-then-rename write', () => {
    const fs = makeFs()

    writeConfig(STATE_DIR, VALID, fs)

    expect([...fs.files.keys()]).toEqual([CONFIG_PATH])
    expect(configOf(readConfig(STATE_DIR, fs))).toEqual(VALID)
  })

  test('never serializes a token, even when one rode in on the object', () => {
    const fs = makeFs()

    // Declared, not asserted: the extra key is exactly what must not survive.
    const smuggled: IndexerConfig & { token: string } = { ...VALID, token: 'super-secret' }
    writeConfig(STATE_DIR, smuggled, fs)

    const written = writtenConfig(fs.files)
    expect(written).not.toContain('super-secret')
    expect(written).not.toContain('token')
  })

  test('leaves no temp file behind', () => {
    const fs = makeFs()

    writeConfig(STATE_DIR, VALID, fs)

    expect([...fs.files.keys()].filter((path) => path !== CONFIG_PATH)).toEqual([])
  })
})

/** Narrows a failed token resolution without branching inside a test body. */
const errorOf = (result: ReturnType<typeof resolveToken>): string => {
  if (result.ok) throw new Error('expected a token failure')
  return result.error
}

describe('resolveToken', () => {
  test('reads the token from the environment', () => {
    expect(tokenOf(resolveToken({ CONTEXT_VAULT_TOKEN: 'env-token' }))).toBe('env-token')
  })

  test('fails when the variable is absent', () => {
    expect(errorOf(resolveToken({}))).toContain('CONTEXT_VAULT_TOKEN')
  })

  test('fails when the variable is empty or blank', () => {
    expect(resolveToken({ CONTEXT_VAULT_TOKEN: '' }).ok).toBe(false)
    expect(resolveToken({ CONTEXT_VAULT_TOKEN: '   ' }).ok).toBe(false)
  })

  test('does not name the token value in its error', () => {
    const result = resolveToken({ CONTEXT_VAULT_TOKEN: '  ' })

    expect(errorOf(result)).not.toContain('  ')
  })
})
