// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Sanitize a plugin ID to a valid contribution name prefix. */
export function sanitizePluginId(pluginId: string): string {
  return pluginId.replace(/-/gu, '_')
}

/** Namespace a tool name under a plugin. */
export function namespacedToolName(pluginId: string, toolName: string): string {
  return `plugin_${sanitizePluginId(pluginId)}__${toolName}`
}

export function namespacedJobName(pluginId: string, jobName: string): string {
  return `plugin:${pluginId}:${jobName}`
}
