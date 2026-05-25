// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  type AiOutputDetailLevel,
  type AiOutputSettingName,
  type AiVisibility,
  getAiOutputSettings,
  setAiOutputSetting,
} from './ai-output-settings.js'
import type { ChatButton } from './chat/types.js'

export type ParsedAiOutputCallbackData = {
  setting: AiOutputSettingName
  value: AiVisibility | AiOutputDetailLevel
  targetContextId: string | undefined
}

export type AiOutputConfigSection = {
  lines: string[]
  buttons: ChatButton[]
}

const encodeContextId = (contextId: string): string => Buffer.from(contextId).toString('base64url')
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/u

function decodeContextId(encoded: string): string | null {
  if (encoded.length === 0 || !BASE64URL_RE.test(encoded)) return null

  const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
  if (decoded.length === 0) return null
  return decoded
}

function appendContext(data: string, targetContextId: string | undefined): string {
  return targetContextId === undefined ? data : `${data}@${encodeContextId(targetContextId)}`
}

function parseCoreCallbackData(core: string): Omit<ParsedAiOutputCallbackData, 'targetContextId'> | null {
  switch (core) {
    case 'cfg:ai:toolVisibility:on':
      return { setting: 'toolVisibility', value: 'on' }
    case 'cfg:ai:toolVisibility:off':
      return { setting: 'toolVisibility', value: 'off' }
    case 'cfg:ai:reasoningVisibility:on':
      return { setting: 'reasoningVisibility', value: 'on' }
    case 'cfg:ai:reasoningVisibility:off':
      return { setting: 'reasoningVisibility', value: 'off' }
    case 'cfg:ai:detailLevel:sanitized':
      return { setting: 'detailLevel', value: 'sanitized' }
    case 'cfg:ai:detailLevel:raw':
      return { setting: 'detailLevel', value: 'raw' }
    default:
      return null
  }
}

export function serializeAiOutputCallbackData(
  setting: 'toolVisibility',
  value: AiVisibility,
  ...rest: [] | [targetContextId: string]
): string
export function serializeAiOutputCallbackData(
  setting: 'reasoningVisibility',
  value: AiVisibility,
  ...rest: [] | [targetContextId: string]
): string
export function serializeAiOutputCallbackData(
  setting: 'detailLevel',
  value: AiOutputDetailLevel,
  ...rest: [] | [targetContextId: string]
): string
export function serializeAiOutputCallbackData(
  setting: AiOutputSettingName,
  value: AiVisibility | AiOutputDetailLevel,
  ...rest: [] | [targetContextId: string]
): string {
  const targetContextId = rest[0]
  return appendContext(`cfg:ai:${setting}:${value}`, targetContextId)
}

export function parseAiOutputCallbackData(data: string): ParsedAiOutputCallbackData | null {
  const atIdx = data.indexOf('@')
  const core = atIdx === -1 ? data : data.slice(0, atIdx)
  const parsed = parseCoreCallbackData(core)
  if (parsed === null) return null
  if (atIdx === -1) return { ...parsed, targetContextId: undefined }

  const decodedTargetContextId = decodeContextId(data.slice(atIdx + 1))
  if (decodedTargetContextId === null) return null
  return { ...parsed, targetContextId: decodedTargetContextId }
}

export function buildAiOutputConfigSection(targetContextId: string): AiOutputConfigSection {
  const settings = getAiOutputSettings(targetContextId)
  return {
    lines: [
      '\n**AI Output**',
      `Tool calls: ${settings.toolVisibility}`,
      `Reasoning: ${settings.reasoningVisibility}`,
      `Detail level: ${settings.detailLevel}`,
    ],
    buttons: [
      {
        text: settings.toolVisibility === 'on' ? 'Hide tool calls' : 'Show tool calls',
        callbackData: serializeAiOutputCallbackData(
          'toolVisibility',
          settings.toolVisibility === 'on' ? 'off' : 'on',
          targetContextId,
        ),
        style: settings.toolVisibility === 'on' ? 'danger' : 'secondary',
      },
      {
        text: settings.reasoningVisibility === 'on' ? 'Hide reasoning' : 'Show reasoning',
        callbackData: serializeAiOutputCallbackData(
          'reasoningVisibility',
          settings.reasoningVisibility === 'on' ? 'off' : 'on',
          targetContextId,
        ),
        style: settings.reasoningVisibility === 'on' ? 'danger' : 'secondary',
      },
      {
        text: settings.detailLevel === 'raw' ? 'Use sanitized detail' : 'Use raw detail',
        callbackData: serializeAiOutputCallbackData(
          'detailLevel',
          settings.detailLevel === 'raw' ? 'sanitized' : 'raw',
          targetContextId,
        ),
        style: settings.detailLevel === 'raw' ? 'danger' : 'secondary',
      },
    ],
  }
}

export function handleAiOutputConfigCallback(
  targetContextId: string,
  setting: 'toolVisibility',
  value: AiVisibility,
): AiOutputConfigSection
export function handleAiOutputConfigCallback(
  targetContextId: string,
  setting: 'reasoningVisibility',
  value: AiVisibility,
): AiOutputConfigSection
export function handleAiOutputConfigCallback(
  targetContextId: string,
  setting: 'detailLevel',
  value: AiOutputDetailLevel,
): AiOutputConfigSection
export function handleAiOutputConfigCallback(
  targetContextId: string,
  setting: AiOutputSettingName,
  value: AiVisibility | AiOutputDetailLevel,
): AiOutputConfigSection {
  switch (setting) {
    case 'toolVisibility':
      if (value !== 'on' && value !== 'off') return buildAiOutputConfigSection(targetContextId)
      setAiOutputSetting(targetContextId, setting, value)
      return buildAiOutputConfigSection(targetContextId)
    case 'reasoningVisibility':
      if (value !== 'on' && value !== 'off') return buildAiOutputConfigSection(targetContextId)
      setAiOutputSetting(targetContextId, setting, value)
      return buildAiOutputConfigSection(targetContextId)
    case 'detailLevel':
      if (value !== 'sanitized' && value !== 'raw') return buildAiOutputConfigSection(targetContextId)
      setAiOutputSetting(targetContextId, setting, value)
      return buildAiOutputConfigSection(targetContextId)
  }
  return buildAiOutputConfigSection(targetContextId)
}

export function handleParsedAiOutputConfigCallback(
  targetContextId: string,
  parsed: ParsedAiOutputCallbackData,
): AiOutputConfigSection | null {
  switch (parsed.setting) {
    case 'toolVisibility':
      if (parsed.value !== 'on' && parsed.value !== 'off') return null
      return handleAiOutputConfigCallback(targetContextId, parsed.setting, parsed.value)
    case 'reasoningVisibility':
      if (parsed.value !== 'on' && parsed.value !== 'off') return null
      return handleAiOutputConfigCallback(targetContextId, parsed.setting, parsed.value)
    case 'detailLevel':
      if (parsed.value !== 'sanitized' && parsed.value !== 'raw') return null
      return handleAiOutputConfigCallback(targetContextId, parsed.setting, parsed.value)
  }
  return null
}
