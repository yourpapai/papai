// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig } from './cache.js'

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
