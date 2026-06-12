// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FlexibleSchema } from 'ai'
import { jsonSchema } from 'ai'
import { z } from 'zod'

import type { PluginTool } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRawJsonSchema(schema: unknown): schema is Record<string, unknown> {
  return isRecord(schema) && !('safeParse' in schema) && !('jsonSchema' in schema)
}

export function getPluginToolInputSchema(pluginTool: PluginTool): FlexibleSchema {
  if (pluginTool.inputSchema === undefined) return z.object({})
  if (isRawJsonSchema(pluginTool.inputSchema)) {
    return jsonSchema(pluginTool.inputSchema)
  }
  return pluginTool.inputSchema
}
