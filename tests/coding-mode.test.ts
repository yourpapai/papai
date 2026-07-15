// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { ChatRouter } from '../src/chat/router.js'
import type { AuthorizationResult, DeferredDeliveryTarget, IncomingMessage, ReplyFn } from '../src/chat/types.js'
import { type CodingModeDeps, defaultAckReactionForTest, maybeRouteCodingTask } from '../src/coding-mode.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../src/debug/chat-router-runtime.js'
import { kvGet } from '../src/plugins/store.js'
import type { PluginManifest, PluginTool, PluginToolRuntimeContext } from '../src/plugins/types.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

function stubReply(): { reply: ReplyFn; texts: string[] } {
  const texts: string[] = []
  const reply: ReplyFn = {
    text: (content: string): Promise<void> => {
      texts.push(content)
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<undefined> => Promise.resolve(undefined),
  }
  return { reply, texts }
}

function makeMessage(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    user: { id: 'u1', username: 'u', isAdmin: false },
    contextId: 'ctx-1',
    contextType: 'group',
    isMentioned: false,
    isReplyToBot: false,
    text: 'do the thing',
    platformInstanceId: 'inst-1',
    ...over,
  }
}

const auth: AuthorizationResult = {
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'st',
  configContextId: 'cfg',
}

const manifest: PluginManifest = {
  id: 'nerv',
  name: 'nerv',
  version: '1.0.0',
  description: 'nerv plugin',
  apiVersion: 1,
  main: 'index.ts',
  contributes: {
    tools: [],
    promptFragments: [],
    commands: [],
    jobs: [],
    configKeys: [],
    taskProviderTypes: [],
    attachmentTransformers: [],
  },
  permissions: [],
  defaultEnabled: false,
  activationTimeoutMs: 5000,
  requiredTaskCapabilities: [],
  requiredChatCapabilities: [],
  configRequirements: [],
  providerCapabilities: [],
  providerTraits: [],
  providerConfigSchema: [],
  providerContextConfigSchema: [],
  providerAllowedHosts: [],
}

function makeRuntimeContext(repoNames: string[]): PluginToolRuntimeContext {
  return {
    pluginId: 'nerv',
    storageContextId: 'st',
    chatUserId: 'u1',
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    adminConfig: { get: () => undefined },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => Promise.reject(new Error('not implemented')) },
    codingSecrets: {
      resolve: () => null,
      resolveForgeToken: () => null,
      resolveAgent: () => null,
      resolveForge: () => null,
      resolveProviderHost: () => null,
      resolveModel: () => null,
      resolveMcpServers: () => ({ ok: true, servers: [] }),
      resolveMcpTokens: () => ({}),
    },
    codingRepos: {
      list: () => repoNames.map((name) => ({ name, baseBranch: 'main' })),
      get: () => null,
    },
    transcript: { mintUrl: () => null },
  }
}

function tool(name: string, execute: PluginTool['execute']): PluginTool {
  return { name, description: name, execute }
}

function deps(over: Partial<CodingModeDeps> = {}): CodingModeDeps {
  // Memoized so repeated calls return the same object/mock instances, matching
  // contributionRegistry.getContributions()'s stable Map-backed reference in production.
  const contributions = {
    manifest,
    tools: [
      tool(
        'create_coding_task',
        mock(() => Promise.resolve({ id: 't1' })),
      ),
      tool(
        'followup_coding_task',
        mock(() => Promise.resolve({ ok: true })),
      ),
    ],
  }
  return {
    getMode: () => 'always',
    nervEligible: () => true,
    getNervContributions: () => contributions,
    buildRuntime: () => makeRuntimeContext(['g/r']),
    resolveGuardrails: () => ({ allowedAgents: [], whoMayUse: 'members', forceSharedKey: false, maxMcpServers: 3 }),
    ackReaction: () => Promise.resolve(),
    ...over,
  }
}

/** Flushes pending microtasks and one macrotask tick — used to let a blocked `execute()` call
 *  reach its await point before asserting on call counts in the concurrency test. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('maybeRouteCodingTask', () => {
  it('off/unset mode → false, no side effects', async () => {
    const { reply, texts } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, deps({ getMode: () => null }))).toBe(false)
    expect(texts).toHaveLength(0)
  })

  it('always + single repo → creates a task and replies', async () => {
    const { reply, texts } = stubReply()
    const d = deps()
    const contrib = d.getNervContributions()
    const create = contrib?.tools.find((t) => t.name === 'create_coding_task')
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(true)
    expect(create?.execute).toHaveBeenCalledWith(
      { prompt: 'do the thing', project: 'g/r' },
      expect.anything(),
      expect.anything(),
    )
    expect(texts[0]).toContain('Started a coding task')
  })

  it('always + active-task conflict → reroutes to followup', async () => {
    const { reply, texts } = stubReply()
    const conflictContributions = {
      manifest,
      tools: [
        tool(
          'create_coding_task',
          mock(() => Promise.resolve({ error: 'conflict', message: 'x' })),
        ),
        tool(
          'followup_coding_task',
          mock(() => Promise.resolve({ ok: true })),
        ),
      ],
    }
    const d = deps({ getNervContributions: () => conflictContributions })
    const followup = conflictContributions.tools.find((t) => t.name === 'followup_coding_task')
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(true)
    expect(followup?.execute).toHaveBeenCalledWith({ text: 'do the thing' }, expect.anything(), expect.anything())
    expect(texts[0]).toContain('Folded that into')
  })

  it('mention_only without mention → false', async () => {
    const { reply } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, deps({ getMode: () => 'mention_only' }))).toBe(false)
  })

  it('mention_only with mention → routes', async () => {
    const { reply } = stubReply()
    expect(
      await maybeRouteCodingTask(
        makeMessage({ isMentioned: true }),
        auth,
        reply,
        deps({ getMode: () => 'mention_only' }),
      ),
    ).toBe(true)
  })

  it(':no-bot: opt-out → false', async () => {
    const { reply } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage({ text: 'skip this :no-bot:' }), auth, reply, deps())).toBe(false)
  })

  it('0 repos → replies guidance and returns true', async () => {
    const { reply, texts } = stubReply()
    expect(
      await maybeRouteCodingTask(makeMessage(), auth, reply, deps({ buildRuntime: () => makeRuntimeContext([]) })),
    ).toBe(true)
    expect(texts[0]).toContain('no supervised project')
  })

  it('2+ repos → false (falls through to LLM)', async () => {
    const { reply } = stubReply()
    expect(
      await maybeRouteCodingTask(
        makeMessage(),
        auth,
        reply,
        deps({ buildRuntime: () => makeRuntimeContext(['a', 'b']) }),
      ),
    ).toBe(false)
  })

  it('nerv not eligible → false', async () => {
    const { reply } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, deps({ nervEligible: () => false }))).toBe(false)
  })

  it('non-conflict tool error → replies the message and returns true', async () => {
    const { reply, texts } = stubReply()
    const d = deps({
      getNervContributions: () => ({
        manifest,
        tools: [
          tool(
            'create_coding_task',
            mock(() => Promise.resolve({ error: 'not_configured', message: 'nerv not set up' })),
          ),
        ],
      }),
    })
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(true)
    expect(texts[0]).toContain('nerv not set up')
  })

  // Defect 1: guest / whoMayUse governance gate
  it('guest actor → false, no task created', async () => {
    const { reply, texts } = stubReply()
    const d = deps()
    const contrib = d.getNervContributions()
    const create = contrib?.tools.find((t) => t.name === 'create_coding_task')
    const guestAuth: AuthorizationResult = { ...auth, isGuest: true }
    expect(await maybeRouteCodingTask(makeMessage(), guestAuth, reply, d)).toBe(false)
    expect(create?.execute).not.toHaveBeenCalled()
    expect(texts).toHaveLength(0)
  })

  it('whoMayUse allowlist configured, user not on it → false', async () => {
    const { reply } = stubReply()
    const d = deps({
      resolveGuardrails: () => ({
        allowedAgents: [],
        whoMayUse: ['someone-else'],
        forceSharedKey: false,
        maxMcpServers: 3,
      }),
    })
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(false)
  })

  it('whoMayUse allowlist configured, user on it → routes', async () => {
    const { reply } = stubReply()
    const d = deps({
      resolveGuardrails: () => ({ allowedAgents: [], whoMayUse: ['u1'], forceSharedKey: false, maxMcpServers: 3 }),
    })
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(true)
  })

  // Defect 2: slash commands must never become coding tasks
  it('registered command (commandMatch set) → false', async () => {
    const { reply } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage({ commandMatch: 'nerv' }), auth, reply, deps())).toBe(false)
  })

  it('unregistered slash command /nerv → false', async () => {
    const { reply } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage({ text: '/nerv' }), auth, reply, deps())).toBe(false)
  })

  it('typo slash command /anything → false', async () => {
    const { reply } = stubReply()
    expect(await maybeRouteCodingTask(makeMessage({ text: '/anything' }), auth, reply, deps())).toBe(false)
  })

  // Defect 3: nerv errors must not drop the message
  it('create.execute throws → replies and returns true instead of propagating', async () => {
    const { reply, texts } = stubReply()
    const d = deps({
      getNervContributions: () => ({
        manifest,
        tools: [
          tool(
            'create_coding_task',
            mock(() => Promise.reject(new Error('network fail'))),
          ),
        ],
      }),
    })
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(true)
    expect(texts[0]).toContain('coding service')
  })

  // Defect 4: concurrent messages in the same context must serialize, not double-create
  it('concurrent calls for the same context serialize routing', async () => {
    const { reply: reply1 } = stubReply()
    const { reply: reply2 } = stubReply()
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const create = mock(() => gate.then(() => ({ id: 't1' })))
    const d = deps({
      getNervContributions: () => ({ manifest, tools: [tool('create_coding_task', create)] }),
    })

    const p1 = maybeRouteCodingTask(makeMessage(), auth, reply1, d)
    await flush()
    const p2 = maybeRouteCodingTask(makeMessage(), auth, reply2, d)
    await flush()

    expect(create).toHaveBeenCalledTimes(1)

    releaseFirst()
    await Promise.all([p1, p2])
    expect(create).toHaveBeenCalledTimes(2)
  })

  // SS-10 P6: messageId plumbing + instant ⏳ ack reaction
  it('success → passes msg.messageId into buildRuntime', async () => {
    const { reply } = stubReply()
    const buildRuntime = mock(() => makeRuntimeContext(['g/r']))
    const d = deps({ buildRuntime })
    expect(await maybeRouteCodingTask(makeMessage({ messageId: 'm1' }), auth, reply, d)).toBe(true)
    expect(buildRuntime).toHaveBeenCalledWith(manifest, {
      storageContextId: 'st',
      chatUserId: 'u1',
      messageId: 'm1',
    })
  })

  it('successful create with a messageId → calls ackReaction with the ⏳ emoji', async () => {
    const { reply } = stubReply()
    const ackReaction = mock(() => Promise.resolve())
    const d = deps({ ackReaction })
    expect(await maybeRouteCodingTask(makeMessage({ messageId: 'm1' }), auth, reply, d)).toBe(true)
    expect(ackReaction).toHaveBeenCalledTimes(1)
    expect(ackReaction).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }), auth, '⏳')
  })

  it('conflict → does not call ackReaction (existing task keeps its own reaction)', async () => {
    const { reply } = stubReply()
    const ackReaction = mock(() => Promise.resolve())
    const conflictContributions = {
      manifest,
      tools: [
        tool(
          'create_coding_task',
          mock(() => Promise.resolve({ error: 'conflict', message: 'x' })),
        ),
        tool(
          'followup_coding_task',
          mock(() => Promise.resolve({ ok: true })),
        ),
      ],
    }
    const d = deps({ getNervContributions: () => conflictContributions, ackReaction })
    expect(await maybeRouteCodingTask(makeMessage({ messageId: 'm1' }), auth, reply, d)).toBe(true)
    expect(ackReaction).not.toHaveBeenCalled()
  })

  it('non-conflict tool error → does not call ackReaction', async () => {
    const { reply } = stubReply()
    const ackReaction = mock(() => Promise.resolve())
    const d = deps({
      getNervContributions: () => ({
        manifest,
        tools: [
          tool(
            'create_coding_task',
            mock(() => Promise.resolve({ error: 'not_configured', message: 'nerv not set up' })),
          ),
        ],
      }),
      ackReaction,
    })
    expect(await maybeRouteCodingTask(makeMessage({ messageId: 'm1' }), auth, reply, d)).toBe(true)
    expect(ackReaction).not.toHaveBeenCalled()
  })

  it('message with no messageId → creates the task but never calls ackReaction', async () => {
    const { reply, texts } = stubReply()
    const ackReaction = mock(() => Promise.resolve())
    const d = deps({ ackReaction })
    expect(await maybeRouteCodingTask(makeMessage(), auth, reply, d)).toBe(true)
    expect(texts[0]).toContain('Started a coding task')
    expect(ackReaction).not.toHaveBeenCalled()
  })
})

// SS-10 defect 3: the real ackReaction implementation must gate its kv write on setReaction's
// success — a failed reaction must never be recorded as if it had applied.
class StubReactionRouter extends ChatRouter {
  readonly reactionCalls: Array<{ messageId: string; emoji: string }> = []
  result: boolean | 'throw' = true
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }
  override setReaction(
    _platformInstanceId: string,
    _target: DeferredDeliveryTarget,
    messageId: string,
    emoji: string | null,
  ): Promise<boolean> {
    this.reactionCalls.push({ messageId, emoji: emoji ?? '' })
    if (this.result === 'throw') return Promise.reject(new Error('reactions unsupported'))
    return Promise.resolve(this.result)
  }
}

describe('defaultAckReactionForTest (SS-10 defect 3)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })
  afterEach(() => {
    clearRuntimeChatRouter()
  })

  it('setReaction succeeds → records the emoji in kv', async () => {
    const router = new StubReactionRouter()
    setRuntimeChatRouter(router)
    await defaultAckReactionForTest(makeMessage({ messageId: 'm1' }), auth, '⏳')
    expect(router.reactionCalls).toHaveLength(1)
    expect(kvGet('nerv-reactions', 'st', 'reaction:m1')).toBe('⏳')
  })

  it('setReaction returns false → does NOT record the emoji in kv', async () => {
    const router = new StubReactionRouter()
    router.result = false
    setRuntimeChatRouter(router)
    await defaultAckReactionForTest(makeMessage({ messageId: 'm1' }), auth, '⏳')
    expect(router.reactionCalls).toHaveLength(1)
    expect(kvGet('nerv-reactions', 'st', 'reaction:m1')).toBeUndefined()
  })

  it('setReaction throws → does NOT record the emoji in kv (best-effort, never throws)', async () => {
    const router = new StubReactionRouter()
    router.result = 'throw'
    setRuntimeChatRouter(router)
    await expect(defaultAckReactionForTest(makeMessage({ messageId: 'm1' }), auth, '⏳')).resolves.toBeUndefined()
    expect(kvGet('nerv-reactions', 'st', 'reaction:m1')).toBeUndefined()
  })

  it('no chat router running → does NOT record the emoji in kv', async () => {
    clearRuntimeChatRouter()
    await defaultAckReactionForTest(makeMessage({ messageId: 'm1' }), auth, '⏳')
    expect(kvGet('nerv-reactions', 'st', 'reaction:m1')).toBeUndefined()
  })
})
