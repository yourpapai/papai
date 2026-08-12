// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  buildOpencodeConfig,
  modelRef,
  OPENAI_PROVIDER_ID,
  PROPOSE_PERMISSION,
  READ_ONLY_PERMISSION,
  WRITE_PERMISSION,
} from '../../opencode-agent/src/openai-config.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'

/**
 * Design D8 — the capability profile for artefact-writing turns.
 *
 * The drafter (PLANNING under the OpenSpec rework) gains `edit` on top of the
 * read-only set, deny-by-default, with the diff guard's `outsidePrefix`
 * confining what survives staging to `openspec/changes/<name>/`. No `bash`:
 * composing artefacts is not running commands. These tests pin the profile's
 * shape and its registration in the built config.
 */

const settings: OpenAiSettings = { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }

describe('PROPOSE_PERMISSION (D8)', () => {
  it('is deny-by-default', () => {
    expect(PROPOSE_PERMISSION['*']).toBe('deny')
  })

  it('grants edit on top of the read-only set', () => {
    expect(PROPOSE_PERMISSION['edit']).toBe('allow')
    expect(PROPOSE_PERMISSION['read']).toBe('allow')
    expect(PROPOSE_PERMISSION['grep']).toBe('allow')
  })

  it('does not grant bash — composing artefacts is not running commands', () => {
    expect(PROPOSE_PERMISSION['bash']).toBeUndefined()
  })

  it('is narrower than WRITE_PERMISSION (no bash, no external_directory)', () => {
    expect(WRITE_PERMISSION['bash']).toBe('allow')
    expect(WRITE_PERMISSION['external_directory']).toBe('allow')
    expect(PROPOSE_PERMISSION['bash']).toBeUndefined()
    expect(PROPOSE_PERMISSION['external_directory']).toBeUndefined()
  })
})

describe('buildOpencodeConfig · propose agent registration', () => {
  it('registers a propose agent with PROPOSE_PERMISSION', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.agent?.['propose']?.permission).toEqual(PROPOSE_PERMISSION)
  })

  it('keeps plan read-only and build write-capable alongside it', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.agent?.['plan']?.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['build']?.permission).toEqual(WRITE_PERMISSION)
  })

  it('pins the model reference the SDK and `opencode run` expect', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.model).toBe(modelRef(settings))
    expect(config.provider?.[OPENAI_PROVIDER_ID]?.models?.[settings.model]?.name).toBe(settings.model)
  })
})
