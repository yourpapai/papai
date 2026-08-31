// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CLAUDE_TMP_PREFIX, claudeGateOf, exitAfterClose } from '../../sdd-runner/src/claude-gate.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'

const CREDENTIAL_NAMES = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'LLM_API_KEY'] as const
const saved = new Map<string, string | undefined>()

/** Records the exit code, then throws the interception sentinel — the exit must not actually happen. */
function recordExitInto(exits: unknown[]): (code: string | number | null | undefined) => never {
  return (code) => {
    exits.push(code)
    throw new Error(`intercepted process.exit(${String(code)})`)
  }
}

function setCredentials(values: Partial<Record<(typeof CREDENTIAL_NAMES)[number], string>>): void {
  for (const name of CREDENTIAL_NAMES) {
    saved.set(name, process.env[name])
    const value = values[name]
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
}

/** Same save/restore convention as `setCredentials`, for the tmp root the open reads. */
function setTmpdir(value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, 'TMPDIR')
  else process.env['TMPDIR'] = value
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
  saved.clear()
})

function parentsInTmp(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(CLAUDE_TMP_PREFIX))
}

function makeDeps(backend: 'opencode' | 'claude'): OrchestratorDeps {
  const repoRoot = path.join(os.tmpdir(), 'sdd-claude-gate-repo')
  return {
    config: { repoRoot, workDir: path.join(repoRoot, '.sdd-runner'), model: 'm', budget: 5, backend },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
      cwd: repoRoot,
    }),
  }
}

describe('claudeGateOf', () => {
  it('opens one parent however many run-driving members ask for it', async () => {
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    const deps = makeDeps('claude')
    const gate = claudeGateOf(deps)
    const before = parentsInTmp()
    try {
      await gate.ensure()
      const first = deps.claude?.configDirRoot
      await gate.ensure()
      await gate.ensure()
      // Memoized: a second mkdtemp would strand the first parent past teardown,
      // since only the last one would ever be removed.
      expect(deps.claude?.configDirRoot).toBe(first)
      expect(parentsInTmp()).toHaveLength(before.length + 1)
    } finally {
      await gate.close()
    }
    expect(parentsInTmp()).toEqual(before)
  })

  it('is a no-op off the claude route, credentials unread', async () => {
    // The environment that refuses a claude-route run: the default route must
    // neither consult it nor open anything.
    setCredentials({ ANTHROPIC_API_KEY: 'a-key-0123456789', CLAUDE_CODE_OAUTH_TOKEN: 'b-token-0123456789' })
    const deps = makeDeps('opencode')
    const gate = claudeGateOf(deps)
    const before = parentsInTmp()
    await gate.ensure()
    expect(deps.claude).toBeUndefined()
    expect(parentsInTmp()).toEqual(before)
    await gate.close()
  })

  it('refuses a bad credential environment and opens nothing', async () => {
    setCredentials({})
    const deps = makeDeps('claude')
    const gate = claudeGateOf(deps)
    const before = parentsInTmp()
    await expect(gate.ensure()).rejects.toThrow(/\[CLAUDE_CREDENTIALS\]/u)
    expect(deps.claude).toBeUndefined()
    expect(parentsInTmp()).toEqual(before)
    // Nothing was opened, so closing is a no-op rather than a second failure.
    await gate.close()
  })

  it('re-runs the guard after a refusal instead of caching it', async () => {
    setCredentials({})
    const deps = makeDeps('claude')
    const gate = claudeGateOf(deps)
    await expect(gate.ensure()).rejects.toThrow(/\[CLAUDE_CREDENTIALS\]/u)
    await expect(gate.ensure()).rejects.toThrow(/\[CLAUDE_CREDENTIALS\]/u)
  })

  it('retries the open after a transient failure instead of caching the rejection', async () => {
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    const deps = makeDeps('claude')
    const gate = claudeGateOf(deps)
    const before = parentsInTmp()
    // A tmp root that mkdtemp cannot create under — the transient-failure
    // shape (ENOENT now, recovered later), not a credential refusal.
    const savedTmpdir = process.env['TMPDIR']
    setTmpdir(path.join(os.tmpdir(), 'sdd-claude-gate-missing-root'))
    try {
      await expect(gate.ensure()).rejects.toThrow()
      expect(deps.claude).toBeUndefined()
      // A later member re-runs the open rather than inheriting the rejected
      // promise: with the memo poisoned, this await would rethrow ENOENT.
      setTmpdir(undefined)
      await gate.ensure()
      expect(deps.claude?.configDirRoot).toBeDefined()
      expect(parentsInTmp()).toHaveLength(before.length + 1)
    } finally {
      setTmpdir(savedTmpdir)
      await gate.close()
    }
    expect(parentsInTmp()).toEqual(before)
  })
})

describe('exitAfterClose', () => {
  /** Records `process.exit` calls instead of performing them. */
  function recordExits(): { readonly exits: unknown[]; readonly restore: () => void } {
    const exits: unknown[] = []
    const spy = spyOn(process, 'exit').mockImplementation(recordExitInto(exits))
    return {
      exits,
      restore: (): void => {
        spy.mockRestore()
      },
    }
  }

  /** The opened config-dir parent, '' before the open (module-level: keeps the `??` out of test bodies). */
  function parentOf(deps: OrchestratorDeps): string {
    return deps.claude?.configDirRoot ?? ''
  }

  /** Lets the close → exit microtask chain settle. */
  const settled = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

  it('closes before the abrupt exit and passes the signal code through', async () => {
    const order: string[] = []
    const recorder = recordExits()
    try {
      exitAfterClose((): Promise<void> => {
        order.push('close')
        return Promise.resolve()
      })(130)
      await settled()
      expect(order).toEqual(['close'])
      expect(recorder.exits).toEqual([130])
    } finally {
      recorder.restore()
    }
  })

  it('still exits when the close fails, and the failure is swallowed', async () => {
    const recorder = recordExits()
    try {
      exitAfterClose((): Promise<void> => Promise.reject(new Error('rm failed')))(143)
      await settled()
      expect(recorder.exits).toEqual([143])
    } finally {
      recorder.restore()
    }
  })

  it('the interrupt teardown removes the opened config-dir parent before exiting', async () => {
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    const deps = makeDeps('claude')
    const gate = claudeGateOf(deps)
    const before = parentsInTmp()
    await gate.ensure()
    const parent = parentOf(deps)
    expect(parent).not.toBe('')
    const recorder = recordExits()
    try {
      exitAfterClose((): Promise<void> => gate.close())(130)
      await settled()
      expect(recorder.exits).toEqual([130])
      expect(fs.existsSync(parent)).toBe(false)
    } finally {
      recorder.restore()
      await gate.close()
    }
    expect(parentsInTmp()).toEqual(before)
  })
})
