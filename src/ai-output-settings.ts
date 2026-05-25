// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig, setCachedConfig } from './cache.js'

export const AI_TOOL_VISIBILITY_KEY = 'ai_tool_visibility'
export const AI_REASONING_VISIBILITY_KEY = 'ai_reasoning_visibility'
export const AI_OUTPUT_DETAIL_LEVEL_KEY = 'ai_output_detail_level'

export type AiVisibility = 'on' | 'off'
export type AiOutputDetailLevel = 'sanitized' | 'raw'

export type AiOutputSettings = {
  toolVisibility: AiVisibility
  reasoningVisibility: AiVisibility
  detailLevel: AiOutputDetailLevel
}

export type AiOutputSettingName = keyof AiOutputSettings
export type AiOutputSettingValue<Name extends AiOutputSettingName> = AiOutputSettings[Name]

const DEFAULT_SETTINGS = {
  toolVisibility: 'off',
  reasoningVisibility: 'off',
  detailLevel: 'sanitized',
} as const satisfies AiOutputSettings

const SETTING_KEY_BY_NAME = {
  toolVisibility: AI_TOOL_VISIBILITY_KEY,
  reasoningVisibility: AI_REASONING_VISIBILITY_KEY,
  detailLevel: AI_OUTPUT_DETAIL_LEVEL_KEY,
} as const satisfies Record<AiOutputSettingName, string>

function parseVisibility(value: string | null): AiVisibility {
  return value === 'on' || value === 'off' ? value : 'off'
}

function parseDetailLevel(value: string | null): AiOutputDetailLevel {
  return value === 'raw' || value === 'sanitized' ? value : 'sanitized'
}

export function getAiOutputSettings(contextId: string): AiOutputSettings {
  return {
    toolVisibility: parseVisibility(getCachedConfig(contextId, AI_TOOL_VISIBILITY_KEY)),
    reasoningVisibility: parseVisibility(getCachedConfig(contextId, AI_REASONING_VISIBILITY_KEY)),
    detailLevel: parseDetailLevel(getCachedConfig(contextId, AI_OUTPUT_DETAIL_LEVEL_KEY)),
  }
}

export function getDefaultAiOutputSettings(): AiOutputSettings {
  return { ...DEFAULT_SETTINGS }
}

export function setAiOutputSetting<Name extends AiOutputSettingName>(
  contextId: string,
  name: Name,
  value: AiOutputSettingValue<Name>,
): void {
  setCachedConfig(contextId, SETTING_KEY_BY_NAME[name], value)
}
