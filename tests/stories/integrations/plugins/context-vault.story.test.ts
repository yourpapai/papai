// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { getConfigContextIdFromStorageContextId } from '../../../../src/chat/scoped-context.js'
import { createToken, revokeToken } from '../../../../src/context-vault/token-store.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../../harness/scripted-llm.js'

const PUSH_BODY = JSON.stringify({
  repo: 'papai',
  changeName: 'alpha',
  // tasks.md is not a semantic kind, so the push never enqueues the debounced
  // summarizer — no LLM call and no dangling timer inside the story sandbox.
  files: [{ path: 'alpha/tasks.md', kind: 'tasks', hash: 'h1', mtime: 100, text: '- [x] one\n- [ ] two\n' }],
  deletions: [],
})

const pushInit = (bearer: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: PUSH_BODY,
})

scenario(
  'SCN-context-vault-push: a token push updates the vault, tools report freshness, and revoke rejects',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const contextId = world.scopedStorageContextId(dm)
    const vaultPlugin = (await discoverPlugins('plugins')).plugins.find((p) => p.manifest.id === 'context-vault')
    if (vaultPlugin === undefined) throw new Error('Expected discovered plugin context-vault')
    given.plugin(vaultPlugin)
    setPluginEnabledForContext('context-vault', contextId, true)
    await world.start()

    const configContextId = getConfigContextIdFromStorageContextId(contextId)
    const created = createToken(configContextId, 'ci indexer')

    const pushed = await when.request('/api/context-vault/push', pushInit(created.plaintext))
    then.responseStatus(pushed, 200)

    given.llm([
      callCapability('context-vault.specs.list', {}),
      answer('The alpha change is in progress at 50% and the vault has a fresh push.'),
    ])
    await when.message(alice, dm, 'What is the status of the alpha spec?')
    then.replyTo(alice).contains('50%')

    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('lastPushAt'))
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('alpha'))
    expect(last?.promptToolResultTokenFingerprints).not.toContain(created.plaintext)

    revokeToken(configContextId, created.tokenId)
    const rejected = await when.request('/api/context-vault/push', pushInit(created.plaintext))
    then.responseStatus(rejected, 401)
  },
)
