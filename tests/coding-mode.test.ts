// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'

import type { AuthorizationResult, IncomingMessage, ReplyFn } from '../src/chat/types.js'
import { type CodingModeDeps, maybeRouteCodingTask } from '../src/coding-mode.js'
import type { PluginManifest, PluginTool, PluginToolRuntimeContext } from '../src/plugins/types.js'

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
    ...over,
  }
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
})
