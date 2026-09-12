// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { saveAttachment } from '../../../../src/attachments/store.js'
import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { buildUserTurnMessages } from '../../../../src/llm-orchestrator-attachments.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { scenario } from '../../harness/scenario.js'

const AUDIO_PLUGIN_ID = 'audio-transcribe'
const TRANSCRIPTION_HOST = 'transcribe.invalid'

scenario(
  'SCN-plugin-audio-transcribe-transformer: a voice attachment is transcribed through the declared host',
  async ({ given, world }) => {
    const plugin = (await discoverPlugins('plugins')).plugins.find(({ manifest }) => manifest.id === AUDIO_PLUGIN_ID)
    if (plugin === undefined) throw new Error('Expected audio-transcribe plugin to be discoverable')

    const user = given.user('voice-user')
    const context = given.dm(user)
    const contextId = toScopedContextId({ platformInstanceId: context.platformInstanceId, nativeContextId: context.id })
    given.plugin(plugin)
    setPluginEnabledForContext(AUDIO_PLUGIN_ID, contextId, true)
    setPluginAdminConfig(AUDIO_PLUGIN_ID, 'api_key', 'test-key', 'scenario-admin')
    setPluginAdminConfig(AUDIO_PLUGIN_ID, 'base_url', `https://${TRANSCRIPTION_HOST}`, 'scenario-admin')
    world.http.serveHost(TRANSCRIPTION_HOST, async (request) => {
      expect(request.method).toBe('POST')
      expect(new URL(request.url).pathname).toBe('/v1/audio/transcriptions')
      const form = await request.formData()
      expect(form.get('model')).toBe('whisper-1')
      expect(form.get('file')).toBeInstanceOf(File)
      return Response.json({ text: 'release notes', language: 'en', duration: 1.5 })
    })
    await world.start()
    const attachment = await saveAttachment({
      contextId: world.scopedStorageContextId(context),
      sourceProvider: 'unknown',
      sourceMessageId: 'voice-message',
      sourceFileId: 'voice-file',
      filename: 'voice.ogg',
      mimeType: 'audio/ogg',
      content: Buffer.from('voice-bytes'),
      status: 'available',
      origin: 'voice',
    })
    const messages = await buildUserTurnMessages(
      world.scopedStorageContextId(context),
      user.id,
      'scenario-main-model',
      'summarize this',
      [attachment.attachmentId],
    )
    const content = messages.modelMessage.content
    expect(typeof content).toBe('string')
    if (typeof content !== 'string') throw new Error('Expected text-only scenario model content')
    expect(content).toContain('[Voice attachment')
    expect(content).toContain('release notes')
  },
)
