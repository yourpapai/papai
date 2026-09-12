// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { blockGitBranchCreate } from '../.hooks/git/checks/block-git-branch-create.mjs'
import { blockGitCheckout } from '../.hooks/git/checks/block-git-checkout.mjs'
import { blockGitReset } from '../.hooks/git/checks/block-git-reset.mjs'
import { blockGitRm } from '../.hooks/git/checks/block-git-rm.mjs'
import { blockGitSwitch } from '../.hooks/git/checks/block-git-switch.mjs'

const checkFullCalls: Array<{ ctx: { cwd: string; session_id: string }; skipTests: boolean | undefined }> = []
const sessionStateById = new Map<string, { needsRecheck: boolean }>()

const getSessionState = (sessionId: string): { needsRecheck: boolean } => {
  const existing = sessionStateById.get(sessionId)
  if (existing !== undefined) return existing

  const created = { needsRecheck: true }
  sessionStateById.set(sessionId, created)
  return created
}

const isFunction = (value: unknown): value is (...args: Array<unknown>) => unknown => {
  return typeof value === 'function'
}

const expectFunction = (value: unknown, name: string): ((...args: Array<unknown>) => unknown) => {
  if (!isFunction(value)) {
    throw new Error(`Expected ${name} function`)
  }

  return value
}

const expectRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Expected ${name} object`)
  }

  const record: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry
  }

  return record
}

class FakeSessionState {
  readonly #sessionId: string

  constructor(sessionId: string) {
    this.#sessionId = sessionId
  }

  getNeedsRecheck(): boolean {
    return getSessionState(this.#sessionId).needsRecheck
  }

  setNeedsRecheck(value: boolean): void {
    getSessionState(this.#sessionId).needsRecheck = value
  }
}

void mock.module('../.hooks/tdd/checks/check-full.mjs', () => ({
  checkFull: (ctx: { cwd: string; session_id: string }, skipTests: boolean | undefined): null => {
    checkFullCalls.push({ ctx, skipTests })
    return null
  },
}))

void mock.module('../.hooks/tdd/session-state.mjs', () => ({
  SessionState: FakeSessionState,
}))

void mock.module('../.hooks/tdd/paths.mjs', () => ({
  getSessionsDir: (): string => '/unused',
}))

void mock.module('../.hooks/git/checks/block-git-stash.mjs', () => ({
  blockGitStash: (): null => null,
}))

void mock.module('../.hooks/git/checks/block-git-checkout-discard.mjs', () => ({
  blockGitCheckoutDiscard: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/enforce-tdd.mjs', () => ({
  enforceTdd: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/enforce-write-policy.mjs', () => ({
  enforceWritePolicy: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/track-test-write.mjs', () => ({
  trackTestWrite: (): null => null,
}))

void mock.module('../.hooks/tdd/checks/verify-test-import.mjs', () => ({
  verifyTestImport: (): null => null,
}))

describe('TddEnforcement', () => {
  test('runs check:full without tests during session.idle rechecks', async () => {
    checkFullCalls.length = 0
    sessionStateById.clear()

    const pluginModule = await import('../.opencode/plugins/tdd-enforcement.ts')
    const pluginFactory = expectFunction(Reflect.get(pluginModule, 'TddEnforcement'), 'TddEnforcement')
    const plugin = expectRecord(
      await pluginFactory({
        client: {
          session: {
            promptAsync: mock((): Promise<void> => Promise.resolve()),
          },
        },
        directory: '/repo',
      }),
      'plugin hooks',
    )

    const beforeHook = expectFunction(Reflect.get(plugin, 'tool.execute.before'), 'tool.execute.before')

    await beforeHook(
      {
        tool: 'bash',
        sessionID: 'session-1',
        callID: 'call-1',
      },
      {
        args: { command: 'pwd' },
      },
    )

    const eventHook = expectFunction(Reflect.get(plugin, 'event'), 'event')

    await eventHook({ event: { type: 'session.idle' } })

    expect(checkFullCalls).toEqual([
      {
        ctx: { cwd: '/repo', session_id: 'session-1' },
        skipTests: true,
      },
    ])
  })
})

/**
 * The widened agent git-verb blocklist (walk-robustness F-P4): history- and
 * structure-mutating verbs join stash/discard — blunt textual matching in the
 * per-verb check-module style, each refusal naming its verb. The modules are
 * imported real (only the two pre-existing checks are mocked above).
 */
describe('agent git-verb guard — widened blocklist (walk-robustness F-P4)', () => {
  const bashCtx = (command: string): { tool_name: string; tool_input: Record<string, unknown> } => ({
    tool_name: 'bash',
    tool_input: { command },
  })

  test('git reset is refused in every mode, naming the verb', () => {
    for (const command of ['git reset --hard HEAD~1', 'git reset', 'echo x && git reset --soft origin/main']) {
      const result = blockGitReset(bashCtx(command))
      expect(result).toMatchObject({ decision: 'block' })
      expect(result?.reason).toContain('git reset')
    }
  })

  test('git rm is refused, naming the verb', () => {
    const result = blockGitRm(bashCtx('git rm -f src/one.ts'))
    expect(result).toMatchObject({ decision: 'block' })
    expect(result?.reason).toContain('git rm')
  })

  test('git switch is refused in every form, naming the verb', () => {
    for (const command of ['git switch agent/issue-42', 'git switch -c tmp/detour', 'git switch --detach']) {
      const result = blockGitSwitch(bashCtx(command))
      expect(result).toMatchObject({ decision: 'block' })
      expect(result?.reason).toContain('git switch')
    }
  })

  test('git checkout is refused in every form — the discard-only scope is subsumed', () => {
    for (const command of ['git checkout main', 'git checkout -- src/one.ts', 'git checkout -b tmp/detour']) {
      const result = blockGitCheckout(bashCtx(command))
      expect(result).toMatchObject({ decision: 'block' })
      expect(result?.reason).toContain('git checkout')
    }
  })

  test('git branch creation is refused, naming branch creation', () => {
    const result = blockGitBranchCreate(bashCtx('git branch agent/issue-42'))
    expect(result).toMatchObject({ decision: 'block' })
    expect(result?.reason).toContain('branch')
  })

  test('flagged git branch forms stay allowed — listing, deletion, rename, and bare listing', () => {
    for (const command of [
      'git branch --show-current',
      'git branch -a',
      'git branch --list',
      'git branch -d tmp/detour',
      'git branch -D tmp/detour',
      'git branch -m old new',
      'git branch',
    ]) {
      expect(blockGitBranchCreate(bashCtx(command))).toBeNull()
    }
  })

  test('commands without the blocked verbs pass every new check', () => {
    for (const command of ['git log --oneline', 'git status --porcelain', 'bun test tests/one.test.ts']) {
      expect(blockGitReset(bashCtx(command))).toBeNull()
      expect(blockGitRm(bashCtx(command))).toBeNull()
      expect(blockGitSwitch(bashCtx(command))).toBeNull()
      expect(blockGitCheckout(bashCtx(command))).toBeNull()
      expect(blockGitBranchCreate(bashCtx(command))).toBeNull()
    }
  })

  test('a non-bash tool never trips the guard', () => {
    const ctx = { tool_name: 'Write', tool_input: { command: 'git reset --hard' } }
    expect(blockGitReset(ctx)).toBeNull()
    expect(blockGitRm(ctx)).toBeNull()
    expect(blockGitSwitch(ctx)).toBeNull()
    expect(blockGitCheckout(ctx)).toBeNull()
    expect(blockGitBranchCreate(ctx)).toBeNull()
  })
})
